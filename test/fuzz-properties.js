#!/usr/bin/env node
/*
 * fuzz-properties.js — property-based fuzzing (fast-check) of the code that reads untrusted input and of the
 * protections that keep the user safe from it. fast-check generates many inputs per property from a fixed seed
 * (reproducible), concentrates on boundary values and, when a property fails, shrinks the input to a minimal
 * counterexample, which is printed with the seed and the path to replay it.
 *
 * Properties (the contract of each function, as documented in its source file):
 *  1. csv            src/reports.js: every CSV file read by a strict RFC 4180 reader has exactly one header row and
 *                    one row per finding with the same number of cells (no cell, row or line break injected); every
 *                    cell is the original text or the text with a leading apostrophe; no cell that a spreadsheet
 *                    program evaluates as a formula (begins – after white space – with =, +, -, @, also in full
 *                    width, or begins with a tab or carriage return), except plain numbers (OWASP "CSV Injection")
 *  2. file-names     src/file-safety.js safeFileName: never empty, at most 120 characters, no control, formatting or
 *                    separator characters, no path separators, characters reserved on Windows or white space, no
 *                    leading or trailing dot or underscore, no reserved device name; applying it twice changes
 *                    nothing
 *  3. classification src/file-safety.js classify: every file gets a verdict without exception; a file that starts with
 *                    the signature of a program, a script, a shortcut or the EICAR test file, a name with a
 *                    dangerous extension or with characters that reverse the writing direction is "danger" and
 *                    offered only as "….gesperrt"; the offered name is always a safe file name
 *  4. base64         src/file-safety.js decodeBase64: decodes what Node encodes (Base64 and Base64url), also with line
 *                    breaks and other characters outside the alphabet in between; never throws on any text
 *  5. zip            src/file-safety.js zipNames / detect: the names of a ZIP archive are read exactly from its central
 *                    directory, an archive with a program inside is "zip-exec"; a damaged archive never throws
 *  6. xml-encoding   src/xml-encoding.js decode: every document in UTF-8 (with and without byte order mark, with and
 *                    without declaration), UTF-16LE/BE with byte order mark and ISO-8859-1 is decoded exactly; an
 *                    illegal UTF-8 byte is reported as a fatal error; no input throws
 *  7. pdf            src/pdf-embedded.js and src/pdfa3-checks.js: damaged PDF files (bit flips, overwritten, inserted,
 *                    duplicated and deleted ranges, PDF tokens such as obj, stream, /Length, /JavaScript inserted)
 *                    are read, checked and their embedded files extracted without exception and within the time limit
 *  8. pipeline       src/pruefer-core.js: damaged invoices (XML tokens such as <!DOCTYPE, CDATA, entities, characters
 *                    outside XML inserted) give a verdict without exception within the time limit
 *  9. pipeline-csv   arbitrary text in the free-text elements of a valid invoice and in its file name, through the
 *                    whole processing into the three CSV files: every file well-formed, no cell evaluated as a formula
 *
 * Usage: node test/fuzz-properties.js [--seed S] [--scale F] <seed files (XML invoices and PDF files) ...>
 *   --scale multiplies the number of runs of every property (default 1; e.g. 20 for a long local run)
 * File extension .js (CommonJS: package.json has no "type" field): OpenSSF Scorecard recognises property-based
 * testing with fast-check in *.js files (check "Fuzzing").
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');

const root = path.join(__dirname, '..');
const FileSafety = require(path.join(root, 'src', 'file-safety.js'));
const Reports = require(path.join(root, 'src', 'reports.js'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const PdfEmbedded = require(path.join(root, 'src', 'pdf-embedded.js'));
const PdfA3Checks = require(path.join(root, 'src', 'pdfa3-checks.js'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const activePdfs = require(path.join(__dirname, 'active-pdfs.cjs'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt('--seed', '20261021'));
const SCALE = Number(opt('--scale', '1'));
const seedFiles = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const runs = (n) => Math.max(1, Math.round(n * SCALE));
const TIME_LIMIT_MS = 60000; // per input, as test/run-robustness-tests.cjs
const fastCheckVersion = (() => { try { return require('fast-check/package.json').version; } catch (e) { return '?'; } })();

// ---------------------------------------------------------------------------------------------------------------
// generators
// ---------------------------------------------------------------------------------------------------------------
/** arrays and byte arrays of an explicitly drawn length (independent of the size settings of fast-check) */
const arrayOf = (arb, max, min) => fc.integer({ min: min || 0, max }).chain((n) => fc.array(arb, { minLength: n, maxLength: n }));
const bytesOf = (max, min) => fc.integer({ min: min || 0, max }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n }));
const join = (a) => a.join('');
// characters with a meaning for CSV, spreadsheets, file systems, writing direction, XML and PDF
const SPECIAL = ['=', '+', '-', '@', '\uFF1D', '\uFF0B', '\uFF0D', '\uFF20', '\u0009', '\u000D', '\u000A', '"', ';', ',', "'", ' ', '\u00A0', '\uFEFF',
  '\u2028', '\u2029', '\u202E', '\u202D', '\u2066', '\u200B', '\u200D', '\u115F', '\u3164', '\u0000', '\u0007', '\u001F', '\u007F', '\u0085', '|', '\\', '/', ':', '*', '?', '<', '>',
  '.', '_', '0', '1', '9', ',5', 'e', 'E', 'ä', '€', 'ß', 'é', 'e\u0301', '\uD83D\uDE00', '\uD800', '\uDC00', 'CON', 'nul', 'COM1', 'lpt9', '.exe', '.pdf', '.xml', '.html'];
