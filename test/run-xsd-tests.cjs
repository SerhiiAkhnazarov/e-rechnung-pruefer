#!/usr/bin/env node
/*
 * run-xsd-tests.cjs — runs src/xsd-validator.js (with the models in build/xsd/) over every
 * document the Xerces reference (test/xsd-oracle) has judged and compares the VERDICTS.
 *
 * Reads build/oracle/xsd/*.jsonl (written by test/xsd-oracle/run-xsd-oracle.sh); for each line
 * the document is parsed with slimdom, validated with the model selected by the root namespace
 * (the same rule as the oracle: Invoice-2 -> UBL-Invoice, CreditNote-2 -> UBL-CreditNote,
 * CII:100 -> CII-D16B, anything else -> UBL-Invoice) and the verdicts are compared.
 *
 * Usage: node test/run-xsd-tests.cjs [--verbose] [--only <corpus>] [--report build/reports/xsd-vs-xerces.txt]
 *                                   [--big <large-invoice.xml>]   (timing of one large document)
 *
 * Exit code 1 when any verdict differs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const only = opt('--only');
const reportFile = opt('--report');
const bigFile = opt('--big');

const NS_CN = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const NS_CII = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';

const models = {};
const modelLoadMs = {};
function validator(id) {
  if (!models[id]) {
    const t0 = process.hrtime.bigint();
    models[id] = XV.create(JSON.parse(fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8')));
    modelLoadMs[id] = Number(process.hrtime.bigint() - t0) / 1e6;
  }
  return models[id];
}

const oracleDir = path.join(root, 'build', 'oracle', 'xsd');
const files = fs.readdirSync(oracleDir).filter((f) => f.endsWith('.jsonl')).sort();
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };

out('XSD validation: src/xsd-validator.js vs JDK Xerces (javax.xml.validation) — verdict and error-code comparison');
out('date: ' + new Date().toISOString());
out('');
let totalCodeIdentical = 0;
let totalDocs = 0, totalIdentical = 0, totalMismatch = 0, totalValid = 0, totalInvalid = 0, parseFailures = 0;
let totalOurMs = 0;
const mismatches = [];
for (const f of files) {
  const corpus = f.replace(/\.jsonl$/, '');
  if (only && corpus !== only) continue;
  const rows = fs.readFileSync(path.join(oracleDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let identical = 0, mismatch = 0, valid = 0, invalid = 0, ms = 0, codeIdentical = 0;
  for (const row of rows) {
    totalDocs++;
    const file = path.isAbsolute(row.file) ? row.file : path.join(root, row.file);
    let doc;
    try {
      doc = slimdom.parseXmlDocument(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      // not well-formed for slimdom: Xerces must have failed too (fatal) for the verdicts to agree
      parseFailures++;
      const ours = { valid: false, errors: [{ code: 'xml', message: 'nicht wohlgeformt: ' + e.message }] };
      if (ours.valid === row.valid) { identical++; totalIdentical++; codeIdentical++; totalCodeIdentical++; } else { mismatch++; totalMismatch++; mismatches.push({ corpus, file: row.file, oracle: row, ours }); }
      if (row.valid) valid++; else invalid++;
      continue;
    }
    const ns = doc.documentElement.namespaceURI;
    const id = ns === NS_CN ? 'UBL-CreditNote-2.1' : ns === NS_CII ? 'CII-D16B' : 'UBL-Invoice-2.1';
    const v = validator(id);
    const t0 = process.hrtime.bigint();
    const ours = v.validate(doc);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    ms += dt; totalOurMs += dt;
    if (row.valid) { valid++; totalValid++; } else { invalid++; totalInvalid++; }
    // verdict AND the multiset of error codes (Xerces message keys: cvc-…, UndeclaredPrefix, …) must agree
    const ourCodes = ours.errors.map((e) => e.code).sort().join(' ');
    const xercesCodes = row.errors.filter((e) => e.severity !== 'warning').map((e) => { const m = /^([A-Za-z][A-Za-z0-9.-]*?)(?=:)/.exec(e.message); return m ? m[1] : '?'; }).sort().join(' ');
    const codesSame = ourCodes === xercesCodes;
    if (codesSame) { codeIdentical++; totalCodeIdentical++; }
    if (ours.valid === row.valid && codesSame) { identical++; totalIdentical++; }
    else { mismatch++; totalMismatch++; mismatches.push({ corpus, file: row.file, oracle: row, ours, schema: id, ourCodes, xercesCodes }); }
    if (verbose) console.log((ours.valid === row.valid ? '  ok   ' : '  DIFF ') + row.file + '  xerces=' + (row.valid ? 'valid' : 'invalid') + ' ours=' + (ours.valid ? 'valid' : 'invalid'));
  }
  out(corpus.padEnd(16) + ' documents ' + String(rows.length).padStart(5) + '   xerces valid ' + String(valid).padStart(5) + '   invalid ' + String(invalid).padStart(5)
    + '   identical verdicts+codes ' + String(identical).padStart(5) + '   mismatches ' + String(mismatch).padStart(3) + '   our time ' + ms.toFixed(0).padStart(6) + ' ms');
}
out('');
out('TOTAL'.padEnd(16) + ' documents ' + String(totalDocs).padStart(5) + '   xerces valid ' + String(totalValid).padStart(5) + '   invalid ' + String(totalInvalid).padStart(5)
  + '   identical verdicts+codes ' + String(totalIdentical).padStart(5) + '   mismatches ' + String(totalMismatch).padStart(3) + '   our time ' + totalOurMs.toFixed(0).padStart(6) + ' ms');
out('error-code multisets identical to Xerces: ' + totalCodeIdentical + ' of ' + totalDocs + ' documents');
if (parseFailures) out('documents slimdom could not parse: ' + parseFailures);
out('model load time (parse JSON + create): ' + Object.entries(modelLoadMs).map(([k, v]) => k + ' ' + v.toFixed(0) + ' ms').join(', '));
out('');
out('MODELS (build/xsd)');
for (const id of ['UBL-Invoice-2.1', 'UBL-CreditNote-2.1', 'CII-D16B']) {
  const file = path.join(root, 'build', 'xsd', id + '.json');
  if (!fs.existsSync(file)) continue;
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  out('  ' + id + '.json: ' + fs.statSync(file).size + ' bytes, ' + m.types.length + ' types, ' + Object.keys(m.elements).length + ' global elements, roots ' + m.roots.join('+'));
  for (const s of m.sources) out('      ' + s.sha256 + '  ' + s.file + ' (' + s.bytes + ' bytes)');
}
if (bigFile && fs.existsSync(bigFile)) {
  const xml = fs.readFileSync(bigFile, 'utf8');
  let t0 = process.hrtime.bigint();
  const doc = slimdom.parseXmlDocument(xml);
  const parseMs = Number(process.hrtime.bigint() - t0) / 1e6;
  let elements = 0; (function walk(n) { for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) { elements++; walk(c); } })(doc);
  const ns = doc.documentElement.namespaceURI;
  const id = ns === NS_CN ? 'UBL-CreditNote-2.1' : ns === NS_CII ? 'CII-D16B' : 'UBL-Invoice-2.1';
  const fresh = XV.create(JSON.parse(fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8')));
  const runs = [];
  let verdict = null;
  for (let i = 0; i < 5; i++) { t0 = process.hrtime.bigint(); const r = fresh.validate(doc); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); verdict = r.valid; }
  out('');
  out('TIMING ' + bigFile + ': ' + (xml.length / 1e6).toFixed(2) + ' MB, ' + elements + ' elements, valid=' + verdict);
  out('  slimdom parse ' + parseMs.toFixed(0) + ' ms; validate (Node ' + process.version + ') ' + runs.map((x) => x.toFixed(1) + ' ms').join(', ') + ' — first run includes the lazy automaton construction');
}
if (mismatches.length) {
  out('');
  out('MISMATCHES');
  for (const m of mismatches) {
    out('--- ' + m.file + ' [' + m.corpus + '] xerces=' + (m.oracle.valid ? 'valid' : 'invalid') + ' ours=' + (m.ours.valid ? 'valid' : 'invalid'));
    for (const e of m.oracle.errors.slice(0, 5)) out('    xerces ' + e.line + ':' + e.column + ' ' + e.message.slice(0, 300));
    for (const e of m.ours.errors.slice(0, 5)) out('    ours   ' + e.code + ' ' + (e.location || '') + ' ' + e.message.slice(0, 300));
  }
}
if (reportFile) {
  fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
  fs.writeFileSync(reportFile, lines.join('\n') + '\n');
  console.log('report written to ' + reportFile);
}
process.exit(totalMismatch ? 1 : 0);
