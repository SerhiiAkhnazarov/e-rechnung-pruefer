#!/usr/bin/env node
/*
 * run-facturx-tests.cjs — the ZUGFeRD corpus (github.com/ZUGFeRD/corpus; XML files and the invoice XML
 * embedded in the PDFs, materialised by test/build-corpus.cjs --zugferd into build/corpus/zugferd-cii)
 * against the Factur-X / ZUGFeRD ZF_250 rule sets, grouped by profile.
 *
 * Profile selection: GuidelineSpecifiedDocumentContextParameter/ram:ID looked up in build/rulesets.json
 * (CII section, first match wins). For each document: XML Schema of the profile (src/xsd-validator.js,
 * build/xsd/), then the rule sets of the entry (build/schemas/), as Mustang's ZUV does
 * (XMLValidator.java: profile XSD, profile Schematron, + EN16931-CII for BASIC/EN16931).
 *
 * Expectations (corpus README: "ZUGFeRD validators should (not report errors in the correct files and)
 * additionally flag the errors in the incorrect files"): documents below ZUGFeRDv2/correct/ and
 * PEPPOL/Valid/ are expected to be error-free, documents below ZUGFeRDv2/fail/ to show errors. The
 * corpus collects files of several ZUGFeRD/Factur-X releases (2.0 … 2.5) and the "fail" files are
 * partly PDF defects (PDF/A, XMP) invisible to XML validation, so the expectations are reported, not
 * enforced. Enforced (exit code 1): every finding (rule id, count) of every document equals the Saxon
 * reference SVRL of the same rule set (build/oracle/zugferd-cii/<set>/, test/run-oracle.sh) and no
 * processing error occurs where Saxon processed the document.
 *
 * Usage: node test/run-facturx-tests.cjs [--verbose] [--report file]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const ri = args.indexOf('--report');
const reportFile = ri >= 0 ? args[ri + 1] : null;
const corpusDir = path.join(root, 'build', 'corpus', 'zugferd-cii');
const oracleDir = path.join(root, 'build', 'oracle', 'zugferd-cii');
const rulesets = JSON.parse(fs.readFileSync(path.join(root, 'build', 'rulesets.json'), 'utf8'));
const SVRL_NS = 'http://purl.oclc.org/dsdl/svrl';
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };

const schemas = {}, xsds = {};
const schema = (id) => schemas[id] || (schemas[id] = SR.create(fx, JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', id + '.json'), 'utf8'))));
const xsd = (id) => xsds[id] || (xsds[id] = XV.create(JSON.parse(fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8'))));

function guidelineId(doc) {
  const de = doc.documentElement;
  for (const c of de.childNodes) if (c.nodeType === 1 && c.localName === 'ExchangedDocumentContext')
    for (const g of c.childNodes) if (g.nodeType === 1 && g.localName === 'GuidelineSpecifiedDocumentContextParameter')
      for (const i of g.childNodes) if (i.nodeType === 1 && i.localName === 'ID') return i.textContent.replace(/\s+/g, ' ').trim();
  return null;
}
function lookup(id) {
  if (id === null) return null;
  return rulesets.CII.find((e) => (e.match === 'prefix' ? id.startsWith(e.id) : id === e.id)) || null;
}
function expectation(file) {
  if (/^ZUGFeRDv2_correct_/.test(file) || /^PEPPOL_Valid_/.test(file)) return 'valid';
  if (/^ZUGFeRDv2_fail_/.test(file)) return 'invalid';
  return null;
}
function saxonCounts(set, file) {
  const failed = fs.existsSync(path.join(oracleDir, set + '.failed')) && fs.readFileSync(path.join(oracleDir, set + '.failed'), 'utf8').split('\n').includes(file);
  if (failed) return 'dynamic-error';
  const p = path.join(oracleDir, set, file);
  if (!fs.existsSync(p)) return null;
  const counts = {};
  const sdoc = slimdom.parseXmlDocument(fs.readFileSync(p, 'utf8'));
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === SVRL_NS && (c.localName === 'failed-assert' || c.localName === 'successful-report')) { const id = c.getAttribute('id') || '(no id)'; counts[id] = (counts[id] || 0) + 1; }
      walk(c);
    }
  })(sdoc);
  return counts;
}

const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.xml')).sort();
const groups = {};
let saxonEqual = 0, saxonDiff = 0, saxonMissing = 0, bothDynamic = 0, tMs = 0;
const diffs = [];
const expectRows = [];
for (const file of files) {
  const doc = slimdom.parseXmlDocument(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
  const gid = guidelineId(doc);
  const entry = lookup(gid);
  const key = (gid || '(kein GuidelineSpecifiedDocumentContextParameter/ram:ID)') + (entry ? '  →  ' + entry.ruleSets.join(' + ') + ' | XSD ' + entry.xsd : '  →  (keine Zuordnung)');
  const g = groups[key] || (groups[key] = { docs: 0, xsdInvalid: 0, withErrors: 0, expValid: 0, expValidOk: 0, expInvalid: 0, expInvalidOk: 0 });
  g.docs++;
  if (!entry) continue;
  const t0 = Date.now();
  const xr = xsd(entry.xsd).validate(doc);
  if (!xr.valid) g.xsdInvalid++;
  let errors = 0;
  const ids = {};
  for (const set of entry.ruleSets) {
    const rep = schema(set).validate(doc);
    const ours = {};
    for (const f of rep.findings) { ours[f.id || '(no id)'] = (ours[f.id || '(no id)'] || 0) + 1; if (f.level === 'error') { errors++; const k = f.id || ('ohne id: "' + f.text.slice(0, 60) + '"'); ids[k] = (ids[k] || 0) + 1; } }
    const sx = saxonCounts(set, file);
    if (sx === null) saxonMissing++;
    else if (sx === 'dynamic-error') { if (rep.processingErrors.length) bothDynamic++; else { saxonDiff++; diffs.push(file + ' [' + set + '] Saxon dynamic error, ours none'); } }
    else {
      const a = JSON.stringify(Object.entries(ours).sort()), b = JSON.stringify(Object.entries(sx).sort());
      if (a === b && !rep.processingErrors.length) saxonEqual++;
      else { saxonDiff++; diffs.push(file + ' [' + set + '] ours ' + a + ' Saxon ' + b + (rep.processingErrors.length ? ' processing errors ' + rep.processingErrors.length : '')); }
    }
  }
  tMs += Date.now() - t0;
  const invalid = !xr.valid || errors > 0;
  if (errors) g.withErrors++;
  const exp = expectation(file);
  if (exp === 'valid') { g.expValid++; if (!invalid) g.expValidOk++; else expectRows.push({ file, exp, xsd: xr, ids }); }
  if (exp === 'invalid') { g.expInvalid++; if (invalid) g.expInvalidOk++; else expectRows.push({ file, exp, xsd: xr, ids }); }
  if (verbose) console.log((invalid ? 'INVALID ' : 'valid   ') + file + '  ' + Object.keys(ids).join(','));
}
out('ZUGFeRD corpus (build/corpus/zugferd-cii, ' + files.length + ' CII documents) by GuidelineSpecifiedDocumentContextParameter/ram:ID');
out('');
for (const [k, g] of Object.entries(groups).sort()) {
  out(String(g.docs).padStart(4) + '  ' + k);
  if (g.docs && !k.endsWith('(keine Zuordnung)')) out('        XSD-ungültig ' + g.xsdInvalid + ', mit Schematron-Fehlern ' + g.withErrors + (g.expValid ? ', erwartet gültig (correct/, PEPPOL/Valid) ' + g.expValid + ' → gültig ' + g.expValidOk : '') + (g.expInvalid ? ', erwartet fehlerhaft (fail/) ' + g.expInvalid + ' → beanstandet ' + g.expInvalidOk : ''));
}
out('');
out('Expectation deviations (directory semantics of the corpus README; every one is confirmed by the Saxon reference below):');
for (const r of expectRows) out('  ' + (r.exp === 'valid' ? 'correct-but-rejected ' : 'fail-but-accepted    ') + r.file + (r.xsd.valid ? '' : '  XSD: ' + r.xsd.errors.slice(0, 2).map((e) => e.code + ' ' + (e.location || '')).join('; ')) + (Object.keys(r.ids).length ? '  rules: ' + Object.entries(r.ids).map(([k, n]) => k + (n > 1 ? '×' + n : '')).join(', ') : ''));
out('');
for (const d of diffs) out('SAXON-DIFF ' + d);
const expValid = Object.values(groups).reduce((a, g) => a + g.expValid, 0), expValidOk = Object.values(groups).reduce((a, g) => a + g.expValidOk, 0);
const expInvalid = Object.values(groups).reduce((a, g) => a + g.expInvalid, 0), expInvalidOk = Object.values(groups).reduce((a, g) => a + g.expInvalidOk, 0);
out(`Factur-X corpus tests: ${files.length} documents; expected valid ${expValid} -> valid ${expValidOk}; expected invalid ${expInvalid} -> flagged ${expInvalidOk}; Saxon comparisons ${saxonEqual} identical, ${bothDynamic} both dynamic error, ${saxonDiff} different, ${saxonMissing} without oracle; ${tMs} ms`);
if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, lines.join('\n') + '\n'); }
process.exit(saxonDiff || saxonMissing ? 1 : 0);