const ascii = fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c));
const codeUnit = fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)); // lone surrogates included
const codePoint = fc.integer({ min: 0, max: 0x10ffff }).map((c) => (c >= 0xd800 && c <= 0xdfff ? String.fromCharCode(c) : String.fromCodePoint(c)));
const anyChar = fc.oneof(fc.constantFrom(...SPECIAL), ascii, codeUnit, codePoint);
const text = (max) => arrayOf(anyChar, max).map(join);
/** well-formed Unicode text (no lone surrogates): what UTF-8 and UTF-16 can carry */
const wellFormedChar = fc.oneof(fc.constantFrom(...SPECIAL.filter((s) => !/[\uD800-\uDFFF]/.test(s) || /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(s))), ascii,
  fc.integer({ min: 0, max: 0x10ffff }).filter((c) => c < 0xd800 || c > 0xdfff).map((c) => String.fromCodePoint(c)));
const wellFormedText = (max) => arrayOf(wellFormedChar, max).map(join);

// ---------------------------------------------------------------------------------------------------------------
// oracles
// ---------------------------------------------------------------------------------------------------------------
/** a strict RFC 4180 reader (separator ';', records end with CRLF, optional UTF-8 byte order mark): throws on
 * anything that is not well-formed CSV */
function readCsv(textIn) {
  let i = textIn.charCodeAt(0) === 0xfeff ? 1 : 0;
  const rows = [];
  let row = [], cell = '', quoted = false, afterQuote = false, cellStart = true;
  for (; i < textIn.length; i++) {
    const c = textIn[i];
    if (quoted) {
      if (c === '"') { if (textIn[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } } else cell += c;
      continue;
    }
    if (c === ';') { row.push(cell); cell = ''; cellStart = true; afterQuote = false; continue; }
    if (c === '\r') {
      if (textIn[i + 1] !== '\n') throw new Error('CR without LF at ' + i);
      row.push(cell); rows.push(row); row = []; cell = ''; cellStart = true; afterQuote = false; i++;
      continue;
    }
    if (afterQuote) throw new Error('text after a closing quote at ' + i);
    if (c === '\n') throw new Error('LF without CR at ' + i);
    if (c === '"') { if (!cellStart) throw new Error('quote inside an unquoted cell at ' + i); quoted = true; cellStart = false; continue; }
    cell += c; cellStart = false;
  }
  if (quoted) throw new Error('unterminated quote');
  if (cell !== '' || row.length) throw new Error('last record without CRLF');
  return rows;
}
// what a spreadsheet program evaluates as a formula (OWASP "CSV Injection"), and what stays a number
const EVALUATED = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d+(?:,\d+)?$/;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
const UNSAFE_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\s\\/:*?"<>|\u115F\u1160\u3164\uFFA0]/u;
// no leading dot (hidden file), no trailing dot or underscore; a leading underscore only before a reserved device name
const isSafeName = (s) => typeof s === 'string' && s.length > 0 && s.length <= 120 && !UNSAFE_IN_NAME.test(s) && !/^\.|[._]$/.test(s) && !RESERVED_DEVICE.test(s) && (!/^_/.test(s) || RESERVED_DEVICE.test(s.slice(1)));
const extOf = (name) => { const m = /\.([A-Za-z0-9-]{1,24})$/.exec(String(name || '').trim()); return m ? m[1].toLowerCase() : ''; };
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const EICAR = ['X5O!P%@AP[4', 'PZX54(P^)7CC)7}$EICAR-', 'STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('').replace('[4P', '[4\\P');
const latin1Bytes = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const concat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** a ZIP archive (stored, UTF-8 names) with a central directory */
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = Buffer.from(e.data || 'x');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat(local.concat([cd, eocd])));
}

/** mutations of a byte array: each operation takes its positions modulo the current length */
const mutation = (tokens) => fc.oneof(
  fc.record({ op: fc.constant('flip'), at: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
  fc.record({ op: fc.constant('set'), at: fc.nat(), value: fc.integer({ min: 0, max: 255 }) }),
  fc.record({ op: fc.constant('insert'), at: fc.nat(), bytes: bytesOf(16, 1) }),
  fc.record({ op: fc.constant('token'), at: fc.nat(), token: fc.constantFrom(...tokens) }),
  fc.record({ op: fc.constant('delete'), at: fc.nat(), length: fc.integer({ min: 1, max: 64 }) }),
  fc.record({ op: fc.constant('duplicate'), from: fc.nat(), length: fc.integer({ min: 1, max: 256 }), at: fc.nat() }),
  fc.record({ op: fc.constant('truncate'), at: fc.nat() }));
function mutate(input, ops) {
  let b = input;
  for (const m of ops) {
    const n = b.length;
    const at = n ? m.at % (n + 1) : 0;
    if (m.op === 'flip' && n) { b = b.slice(); b[m.at % n] ^= 1 << m.bit; }
    else if (m.op === 'set' && n) { b = b.slice(); b[m.at % n] = m.value; }
    else if (m.op === 'insert') b = concat(b.subarray(0, at), m.bytes, b.subarray(at));
    else if (m.op === 'token') b = concat(b.subarray(0, at), latin1Bytes(m.token), b.subarray(at));
    else if (m.op === 'delete') b = concat(b.subarray(0, at), b.subarray(Math.min(n, at + m.length)));
    else if (m.op === 'duplicate' && n) { const from = m.from % n; b = concat(b.subarray(0, at), b.subarray(from, Math.min(n, from + m.length)), b.subarray(at)); }
    else if (m.op === 'truncate') b = b.subarray(0, at);
  }
  return b;
}
const PDF_TOKENS = [' obj ', 'endobj', 'stream\r\n', '\nendstream', '<<', '>>', '[', ']', '(', ')', '<', '>', '\\', '%', '/Type', '/Filespec', '/EmbeddedFile', '/ObjStm',
  '/N 99999', '/First 99999', '/FlateDecode', '/Filter [/FlateDecode /FlateDecode]', '/DecodeParms << /Predictor 15 /Columns 99999 >>', '/Length 999999999', '/Length -1',
  '/Length 7 0 R', ' 0 R', ' 1 0 R', ' 99999 0 R', 'xref\n0 1\n0000000000 65535 f \n', 'trailer << /Root 1 0 R >>', 'startxref\n9', '%%EOF', '/JavaScript', '/JS (app.alert)', '/Launch',
  '/OpenAction 1 0 R', '/AA << /O 1 0 R >>', '/Names << /EmbeddedFiles << /Names [(a) 1 0 R] >> >>', '/AF [1 0 R]', '/AFRelationship /Data', '/Root', '/Catalog',
  '/Metadata 1 0 R', '/Subtype /XML', '/F (rechnung.exe)', '/UF <FEFFD800>', '/UF <FEFF202E0065007800650000>', '(\\377\\376)', '<FEFF', '9999999999999999999', '-0', '1e308', '.5'];
const XML_TOKENS = ['<', '>', '&', '&amp;', '&#0;', '&#x110000;', '&#xD800;', '&lt;', '&undefined;', ']]>', '<![CDATA[', '<!--', '-->', '<?xml version="1.0"?>', '<?pi x?>',
  '<!DOCTYPE x [<!ENTITY a "b">]>', '<!DOCTYPE x SYSTEM "file:///etc/passwd">', 'xmlns="urn:x"', 'xmlns:cbc="urn:x"', ' xml:lang="de"', '"', "'", '=', '/>', '</', '<a>', '</a>',
  '<cbc:ID>', '</cbc:ID>', '<cac:InvoiceLine>', '</cac:InvoiceLine>', '\u0000', '\u0001', '\uFFFE', '\uFEFF', '\r', '\t', 'é', '€', '\uD83D\uDE00'];

// ---------------------------------------------------------------------------------------------------------------
let properties = 0, totalRuns = 0, failed = 0;
const failures = [];
async function property(name, numRuns, prop) {
  const t0 = Date.now();
  try {
    await fc.assert(prop, { numRuns, seed: SEED });
    console.log('  ' + name + ': ' + numRuns + ' runs passed (' + (Date.now() - t0) + ' ms)');
  } catch (e) {
    failed++;
    failures.push(name);
    console.log('  ' + name + ': FAILED after ' + (Date.now() - t0) + ' ms\n' + String(e && e.message || e).split('\n').map((l) => '    ' + l).join('\n').slice(0, 6000));
  }
  properties++;
  totalRuns += numRuns;
}
/** an async call that must settle within the time limit */
async function within(promise, what) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), TIME_LIMIT_MS); });
  const r = await Promise.race([promise, limit]);
  clearTimeout(timer);
  if (r === 'timeout') throw new Error(what + ': no result within ' + TIME_LIMIT_MS + ' ms');
  return r;
}

