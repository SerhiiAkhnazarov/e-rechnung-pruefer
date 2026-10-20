#!/usr/bin/env node
/*
 * compare-kosit.cjs — compares validator reports in the varl format (http://www.xoev.de/de/validator/varl/1,
 * produced by the official KoSIT validator or by test/kosit-reference/KositReference.java with the XRechnung
 * configuration) with the JSON reports of tools/pruefer-cli.cjs for the same input documents.
 *
 * Comparable fields (per document):
 *   scenario     rep:scenarioMatched/s:scenario/s:name  <->  json.scenario
 *   xsd          validationStepResult[@id='val-xsd']/@valid  <->  json.xsd.valid   (only with a scenario)
 *   messages     multiset of (code | level after customLevel | canonical location) of the val-sch.* steps
 *                <-> json.findings (id | level | location)                           (only when schema-valid)
 *   assessment   rep:assessment/rep:accept|rep:reject (+ processing error)  <->  json.assessment
 *
 * Level after customLevel: default-report.xsl writes the ORIGINAL level into rep:message/@level and applies
 * s:customLevel only in rep:custom-level() (assessment + HTML); here the custom level is re-applied exactly
 * like rep:custom-level(): $custom-levels[tokenize(., '\s+') = @code]/@level, else @level.
 *
 * Locations are canonicalised to /local[n]/local[n]/@attr so that the three notations can be compared:
 *   ISO skeleton    /*:Invoice[namespace-uri()='…'][1]/*:ID[namespace-uri()='…'][1]/@*[local-name()='x' and namespace-uri()='…']
 *   SchXslt 1.x     /Q{urn:…}Invoice[1]/Q{urn:…}ID[1]/@Q{}x   (what the official release ships)
 *   Prüfer          /ubl:Invoice[1]/cbc:ID[1]/@x
 *
 * Documents without a KoSIT scenario: the KoSIT validator always rejects them with its fallback report; the
 * Prüfer validates such documents informatively (EN 16931 rules). For them only the field "scenario" is
 * compared; the assessment is counted as "not comparable (no scenario)" and is not a mismatch.
 *
 * Usage: node compare-kosit.cjs <report-dir> <pruefer-json-dir> [--out <summary.txt>] [--verbose]
 *        node compare-kosit.cjs --selftest        (location canonicalisation of the three notations)
 *   both directories are searched recursively; reports are paired by base name (<name>-report.xml <->
 *   <name>.xml.report.json; the relative sub-directory is used when the same base name occurs twice).
 * Exit code 1 when a comparable field differs for at least one document.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));

const args = process.argv.slice(2);
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
if (args.includes('--selftest')) { selftest(); process.exit(0); }
const verbose = args.includes('--verbose');
const outFile = opt('--out');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [reportDir, jsonDir] = positional;
if (!reportDir || !jsonDir) { console.error('usage: compare-kosit.cjs <report-dir> <pruefer-json-dir> [--out summary.txt] [--verbose]'); process.exit(2); }

const REP = 'http://www.xoev.de/de/validator/varl/1';
const S = 'http://www.xoev.de/de/validator/framework/1/scenarios';

function walk(dir, pred, out = [], rel = '') {
  for (const e of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, pred, out, rel ? rel + '/' + e : e);
    else if (pred(e)) out.push({ file: p, rel, name: e });
  }
  return out;
}

function els(n, ns, local) {
  const out = [];
  (function w(x) { for (let c = x.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) { if (c.localName === local && c.namespaceURI === ns) out.push(c); w(c); } } })(n);
  return out;
}
function childEl(n, ns, local) { for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === local && c.namespaceURI === ns) return c; return null; }

// ---------------------------------------------------------------------------------------------------------
// location canonicalisation
// ---------------------------------------------------------------------------------------------------------
function canonLocation(loc) {
  if (loc == null) return null;
  let s = String(loc).trim();
  if (s === '' ) return '';
  // ISO skeleton attribute form: /@*[local-name()='x' and namespace-uri()='…']
  s = s.replace(/@\*\[local-name\(\)='([^']*)'\s+and\s+namespace-uri\(\)='[^']*'\]/g, '@$1');
  // ISO skeleton element form: *:local[namespace-uri()='…'][n]
  s = s.replace(/\*:([A-Za-z_][\w.\-]*)\[namespace-uri\(\)='[^']*'\]/g, '$1');
  // SchXslt EQName form: Q{uri}local  (also @Q{}attr)
  s = s.replace(/Q\{[^}]*\}/g, '');
  // prefixed names (Prüfer / skeleton notation 2): prefix:local
  s = s.replace(/(^|\/|@)([A-Za-z_][\w.\-]*):([A-Za-z_][\w.\-]*)/g, '$1$3');
  // positions: add [1] where missing on element steps (SchXslt always has them, skeleton too; be lenient)
  s = s.split('/').map((step) => {
    if (step === '' || step.startsWith('@') || step.includes('(')) return step;
    return /\[\d+\]$/.test(step) ? step : step + '[1]';
  }).join('/');
  return s;
}

function selftest() {
  const cases = [
    ["/*:Invoice[namespace-uri()='urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'][1]/*:TaxTotal[namespace-uri()='urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'][2]/@*[local-name()='currencyID' and namespace-uri()='']", '/Invoice[1]/TaxTotal[2]/@currencyID'],
    ["/*:Invoice[namespace-uri()='urn:x'][1]/*:ID[namespace-uri()='urn:y'][1]/@schemeID", '/Invoice[1]/ID[1]/@schemeID'],
    ['/Q{urn:oasis:names:specification:ubl:schema:xsd:Invoice-2}Invoice[1]/Q{urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2}TaxTotal[2]/@Q{}currencyID', '/Invoice[1]/TaxTotal[2]/@currencyID'],
    ['/Q{urn:x}Invoice[1]/Q{urn:y}ID[1]/@Q{http://www.w3.org/2001/XMLSchema-instance}type', '/Invoice[1]/ID[1]/@type'],
    ['/ubl:Invoice[1]/cac:TaxTotal[2]/@currencyID', '/Invoice[1]/TaxTotal[2]/@currencyID'],
    ['/rsm:CrossIndustryInvoice[1]/rsm:SupplyChainTradeTransaction[1]/ram:IncludedSupplyChainTradeLineItem[3]/@xsi:type', '/CrossIndustryInvoice[1]/SupplyChainTradeTransaction[1]/IncludedSupplyChainTradeLineItem[3]/@type'],
    ['/', '/'],
  ];
  let failed = 0;
  for (const [input, expected] of cases) {
    const got = canonLocation(input);
    if (got !== expected) { failed++; console.log('FAIL ' + input + '\n  got      ' + got + '\n  expected ' + expected); }
  }
  console.log(`canonLocation self-test: ${cases.length - failed}/${cases.length} ok`);
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------
// KoSIT report
// ---------------------------------------------------------------------------------------------------------
function parseReport(file) {
  const doc = slimdom.parseXmlDocument(fs.readFileSync(file, 'utf8'));
  const report = doc.documentElement;
  const scenarioMatched = childEl(report, REP, 'scenarioMatched');
  const scenarioEl = scenarioMatched ? childEl(scenarioMatched, S, 'scenario') : null;
  const scenarioName = scenarioEl ? (childEl(scenarioEl, S, 'name') || { textContent: '' }).textContent.trim() : null;
  // custom levels exactly as default-report.xsl: //s:customLevel, tokenised on whitespace
  const customLevels = new Map();
  for (const cl of els(doc, S, 'customLevel')) for (const id of cl.textContent.trim().split(/\s+/)) if (id && !customLevels.has(id)) customLevels.set(id, cl.getAttribute('level'));
  const steps = els(doc, REP, 'validationStepResult');
  const xsd = steps.find((s) => s.getAttribute('id') === 'val-xsd');
  const messages = [];
  let processingErrorMessage = false;
  for (const s of steps) {
    if (!/^val-sch/.test(s.getAttribute('id') || '')) continue;
    for (const m of els(s, REP, 'message')) {
      const code = m.getAttribute('code');
      if (code === 'PROCESSING_ERROR') { processingErrorMessage = true; continue; }
      const level = m.getAttribute('level');
      messages.push({ code, level, customLevel: customLevels.has(code) ? customLevels.get(code) : level, location: m.getAttribute('xpathLocation') });
    }
  }
  // XML Schema messages of the val-xsd step: codes in document order (Xerces error codes)
  const xsdCodes = xsd ? els(xsd, REP, 'message').map((m) => m.getAttribute('code')) : [];
  const assessment = childEl(report, REP, 'assessment');
  const accept = assessment && childEl(assessment, REP, 'accept');
  const reject = assessment && childEl(assessment, REP, 'reject');
  const html = assessment ? assessment.textContent : '';
  // default-report.xsl html:assessment: this sentence appears only with $has-processing-error
  const processingError = /nicht automatisiert angenommen werden/.test(html) || processingErrorMessage;
  return {
    xsdCodes,
    valid: report.getAttribute('valid'),
    scenarioName,
    xsdValid: xsd ? xsd.getAttribute('valid') === 'true' : null,
    schematronRan: steps.some((s) => /^val-sch/.test(s.getAttribute('id') || '')),
    messages,
    assessment: accept ? 'accept' : reject ? 'reject' : 'none',
    processingError,
  };
}

// ---------------------------------------------------------------------------------------------------------
// pairing
// ---------------------------------------------------------------------------------------------------------
const reports = walk(reportDir, (f) => f.endsWith('-report.xml'));
const jsons = walk(jsonDir, (f) => f.endsWith('.report.json'));
const reportIndex = new Map();
for (const r of reports) {
  const base = r.name.replace(/-report\.xml$/, '');
  const key = r.rel + '/' + base;
  reportIndex.set(key, r);
  if (!reportIndex.has('/' + base)) reportIndex.set('/' + base, r);
}

const lines = [];
const out = (s) => { lines.push(s); console.log(s); };
const stats = {
  pairs: 0, missingReport: 0,
  scenarioSame: 0, scenarioDiff: 0,
  xsdCompared: 0, xsdSame: 0, xsdDiff: 0,
  messagesCompared: 0, messagesSame: 0, messagesDiff: 0,
  assessmentCompared: 0, assessmentSame: 0, assessmentDiff: 0, assessmentNotComparable: 0, xrAcceptSame: 0, xrAcceptDiff: 0, xsdCodesCompared: 0, xsdCodesSame: 0, xsdCodesDiff: 0,
  processingErrorBoth: 0, processingErrorDiff: 0,
};
const perDir = new Map();
const mismatches = [];
const byScenario = new Map();

for (const j of jsons) {
  // report name of the KoSIT validator (observed identically for the original JAR 1.6.3 and the re-implementation):
// the file name loses a trailing ".xml" (any case) when the input is named, and once more in
// cmd/DefaultNamingStrategy.createName: X.xml -> X, X.pdf.xml -> X.pdf, X.XML.xml -> X
const base = j.name.replace(/\.report\.json$/, '').replace(/\.xml$/i, '').replace(/\.xml$/i, '');
  const r = reportIndex.get(j.rel + '/' + base) || reportIndex.get('/' + base);
  if (!r) { stats.missingReport++; if (verbose) out(`MISSING report for ${j.rel}/${base}`); continue; }
  stats.pairs++;
  const dirStat = perDir.get(j.rel) || { docs: 0, mismatches: 0, noScenario: 0, xsdInvalid: 0 };
  perDir.set(j.rel, dirStat);
  dirStat.docs++;
  const k = parseReport(r.file);
  const o = JSON.parse(fs.readFileSync(j.file, 'utf8'));
  const label = (j.rel ? j.rel + '/' : '') + base;
  const problems = [];

  // 1. processing errors (not well-formed etc.): both sides must agree
  const oursPE = o.assessment === 'not-processable';
  if (k.processingError || oursPE) {
    if (k.processingError && oursPE) { stats.processingErrorBoth++; }
    else { stats.processingErrorDiff++; problems.push(`processing error: KoSIT=${k.processingError} ours=${oursPE} (ours: ${(o.warnings || []).join('; ')})`); }
  }

  // 2. scenario
  const ourScenario = o.scenario || null;
  if (k.scenarioName === ourScenario) stats.scenarioSame++;
  else { stats.scenarioDiff++; problems.push(`scenario: KoSIT="${k.scenarioName}" ours="${ourScenario}"`); }
  if (!k.scenarioName) dirStat.noScenario++;
  const sc = k.scenarioName || '(no scenario)';
  byScenario.set(sc, (byScenario.get(sc) || 0) + 1);

  // 3. XSD verdict (only when KoSIT ran the schema step, i.e. a scenario matched)
  if (k.scenarioName && k.scenarioName === ourScenario) {
    stats.xsdCompared++;
    const oursXsd = o.xsd ? o.xsd.valid : null;
    if (k.xsdValid === oursXsd) stats.xsdSame++;
    else { stats.xsdDiff++; problems.push(`xsd: KoSIT valid=${k.xsdValid} ours valid=${oursXsd}${o.xsd && o.xsd.errors && o.xsd.errors.length ? ' (' + o.xsd.errors[0].code + ' ' + o.xsd.errors[0].location + ')' : ''}`); }
    if (k.xsdValid === false) dirStat.xsdInvalid++;
    // 3b. XSD error codes, in order (both sides report Xerces codes; ours: src/xsd-validator.js)
    if (k.xsdValid === false && oursXsd === false) {
      stats.xsdCodesCompared++;
      const ourCodes = (o.xsd && o.xsd.errors || []).map((e) => e.code);
      if (JSON.stringify(ourCodes) === JSON.stringify(k.xsdCodes)) stats.xsdCodesSame++;
      else { stats.xsdCodesDiff++; problems.push(`xsd codes: KoSIT ${k.xsdCodes.join(',')} ours ${ourCodes.join(',')}`); }
    }

    // 4. Schematron messages (only when both schema-valid and Schematron ran)
    if (k.xsdValid && oursXsd && k.schematronRan) {
      stats.messagesCompared++;
      const a = new Map(); for (const m of k.messages) { const key = m.code + '|' + m.customLevel + '|' + canonLocation(m.location); a.set(key, (a.get(key) || 0) + 1); }
      const b = new Map(); for (const f of o.findings || []) { const key = f.id + '|' + f.level + '|' + canonLocation(f.location); b.set(key, (b.get(key) || 0) + 1); }
      const onlyK = [], onlyO = [];
      for (const [key, n] of a) { const m = b.get(key) || 0; if (m < n) onlyK.push(key + (n - m > 1 ? ' ×' + (n - m) : '')); }
      for (const [key, n] of b) { const m = a.get(key) || 0; if (m < n) onlyO.push(key + (n - m > 1 ? ' ×' + (n - m) : '')); }
      if (!onlyK.length && !onlyO.length) stats.messagesSame++;
      else { stats.messagesDiff++; problems.push(`messages: only KoSIT: ${onlyK.join(', ') || '-'}; only ours: ${onlyO.join(', ') || '-'}`); }
    }
  }

  // 5. assessment
  if (k.scenarioName && k.scenarioName === ourScenario && !k.processingError && !oursPE) {
    stats.assessmentCompared++;
    if (k.assessment === o.assessment) stats.assessmentSame++;
    else { stats.assessmentDiff++; problems.push(`assessment: KoSIT=${k.assessment} ours=${o.assessment}`); }
  } else if (!k.scenarioName && !ourScenario && !k.processingError && !oursPE) {
    stats.assessmentNotComparable++; // KoSIT: fallback -> reject; Prüfer: informative check by its own rule set (or none)
  }
  // 6. the verdict of the XRechnung configuration itself, for EVERY document: KoSIT "accept" <=> the Prüfer
  //    accepts it under the same KoSIT scenario. A document without scenario is rejected by KoSIT (fallback)
  //    and never accepted as XRechnung/EN 16931 under a KoSIT scenario by the Prüfer (it may still be checked
  //    informatively against another rule set, e.g. Peppol BIS or Factur-X).
  if (!k.processingError && !oursPE) {
    const kAccept = k.assessment === 'accept';
    const oAccept = !!(o.kositScenario || ourScenario) && o.assessment === 'accept';
    if (kAccept === oAccept) stats.xrAcceptSame++;
    else { stats.xrAcceptDiff++; problems.push(`configuration verdict: KoSIT=${k.assessment} ours=${o.assessment} (scenario ${ourScenario || '-'})`); }
  }

  if (problems.length) { dirStat.mismatches++; mismatches.push({ label, problems, kosit: k, ours: o }); }
}

out('KoSIT parity — varl reports vs tools/pruefer-cli.cjs');
out(`reports: ${reports.length} in ${reportDir}; JSON: ${jsons.length} in ${jsonDir}; paired: ${stats.pairs}; JSON without report: ${stats.missingReport}`);
out('');
out('per directory:');
for (const [dir, d] of [...perDir.entries()].sort()) out(`  ${dir || '.'}: ${d.docs} documents, ${d.noScenario} without KoSIT scenario, ${d.xsdInvalid} schema-invalid, ${d.mismatches} with mismatches`);
out('');
out('KoSIT scenarios matched:');
for (const [sc, n] of [...byScenario.entries()].sort((x, y) => y[1] - x[1])) out(`  ${n.toString().padStart(5)}  ${sc}`);
out('');
out('comparable fields:');
out(`  scenario:    ${stats.scenarioSame} identical, ${stats.scenarioDiff} different (of ${stats.pairs})`);
out(`  xsd verdict: ${stats.xsdSame} identical, ${stats.xsdDiff} different (of ${stats.xsdCompared} with matched scenario)`);
out(`  xsd errors:  ${stats.xsdCodesSame} identical code sequences, ${stats.xsdCodesDiff} different (of ${stats.xsdCodesCompared} schema-invalid documents)`);
out(`  messages:    ${stats.messagesSame} identical multisets, ${stats.messagesDiff} different (of ${stats.messagesCompared} schema-valid documents with Schematron; code | level after customLevel | location)`);
out(`  configuration verdict (accept under a KoSIT scenario, all documents): ${stats.xrAcceptSame} identical, ${stats.xrAcceptDiff} different`);
out(`  assessment:  ${stats.assessmentSame} identical, ${stats.assessmentDiff} different (of ${stats.assessmentCompared} with matched scenario); ${stats.assessmentNotComparable} not comparable (no scenario: KoSIT fallback reject vs informative check)`);
out(`  processing errors: ${stats.processingErrorBoth} on both sides, ${stats.processingErrorDiff} on one side only`);
out('');
out(`MISMATCHES: ${mismatches.length} document(s)`);
for (const m of mismatches) {
  out(`DIFF ${m.label}`);
  for (const p of m.problems) out(`     ${p}`);
}
if (outFile) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, lines.join('\n') + '\n'); }
// every document must be paired: a JSON without report or a report without JSON is a failure, not a skip
const unpaired = stats.missingReport + (reports.length - stats.pairs);
if (unpaired) out(`UNPAIRED: ${unpaired} (JSON without report: ${stats.missingReport}, reports without JSON: ${reports.length - stats.pairs})`);
process.exit(mismatches.length || unpaired ? 1 : 0);
