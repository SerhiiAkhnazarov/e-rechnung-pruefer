#!/usr/bin/env node
/*
 * run-facturx-xsd-tests.cjs — src/xsd-validator.js with the Factur-X / ZUGFeRD ZF_250 profile models
 * (build/xsd/FACTUR-X-<PROFILE>.json, compiled by tools/compile-xsd.cjs from the Mustangproject copies
 * of the FNFE-MPE/FeRD XSDs) against JDK Xerces (test/xsd-oracle/run-facturx-xsd-oracle.sh, --schema
 * mode): for every profile and every CII corpus document the VERDICT must be identical (exit code 1
 * otherwise), and the multiset of error codes (Xerces message keys, incl. the occurrence codes
 * cvc-complex-type.2.4.e/f/i/j of bounded repetitions such as ram:SpecifiedTaxRegistration
 * maxOccurs="2") must be identical as well (exit code 1 otherwise).
 *
 * Usage: node test/run-facturx-xsd-tests.cjs [--verbose] [--report file]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const ri = args.indexOf('--report');
const reportFile = ri >= 0 ? args[ri + 1] : null;
const oracleDir = path.join(root, 'build', 'oracle', 'xsd-facturx');
const PROFILES = ['MINIMUM', 'BASIC-WL', 'BASIC', 'EN16931', 'EXTENDED'];
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };
const docs = new Map(); // file -> parsed document (or Error)
function load(file) {
  if (!docs.has(file)) {
    try { docs.set(file, slimdom.parseXmlDocument(fs.readFileSync(file, 'utf8'))); } catch (e) { docs.set(file, e); }
  }
  return docs.get(file);
}
const xercesCode = (e) => { const m = /^([A-Za-z][A-Za-z0-9.-]*?)(?=:)/.exec(e.message); return m ? m[1] : '?'; };
out('Factur-X/ZUGFeRD ZF_250 XSD models: src/xsd-validator.js vs JDK Xerces — verdict and error-code comparison');
let tDocs = 0, tSame = 0, tMis = 0, tMs = 0, tVerdictMis = 0, tKnownCode = 0, tOtherCode = 0;
const mismatches = [];
for (const p of PROFILES) {
  const id = 'FACTUR-X-' + p;
  const modelFile = path.join(root, 'build', 'xsd', id + '.json');
  const v = XV.create(JSON.parse(fs.readFileSync(modelFile, 'utf8')));
  const rows = fs.readFileSync(path.join(oracleDir, id + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let same = 0, mis = 0, valid = 0, ms = 0;
  for (const row of rows) {
    tDocs++;
    const doc = load(row.file);
    let ours;
    if (doc instanceof Error) ours = { valid: false, errors: [{ code: 'xml' }] };
    else { const t0 = process.hrtime.bigint(); ours = v.validate(doc); const dt = Number(process.hrtime.bigint() - t0) / 1e6; ms += dt; tMs += dt; }
    if (row.valid) valid++;
    const ourCodes = doc instanceof Error ? '' : ours.errors.map((e) => e.code).sort().join(' ');
    const xCodes = doc instanceof Error ? '' : row.errors.filter((e) => e.severity !== 'warning').map(xercesCode).sort().join(' ');
    if (ours.valid !== row.valid) { tVerdictMis++; }
    else if (ourCodes !== xCodes) tOtherCode++;
    if (ours.valid === row.valid && ourCodes === xCodes) { same++; tSame++; }
    else { mis++; tMis++; mismatches.push({ id, file: row.file, row, ours, ourCodes, xCodes }); }
    if (verbose) console.log((ours.valid === row.valid ? 'ok   ' : 'DIFF ') + id + ' ' + row.file);
  }
  const vmis = mismatches.filter((m) => m.id === id && m.ours.valid !== m.row.valid).length;
  out(id.padEnd(20) + ' documents ' + String(rows.length).padStart(5) + '   xerces valid ' + String(valid).padStart(4) + '   verdict mismatches ' + vmis + '   identical verdicts+codes ' + String(same).padStart(5) + '   code-only differences ' + (mis - vmis) + '   our time ' + ms.toFixed(0) + ' ms   model ' + fs.statSync(modelFile).size + ' bytes');
}
for (const m of mismatches) {
  out('MISMATCH ' + m.id + ' ' + path.relative(root, m.file) + ' xerces=' + (m.row.valid ? 'valid' : 'invalid') + ' [' + m.xCodes + '] ours=' + (m.ours.valid ? 'valid' : 'invalid') + ' [' + m.ourCodes + ']');
  for (const e of m.row.errors.slice(0, 3)) out('    xerces ' + e.message.slice(0, 200));
  for (const e of m.ours.errors.slice(0, 3)) out('    ours   ' + e.code + ' ' + (e.location || '') + ' ' + (e.message || '').slice(0, 200));
}
out('');
out(`Factur-X XSD vs Xerces: ${tDocs} document×profile verdicts, ${tDocs - tVerdictMis} identical verdicts, ${tVerdictMis} verdict mismatches; error codes identical ${tSame}, code differences ${tOtherCode}; our time ${tMs.toFixed(0)} ms`);
if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, lines.join('\n') + '\n'); }
process.exit(tVerdictMis || tOtherCode ? 1 : 0);