(async () => {
  console.log('fast-check ' + fastCheckVersion + ', seed ' + SEED + ', scale ' + SCALE);

  // 1. CSV ---------------------------------------------------------------------------------------------------
  const finding = fc.record({ id: text(12), text: text(40), location: text(20), level: fc.constantFrom('error', 'warning', 'information') });
  await property('csv: structure, faithful cells, no evaluated formula', runs(3000), fc.property(text(30), arrayOf(finding, 4), (name, findings) => {
    const results = [{ name, sha256: '', syntax: 'UBL', assessment: 'reject', warnings: [],
      allFindings: findings.map((f) => ({ level: f.level, source: 'schematron', id: f.id, schema: 'S', text: f.text, location: f.location, line: 7 })) }];
    const rows = readCsv(Reports.findingsCsv(results));
    if (rows.length !== 1 + Math.max(1, findings.length)) throw new Error(rows.length + ' rows');
    if (rows.some((r) => r.length !== rows[0].length)) throw new Error('rows with different numbers of cells');
    const faithful = (cell, v) => cell === v || cell === "'" + v;
    for (let i = 0; i < findings.length; i++) {
      const r = rows[1 + i], f = findings[i];
      if (!faithful(r[0], name) || !faithful(r[9], f.id) || !faithful(r[11], f.text) || !faithful(r[12], f.location)) throw new Error('cell changed: ' + JSON.stringify(r));
    }
    for (const r of rows) for (const cell of r) if (EVALUATED.test(cell) && !PLAIN_NUMBER.test(cell)) throw new Error('formula cell: ' + JSON.stringify(cell));
    return true;
  }));

  // 2. file names --------------------------------------------------------------------------------------------
  await property('file names: safe on every file system, idempotent', runs(5000), fc.property(fc.oneof(text(40), text(200)), (name) => {
    const s = FileSafety.safeFileName(name);
    if (!isSafeName(s)) throw new Error('unsafe name ' + JSON.stringify(s));
    if (FileSafety.safeFileName(s) !== s) throw new Error('not idempotent: ' + JSON.stringify(s) + ' -> ' + JSON.stringify(FileSafety.safeFileName(s)));
    return true;
  }));

  // 3. classification ----------------------------------------------------------------------------------------
  const SIGNATURES = [['MZ', 'danger'], ['\x7fELF', 'danger'], ['#!/bin/sh\n', 'danger'], ['\xca\xfe\xba\xbe\x00\x00\x00\x34', 'danger'], ['L\x00\x00\x00\x01\x14\x02\x00', 'danger'],
    [EICAR, 'danger'], ['<!DOCTYPE html><script>', 'danger'], ['<svg xmlns="http://www.w3.org/2000/svg">', 'danger'], ['%PDF-1.7\n', null], ['\x89PNG\r\n\x1a\n', null], ['\xff\xd8\xff', null],
    ['<?xml version="1.0"?><Invoice/>', null], ['PK\x03\x04', null], ['Rar!\x1a\x07', null], ['{\\rtf1', null], ['', null]];
  const DANGEROUS = Array.from(FileSafety.DANGEROUS_EXTENSIONS);
  const fileName = fc.oneof(text(30), fc.tuple(text(12), fc.constantFrom(...DANGEROUS)).map(([b, e]) => b + '.' + e), fc.tuple(text(12), fc.constantFrom('pdf', 'xml', 'png', 'jpg', 'csv', 'txt', 'xlsx', 'zip', '')).map(([b, e]) => b + (e ? '.' + e : '')));
  const mime = fc.constantFrom(undefined, '', 'application/pdf', 'text/xml', 'image/png', 'image/jpeg', 'text/csv', 'application/zip', 'application/octet-stream', 'text/html');
  await property('classification: verdict for every file, programs and dangerous names blocked', runs(3000), fc.property(fc.integer({ min: 0, max: SIGNATURES.length - 1 }), bytesOf(300), fileName, mime, (sig, tail, name, m) => {
    const [prefix, expected] = SIGNATURES[sig];
    const bytes = concat(latin1Bytes(prefix), tail);
    const c = FileSafety.classify(bytes, name, m);
    if (!['ok', 'caution', 'danger'].includes(c.risk)) throw new Error('risk ' + c.risk);
    if (!Array.isArray(c.reasons) || c.reasons.some((r) => typeof r !== 'string')) throw new Error('reasons');
    if (!isSafeName(c.safeName)) throw new Error('unsafe safeName ' + JSON.stringify(c.safeName));
    if (c.downloadName !== (c.risk === 'danger' ? c.safeName + '.gesperrt' : c.safeName)) throw new Error('downloadName ' + c.downloadName + ' for risk ' + c.risk);
    if (expected === 'danger' && c.risk !== 'danger') throw new Error('signature ' + JSON.stringify(prefix) + ' not blocked: ' + c.detected);
    if (FileSafety.DANGEROUS_EXTENSIONS.has(extOf(c.safeName)) && c.risk !== 'danger') throw new Error('dangerous extension not blocked: ' + c.safeName);
    if (BIDI.test(String(name)) && c.risk !== 'danger') throw new Error('bidirectional control not blocked');
    return true;
  }));

  // 4. Base64 ------------------------------------------------------------------------------------------------
  const noise = fc.constantFrom(' ', '\n', '\r\n', '\t', '!', '*', '.', '\\', 'ä', '\u00A0', '\u2028', '\uD83D\uDE00');
  await property('base64: decodes Node\'s Base64 and Base64url, with noise in between', runs(1500), fc.property(bytesOf(600), fc.boolean(), arrayOf(fc.tuple(fc.nat(), noise), 6), (bytes, url, noises) => {
    let b64 = Buffer.from(bytes).toString(url ? 'base64url' : 'base64');
    for (const [at, n] of noises) { const p = at % (b64.length + 1); b64 = b64.slice(0, p) + n + b64.slice(p); }
    const out = FileSafety.decodeBase64(b64);
    if (!(out instanceof Uint8Array) || Buffer.compare(Buffer.from(out), Buffer.from(bytes)) !== 0) throw new Error('decoded ' + out.length + ' bytes, expected ' + bytes.length);
    return true;
  }));
  await property('base64: any text, no exception, bounded output', runs(1500), fc.property(text(400), (s) => {
    const out = FileSafety.decodeBase64(s);
    return out instanceof Uint8Array && out.length <= Math.floor(s.length * 3 / 4);
  }));

  // 5. ZIP ---------------------------------------------------------------------------------------------------
  const entryName = fc.oneof(wellFormedText(20), fc.tuple(wellFormedText(10), fc.constantFrom(...DANGEROUS, 'pdf', 'xml', 'txt', 'png')).map(([b, e]) => b + '.' + e), fc.tuple(wellFormedText(6), wellFormedText(6), fc.constantFrom('exe', 'js', 'txt')).map(([d, b, e]) => d + '/' + b + '.' + e))
    .map((n) => n.replace(/^\[content_types\]\.xml$|^mimetype$|^meta-inf\/manifest\.mf$/i, 'x'));
  const SPECIAL_NAMES = /(^|\/)vbaproject\.bin$|(^|\/)vbadata\.xml$|^\[content_types\]\.xml$|^mimetype$|^content\.xml$|^meta-inf\/manifest\.mf$/i;
  await property('zip: names read exactly, programs inside detected', runs(1500), fc.property(arrayOf(entryName, 8, 1), (names) => {
    const bytes = zip(names.map((name) => ({ name })));
    const read = FileSafety.zipNames(bytes);
    if (!read || read.length !== names.length || read.some((n, i) => n !== names[i])) throw new Error('names ' + JSON.stringify(read));
    if (names.some((n) => SPECIAL_NAMES.test(n))) return true;
    const exec = names.some((n) => FileSafety.DANGEROUS_EXTENSIONS.has(extOf(n)));
    const d = FileSafety.detect(bytes);
    if (d.id !== (exec ? 'zip-exec' : 'zip')) throw new Error('detected ' + d.id);
    return true;
  }));
  await property('zip: damaged archives, no exception', runs(1500), fc.property(arrayOf(entryName, 6, 1), arrayOf(mutation(['PK\x01\x02', 'PK\x05\x06', 'PK\x03\x04', '\xff\xff', '\xff\xff\xff\xff', '\x00\x00']), 6, 1), (names, ops) => {
    const bytes = mutate(zip(names.map((name) => ({ name }))), ops);
    const read = FileSafety.zipNames(bytes);
    if (read !== null && (!Array.isArray(read) || read.some((n) => typeof n !== 'string'))) throw new Error('names ' + typeof read);
    const d = FileSafety.detect(bytes);
    if (!(d.id in FileSafety.TYPE_LABEL)) throw new Error('detected ' + d.id);
    FileSafety.classify(bytes, 'a.zip', 'application/zip');
    return true;
  }));

  // 6. XML encoding ------------------------------------------------------------------------------------------
  const utf16 = (s, le) => { const b = Buffer.from(s, 'utf16le'); if (!le) b.swap16(); return new Uint8Array(b); };
  await property('xml-encoding: UTF-8, UTF-16 and ISO-8859-1 documents decoded exactly', runs(2000), fc.property(wellFormedText(60), fc.integer({ min: 0, max: 5 }), (body, form) => {
    let doc, bytes;
    if (form === 0) { doc = '<?xml version="1.0" encoding="UTF-8"?><a>' + body; bytes = utf8(doc); }
    else if (form === 1) { doc = '<?xml version="1.0" encoding="UTF-8"?><a>' + body; bytes = concat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8(doc)); }
    else if (form === 2) { doc = '<a>' + body; bytes = utf8(doc); }
    else if (form === 3) { doc = '<?xml version="1.0" encoding="UTF-16"?><a>' + body; bytes = concat(new Uint8Array([0xff, 0xfe]), utf16(doc, true)); }
    else if (form === 4) { doc = '<?xml version="1.0" encoding="UTF-16"?><a>' + body; bytes = concat(new Uint8Array([0xfe, 0xff]), utf16(doc, false)); }
    else { doc = '<?xml version="1.0" encoding="ISO-8859-1"?><a>' + Array.from(body).map((c) => String.fromCharCode(c.codePointAt(0) & 0xff)).join(''); bytes = latin1Bytes(doc); }
    const r = XmlEncoding.decode(bytes);
    if (!r.ok || r.text !== doc) throw new Error('form ' + form + ': ok ' + r.ok + ' ' + JSON.stringify(r.errors));
    return true;
  }));
  await property('xml-encoding: an illegal UTF-8 byte is a fatal error', runs(1000), fc.property(wellFormedText(40), fc.nat(), fc.constantFrom(0x80, 0xbf, 0xc0, 0xc1, 0xf5, 0xff), (body, at, bad) => {
    const good = utf8('<?xml version="1.0" encoding="UTF-8"?><a>' + body);
    const p = 1 + at % good.length;
    const r = XmlEncoding.decode(concat(good.subarray(0, p), new Uint8Array([bad]), good.subarray(p)));
    return !r.ok && r.errors.some((e) => e.code === 'XML-ENC-INVALID-BYTES');
  }));
  await property('xml-encoding: any bytes, no exception', runs(2000), fc.property(fc.oneof(bytesOf(64), fc.tuple(fc.constantFrom('', '\xef\xbb\xbf', '\xfe\xff', '\xff\xfe', '\x00<\x00?', '<\x00?\x00', '<?xml version="1.0" encoding="', 'Lo\xa7\x94'), bytesOf(64)).map(([p, t]) => concat(latin1Bytes(p), t))), (bytes) => {
    const r = XmlEncoding.decode(bytes);
    return typeof r.ok === 'boolean' && Array.isArray(r.errors) && (!r.ok || typeof r.text === 'string');
  }));

  // 7. PDF ---------------------------------------------------------------------------------------------------
  const pdfSeeds = activePdfs.cases().map((c) => c.bytes);
  for (const f of seedFiles.filter((x) => /\.pdf$/i.test(x))) { const b = new Uint8Array(fs.readFileSync(f)); if (b.length <= 512 * 1024) pdfSeeds.push(b); }
  await property('pdf: damaged files read, checked and extracted without exception (' + pdfSeeds.length + ' seeds)', runs(400), fc.asyncProperty(fc.integer({ min: 0, max: pdfSeeds.length - 1 }), arrayOf(mutation(PDF_TOKENS), 8, 1), async (k, ops) => {
    const bytes = mutate(pdfSeeds[k], ops);
    const doc = await within(Promise.resolve(PdfEmbedded.loadDocument(bytes)), 'loadDocument');
    if (doc && typeof doc === 'object' && doc.objects) PdfA3Checks.activeContent(doc);
    const ex = await within(Promise.resolve(PdfEmbedded.extractEmbeddedFiles(bytes)), 'extractEmbeddedFiles');
    if (!ex || !Array.isArray(ex.files) || ex.files.some((x) => !(x.bytes instanceof Uint8Array) || (x.name != null && typeof x.name !== 'string'))) throw new Error('extraction result');
    const ck = await within(Promise.resolve(PdfA3Checks.checkContainer(bytes, { extracted: ex })), 'checkContainer');
    if (!ck || !Array.isArray(ck.results) || !Array.isArray(ck.checks)) throw new Error('check result');
    return true;
  }));

  // 8. the whole pipeline ------------------------------------------------------------------------------------
  const xmlSeeds = seedFiles.filter((x) => /\.xml$/i.test(x)).map((f) => new Uint8Array(fs.readFileSync(f))).filter((b) => b.length <= 1024 * 1024);
  if (xmlSeeds.length) {
    const env = createEnv({ exclude: /^PEPPOL-/ });
    const VERDICTS = new Set(['keine-xml', 'nicht-pruefbar', 'format', 'kein-profil', 'pflicht', 'luecke', 'technisch', 'ok', 'unvollstaendig']);
    await property('pipeline: damaged invoices give a verdict (' + xmlSeeds.length + ' seeds)', runs(100), fc.asyncProperty(fc.integer({ min: 0, max: xmlSeeds.length - 1 }), arrayOf(mutation(XML_TOKENS.map((t) => Buffer.from(t, 'utf8').toString('latin1'))), 6, 1), async (k, ops) => {
      const bytes = mutate(xmlSeeds[k], ops);
      const r = await within(PrueferCore.analyzeBytes(env, bytes, 'fuzz.xml'), 'analyzeBytes');
      if (!r || !r.ust || !VERDICTS.has(r.ust.id)) throw new Error('verdict ' + (r && r.ust && r.ust.id));
      return true;
    }));
    // 9. arbitrary text through the whole processing into the CSV files ------------------------------------------
    const base = xmlSeeds.map((b) => Buffer.from(b).toString('utf8')).find((x) => /<cbc:RegistrationName>/.test(x) && /<cac:InvoiceLine>/.test(x));
    if (base) {
      const ELEMENTS = ['cbc:Note', 'cbc:RegistrationName', 'cbc:Name', 'cbc:StreetName', 'cbc:CityName', 'cbc:Description', 'cbc:BuyerReference', 'cbc:ID'];
      const xmlEsc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // characters an XML document can carry (XML 1.0, production Char)
      const xmlText = (max) => wellFormedText(max).map((v) => v.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, ''));
      const legal = env.vatData.legal;
      await property('pipeline-csv: arbitrary invoice texts give well-formed CSV files without formulas', runs(60), fc.asyncProperty(arrayOf(fc.tuple(fc.integer({ min: 0, max: ELEMENTS.length - 1 }), xmlText(30)), 6, 1), text(30), async (edits, name) => {
        let xml = base;
        for (const [e, v] of edits) xml = xml.replace(new RegExp('<' + ELEMENTS[e] + '>([^<]*)</' + ELEMENTS[e] + '>', 'g'), () => '<' + ELEMENTS[e] + '>' + xmlEsc(v) + '</' + ELEMENTS[e] + '>');
        const r = await within(PrueferCore.analyzeBytes(env, utf8(xml), name + '.xml'), 'analyzeBytes');
        if (!r || !r.ust || !VERDICTS.has(r.ust.id)) throw new Error('verdict ' + (r && r.ust && r.ust.id));
        for (const [kind, csvText] of [['findings', Reports.findingsCsv([r], legal)], ['invoices', Reports.invoicesCsv([r])], ['lines', Reports.linesCsv([r])]]) {
          const rows = readCsv(csvText);
          if (rows.some((row) => row.length !== rows[0].length)) throw new Error(kind + ': rows with different numbers of cells');
          for (const row of rows) for (const cell of row) if (EVALUATED.test(cell) && !PLAIN_NUMBER.test(cell)) throw new Error(kind + ': formula cell ' + JSON.stringify(cell));
        }
        return true;
      }));
    } else console.log('  pipeline-csv: no UBL seed invoice with seller name and lines given');
  } else console.log('  pipeline: no XML seed files given');

  console.log('fuzz tests: ' + properties + ' properties, ' + totalRuns + ' runs, ' + failed + ' failed (fast-check ' + fastCheckVersion + ', seed ' + SEED + ')' + (failures.length ? ' – ' + failures.join('; ') : ''));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('fuzz tests: aborted – ' + (e && e.stack || e)); process.exit(1); });
