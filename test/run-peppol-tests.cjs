#!/usr/bin/env node
/*
 * run-peppol-tests.cjs — executes the OpenPeppol BIS Billing 3.0 unit tests (VEFA testSet format,
 * rules/unit-UBL-* and rules/unit-CII-* of the peppol-bis-invoice-3 repository) against our
 * runner with the FULL Peppol rule sets build/schemas/PEPPOL-UBL.json / PEPPOL-CII.json.
 *
 * Which rule set a testSet targets is given by its @configuration (rules/buildconfig.xml):
 *   peppolbis-en16931-base-3.0-ubl                 sch/PEPPOL-EN16931-UBL.sch           -> PEPPOL-UBL
 *   peppolbis-en16931-base-3.0-cii                 sch/PEPPOL-EN16931-CII.sch           -> PEPPOL-CII
 *   peppolbis-en16931-01-3.0-ubl-invoice|creditnote, peppolbis-en16931-02-3.0-ubl-*:
 *        inherit ubl-*-2.1 (XSD), peppolbis-en16931-cen-ubl (CEN TC434 1.3.14.1 copy in the Peppol
 *        repository) and the base configuration                 -> EN16931-UBL + PEPPOL-UBL
 *   peppolbis-en16931-01-3.0-cii                   analogous                             -> EN16931-CII + PEPPOL-CII
 *   peppolbis-envelope-3.0-sbdh (unit-SBDH)        sch/PeppolBIS-Envelope-Rules.sch — not an invoice
 *        rule set, not compiled: the testSet is counted as skipped.
 * The national rules (DE, DK, GR, IT, NL, NO, SE) live inside the same PEPPOL-EN16931-*.sch files
 * (patterns with id "DE", "DK", ... activated through the seller/buyer country), so the
 * unit-UBL-<CC> / unit-CII-<CC> directories target the same two rule sets.
 *
 * Semantics (vefa-validator testSet, identical to test/run-cen-tests.cjs): for each <test>, the
 * <assert> block lists expectations for rule identifiers in the testSet's <scope>:
 *   <success>ID</success>          ID must not be reported (a @number on <success> carries no meaning)
 *   <error>ID</error>              ID must be reported at level error (flag fatal); @number = exact count
 *   <warning>ID</warning>          ID must be reported at level warning; @number = exact count
 * Findings for identifiers outside <scope> are ignored (the test documents are fragments); findings
 * inside <scope> that are not expected are failures. The XSD step of the "01"/"02" configurations is
 * not part of this test (the fragments are not schema-valid by construction).
 *
 * Usage: node run-peppol-tests.cjs <peppol-bis-invoice-3-dir> [--verbose] [--filter substring]
 *                                  [--dir unit-UBL-DE] [--report file]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));

const VEFA_NS = 'http://difi.no/xsd/vefa/validator/1.0';
const args = process.argv.slice(2);
const VALUED = ['--filter', '--dir', '--report'];
let repo = null;
for (let i = 0; i < args.length; i++) {
  if (VALUED.includes(args[i])) { i++; continue; }
  if (!args[i].startsWith('--') && repo === null) repo = args[i];
}
const verbose = args.includes('--verbose');
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const filter = opt('--filter');
const onlyDir = opt('--dir');
const reportFile = opt('--report');
if (!repo) { console.error('usage: run-peppol-tests.cjs <peppol-bis-invoice-3-dir> [--verbose] [--filter s] [--dir d] [--report f]'); process.exit(2); }

const CONFIGS = {
  'peppolbis-en16931-base-3.0-ubl': ['PEPPOL-UBL'],
  'peppolbis-en16931-base-3.0-cii': ['PEPPOL-CII'],
  'peppolbis-en16931-01-3.0-ubl-invoice': ['EN16931-UBL', 'PEPPOL-UBL'],
  'peppolbis-en16931-01-3.0-ubl-creditnote': ['EN16931-UBL', 'PEPPOL-UBL'],
  'peppolbis-en16931-02-3.0-ubl-invoice': ['EN16931-UBL', 'PEPPOL-UBL'],
  'peppolbis-en16931-02-3.0-ubl-creditnote': ['EN16931-UBL', 'PEPPOL-UBL'],
  'peppolbis-en16931-01-3.0-cii': ['EN16931-CII', 'PEPPOL-CII'],
};
const validators = {};
function validator(id) {
  if (!validators[id]) validators[id] = SR.create(fx, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'schemas', id + '.json'), 'utf8')));
  return validators[id];
}

function els(node, local, ns) {
  return Array.from(node.childNodes).filter((n) => n.nodeType === 1 && n.localName === local && (ns === undefined || n.namespaceURI === ns));
}

const rulesDir = path.join(repo, 'rules');
const dirs = fs.readdirSync(rulesDir).filter((d) => /^unit-(UBL|CII|SBDH)/.test(d) && fs.statSync(path.join(rulesDir, d)).isDirectory()).sort();
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };

let total = 0, passed = 0, failed = 0, skippedSets = 0, files = 0;
const failures = [];
const perDir = {};
const perConfig = {};
const t0 = Date.now();
for (const dir of dirs) {
  if (onlyDir && dir !== onlyDir) continue;
  const full = path.join(rulesDir, dir);
  const stat = { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0 };
  perDir[dir] = stat;
  for (const file of fs.readdirSync(full).sort()) {
    // the repository holds two testSets with the extension ".xm" (PEPPOL-COMMON-R048.xm in unit-UBL-PEPPOL and
    // unit-CII-PEPPOL); they are complete VEFA testSets and are executed as well
    if (!/\.xml?$/.test(file)) continue;
    if (filter && !file.includes(filter)) continue;
    const rel = 'rules/' + dir + '/' + file;
    const xml = fs.readFileSync(path.join(full, file), 'utf8');
    let doc;
    try {
      doc = slimdom.parseXmlDocument(xml);
    } catch (e) {
      failures.push({ file: rel, test: '-', msg: 'XML parse error: ' + e.message });
      failed++; stat.failed++;
      continue;
    }
    const testSet = doc.documentElement;
    if (testSet.localName !== 'testSet' || testSet.namespaceURI !== VEFA_NS) {
      failures.push({ file: rel, test: '-', msg: 'not a VEFA testSet' });
      failed++; stat.failed++;
      continue;
    }
    files++; stat.files++;
    const config = testSet.getAttribute('configuration');
    const schemaIds = CONFIGS[config];
    if (!schemaIds) {
      skippedSets++; stat.skipped++;
      if (verbose) console.log(`SKIP ${rel}: configuration ${config} is not an invoice rule set`);
      continue;
    }
    perConfig[config] = (perConfig[config] || 0) + 1;
    const vs = schemaIds.map(validator);
    const scope = new Set();
    for (const a of els(testSet, 'assert', VEFA_NS)) for (const s of els(a, 'scope', VEFA_NS)) scope.add(s.textContent.trim());
    let tIndex = 0;
    for (const test of els(testSet, 'test', VEFA_NS)) {
      tIndex++;
      const tid = test.getAttribute('id') || String(tIndex);
      const expect = { success: [], error: [], warning: [] };
      let description = '';
      for (const a of els(test, 'assert', VEFA_NS)) {
        for (const c of Array.from(a.childNodes)) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 'description') description = c.textContent.trim();
          else if (expect[c.localName]) expect[c.localName].push({ id: c.textContent.trim(), number: c.hasAttribute('number') ? parseInt(c.getAttribute('number'), 10) : null });
          else { failures.push({ file: rel, test: tid, msg: 'unknown expectation element ' + c.localName }); }
        }
      }
      const instanceEl = Array.from(test.childNodes).find((n) => n.nodeType === 1 && n.namespaceURI !== VEFA_NS);
      if (!instanceEl) {
        failures.push({ file: rel, test: tid, msg: 'no instance element' });
        failed++; stat.failed++;
        continue;
      }
      total++; stat.tests++;
      // re-parse the fragment as a standalone document
      const frag = slimdom.serializeToWellFormedString(instanceEl);
      let idoc;
      try {
        idoc = slimdom.parseXmlDocument(frag);
      } catch (e) {
        failures.push({ file: rel, test: tid, msg: 'fragment parse error: ' + e.message });
        failed++; stat.failed++;
        continue;
      }
      const counts = {};
      const levels = {};
      const processingErrors = [];
      for (const v of vs) {
        const rep = v.validate(idoc);
        for (const f of rep.findings) {
          counts[f.id] = (counts[f.id] || 0) + 1;
          levels[f.id] = f.level;
        }
        processingErrors.push(...rep.processingErrors);
      }
      const problems = [];
      for (const s of expect.success) if (counts[s.id]) problems.push(`expected ${s.id} to pass but it was reported ${counts[s.id]}x`);
      for (const kind of ['error', 'warning']) {
        for (const e of expect[kind]) {
          if (!counts[e.id]) problems.push(`expected ${kind} ${e.id} but it was not reported`);
          else if (e.number !== null && counts[e.id] !== e.number) problems.push(`expected ${e.id} ${e.number}x but got ${counts[e.id]}x`);
          else if (kind === 'error' && levels[e.id] !== 'error') problems.push(`expected ${e.id} at level error but level is ${levels[e.id]}`);
          else if (kind === 'warning' && levels[e.id] !== 'warning') problems.push(`expected ${e.id} at level warning but level is ${levels[e.id]}`);
        }
      }
      // unexpected failures inside scope
      const expectedIds = new Set([...expect.error, ...expect.warning].map((e) => e.id));
      for (const id of Object.keys(counts)) {
        if (scope.has(id) && !expectedIds.has(id)) problems.push(`unexpected ${levels[id]} ${id} (${counts[id]}x) inside scope`);
      }
      for (const pe of processingErrors) problems.push(`processing error ${pe.id || ''}: ${pe.message.slice(0, 160)}`);
      if (problems.length) {
        failed++; stat.failed++;
        failures.push({ file: rel, test: tid, msg: problems.join('; '), description });
      } else {
        passed++; stat.passed++;
        if (verbose) console.log(`ok   ${rel} #${tid}`);
      }
    }
  }
}
const ms = Date.now() - t0;
for (const f of failures) out(`FAIL ${f.file} #${f.test}: ${f.msg}${f.description ? '  [' + f.description + ']' : ''}`);
out('');
for (const [dir, s] of Object.entries(perDir)) out(`  ${dir.padEnd(18)} testSets ${String(s.files).padStart(3)}  tests ${String(s.tests).padStart(4)}  passed ${String(s.passed).padStart(4)}  failed ${s.failed}${s.skipped ? '  skipped testSets ' + s.skipped : ''}`);
out('  configurations: ' + Object.entries(perConfig).map(([k, n]) => k + '=' + n).join(', '));
out(`\nPeppol BIS Billing 3.0 unit tests: ${passed} passed, ${failed} failed, ${total} tests in ${files} testSets (${skippedSets} testSet(s) skipped: envelope rules) in ${ms} ms`);
if (reportFile) {
  fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
  fs.appendFileSync(reportFile, lines.join('\n') + '\n');
}
process.exit(failed ? 1 : 0);
