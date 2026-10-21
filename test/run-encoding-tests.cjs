#!/usr/bin/env node
/*
 * run-encoding-tests.cjs — src/xml-encoding.js (XML 1.0 §4.3.3 / Appendix F) against the JDK XML parser
 * (test/encoding-oracle/EncOracle.java) on a generated matrix of encodings, byte order marks,
 * declarations and malformed byte sequences. For every case the verdict (decodable / fatal error)
 * and the decoded character data of <t> must agree.
 * Usage: node test/run-encoding-tests.cjs [--report file]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const slimdom = require(path.join(root, 'vendor', 'slimdom.cjs'));
const dir = path.join(root, 'build', 'corpus', 'encoding');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const SAMPLE = 'Grüße – Straße 5 € ÄÖÜ ß';
const body = (s) => '<r><t>' + s + '</t></r>';
const cases = [];
// cases where XML 1.0 mandates a fatal error but the JDK parser is lenient: our result must be the
// fatal error required by the specification; the leniency of the reference parser is listed
const specFatal = new Map();
const spec = (id, why) => specFatal.set(id, why);
const add = (id, bytes, note) => { cases.push({ id, note }); fs.writeFileSync(path.join(dir, id + '.xml'), Buffer.from(bytes)); };
const utf8 = (s) => Buffer.from(s, 'utf8');
const latin1 = (s) => Buffer.from(s, 'latin1');
const cp1252 = (s) => Buffer.from(Array.from(s).map((c) => (c === '€' ? 0x80 : c === '–' ? 0x96 : c.charCodeAt(0))));
const utf16le = (s) => Buffer.from(s, 'utf16le');
const utf16be = (s) => { const b = Buffer.from(s, 'utf16le'); for (let i = 0; i + 1 < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; } return b; };
const BOM8 = [0xef, 0xbb, 0xbf], BOMLE = [0xff, 0xfe], BOMBE = [0xfe, 0xff];
const decl = (e) => '<?xml version="1.0"' + (e ? ' encoding="' + e + '"' : '') + '?>';

add('utf8-nodecl', utf8(body(SAMPLE)), 'UTF-8, no declaration');
add('utf8-decl-noenc', utf8(decl(null) + body(SAMPLE)), 'UTF-8, declaration without encoding');
add('utf8-decl-utf8', utf8(decl('UTF-8') + body(SAMPLE)), 'UTF-8 declared');
add('utf8-decl-lower', utf8(decl('utf-8') + body(SAMPLE)), 'utf-8 declared (lower case)');
add('utf8-bom', Buffer.concat([Buffer.from(BOM8), utf8(decl('UTF-8') + body(SAMPLE))]), 'UTF-8 BOM + declaration');
add('utf8-bom-nodecl', Buffer.concat([Buffer.from(BOM8), utf8(body(SAMPLE))]), 'UTF-8 BOM, no declaration');
add('utf8-bom-decl-latin1', Buffer.concat([Buffer.from(BOM8), utf8(decl('ISO-8859-1') + body(SAMPLE))]), 'UTF-8 BOM but ISO-8859-1 declared'); spec('utf8-bom-decl-latin1', 'XML 1.0 §4.3.3: "it is a fatal error for an entity including an encoding declaration to be presented to the XML processor in an encoding other than that named in the declaration" — the UTF-8 BOM presents the entity in UTF-8');
add('latin1-decl', latin1(decl('ISO-8859-1') + body('Grüße Straße ÄÖÜ ß')), 'ISO-8859-1 declared and used');
add('latin15-decl', Buffer.from([...latin1(decl('ISO-8859-15') + '<r><t>Preis '), 0xa4, ...latin1('</t></r>')]), 'ISO-8859-15 (euro sign 0xA4)');
add('cp1252-decl', cp1252(decl('windows-1252') + body('Grüße – 5 €')), 'windows-1252 declared and used');
add('latin1-undeclared', latin1(body('Grüße Straße')), 'ISO-8859-1 bytes without declaration (= UTF-8 → illegal bytes)');
add('latin1-declared-utf8', latin1(decl('UTF-8') + body('Grüße')), 'ISO-8859-1 bytes declared as UTF-8');
add('utf8-declared-latin1', utf8(decl('ISO-8859-1') + body('Grüße')), 'UTF-8 bytes declared as ISO-8859-1 (mojibake, but legal)');
add('utf16le-bom', Buffer.concat([Buffer.from(BOMLE), utf16le(decl('UTF-16') + body(SAMPLE))]), 'UTF-16LE with BOM');
add('utf16be-bom', Buffer.concat([Buffer.from(BOMBE), utf16be(decl('UTF-16') + body(SAMPLE))]), 'UTF-16BE with BOM');
add('utf16le-bom-nodecl', Buffer.concat([Buffer.from(BOMLE), utf16le(body(SAMPLE))]), 'UTF-16LE BOM, no declaration');
add('utf16le-nobom', utf16le(decl('UTF-16') + body(SAMPLE)), 'UTF-16LE without BOM'); spec('utf16le-nobom', 'XML 1.0 §4.3.3: "Entities encoded in UTF-16 MUST and entities encoded in UTF-8 MAY begin with the Byte Order Mark"');
add('utf16be-nobom', utf16be(decl('UTF-16') + body(SAMPLE)), 'UTF-16BE without BOM'); spec('utf16be-nobom', 'XML 1.0 §4.3.3: "Entities encoded in UTF-16 MUST and entities encoded in UTF-8 MAY begin with the Byte Order Mark"');
add('utf16le-bom-decl-utf8', Buffer.concat([Buffer.from(BOMLE), utf16le(decl('UTF-8') + body(SAMPLE))]), 'UTF-16LE BOM but UTF-8 declared');
add('utf8-decl-utf16', utf8(decl('UTF-16') + body(SAMPLE)), 'UTF-8 bytes declared as UTF-16');
add('utf8-truncated-seq', Buffer.concat([utf8(decl('UTF-8') + '<r><t>A'), Buffer.from([0xc3]), utf8('</t></r>')]), 'truncated 2-byte sequence');
add('utf8-overlong', Buffer.concat([utf8(decl('UTF-8') + '<r><t>A'), Buffer.from([0xc0, 0xaf]), utf8('</t></r>')]), 'overlong encoding');
add('utf8-surrogate', Buffer.concat([utf8(decl('UTF-8') + '<r><t>A'), Buffer.from([0xed, 0xa0, 0x80]), utf8('</t></r>')]), 'encoded surrogate');
add('utf8-4byte', utf8(decl('UTF-8') + body('Emoji 😀 𝄞')), 'supplementary characters');
add('ascii-decl', utf8(decl('US-ASCII') + body('plain')), 'US-ASCII declared, ASCII bytes');
add('unknown-enc', utf8(decl('X-UNKNOWN-42') + body('plain')), 'unknown encoding name');
add('ucs4', Buffer.from([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x3c]), 'UCS-4 BOM');
add('ascii-decl-nonascii', latin1(decl('US-ASCII') + body('Grüße')), 'US-ASCII declared, byte 0xFC');
add('cp1252-undefined-81', Buffer.from([...latin1(decl('windows-1252') + '<r><t>A'), 0x81, ...latin1('B</t></r>')]), 'windows-1252 undefined byte 0x81');
add('latin1-c1', Buffer.from([...latin1(decl('ISO-8859-1') + '<r><t>A'), 0x80, 0x96, ...latin1('B</t></r>')]), 'ISO-8859-1 bytes 0x80/0x96 (C1 controls, not windows-1252)');
add('utf8-decl-single-quotes', utf8("<?xml version='1.0' encoding='UTF-8'?>" + body(SAMPLE)), 'single-quoted declaration');

const oracleOut = path.join(root, 'build', 'oracle', 'encoding.jsonl');
fs.mkdirSync(path.dirname(oracleOut), { recursive: true });
execFileSync('javac', ['-d', path.join(root, 'test', 'encoding-oracle'), path.join(root, 'test', 'encoding-oracle', 'EncOracle.java')], { stdio: ['ignore', 'inherit', 'ignore'] });
execFileSync('java', ['-cp', path.join(root, 'test', 'encoding-oracle'), 'EncOracle', oracleOut].concat(cases.map((c) => path.join(dir, c.id + '.xml'))), { stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
const oracle = new Map(fs.readFileSync(oracleOut, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [path.basename(r.file, '.xml'), r]; }));

const lines = [];
const out = (s) => { lines.push(s); console.log(s); };
out('XML encoding detection (src/xml-encoding.js) vs JDK XML parser (Xerces)');
let same = 0, diff = 0, specCases = 0;
for (const c of cases) {
  const o = oracle.get(c.id);
  const r = XmlEncoding.decode(new Uint8Array(fs.readFileSync(path.join(dir, c.id + '.xml'))));
  let oursOk = r.ok, oursText = null;
  if (r.ok) {
    try { const d = slimdom.parseXmlDocument(r.text.replace(/^\uFEFF/, '')); const t = d.getElementsByTagName('t')[0]; oursText = t ? t.textContent : null; } catch (e) { oursOk = false; }
  }
  const required = specFatal.get(c.id);
  if (required) {
    const okSpec = !oursOk && o.wellFormed; // ours: fatal as required; reference: lenient
    if (okSpec) specCases++; else diff++;
    out((okSpec ? '  spec  ' : '  DIFF  ') + c.id.padEnd(26) + ' xerces=' + (o.wellFormed ? 'ok (lenient)' : 'fatal') + '  ours=' + (oursOk ? 'ok' : 'fatal ' + r.errors.map((e) => e.code).join(',')) + '   (' + c.note + ') — ' + required);
    continue;
  }
  const agree = oursOk === o.wellFormed && (!oursOk || oursText === o.text);
  if (agree) same++; else diff++;
  out((agree ? '  ok    ' : '  DIFF  ') + c.id.padEnd(26) + ' xerces=' + (o.wellFormed ? 'ok ' + o.encoding : 'fatal') + '  ours=' + (oursOk ? 'ok ' + r.encoding : 'fatal ' + r.errors.map((e) => e.code).join(',')) + '   (' + c.note + ')' + (agree ? '' : '\n        xerces: ' + (o.error || JSON.stringify(o.text)) + '\n        ours:   ' + JSON.stringify(oursText)));
}
out('');
out(`XML encoding tests: ${cases.length} cases, ${same} identical verdicts and text, ${specCases} fatal as required by XML 1.0 §4.3.3 where the JDK parser is lenient, ${diff} different`);
const rf = (() => { const i = process.argv.indexOf('--report'); return i >= 0 ? process.argv[i + 1] : null; })();
if (rf) fs.writeFileSync(rf, lines.join('\n') + '\n');
process.exit(diff ? 1 : 0);
