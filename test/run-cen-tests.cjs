#!/usr/bin/env node
/*
 * run-cen-tests.cjs — executes the CEN eInvoicing-EN16931 unit tests (VEFA testSet format,
 * test/Invoice-unit-UBL, test/CreditNote-unit-UBL, test/cii) against our runner.
 *
 * Semantics (vefa-validator testSet): for each <test>, the <assert> block lists expectations
 * for rule identifiers in the testSet's <scope>:
 *   <success>ID</success>          ID must not be reported
 *   <error>ID</error>              ID must be reported (level error); @number = exact count
 *   <warning>ID</warning>          ID must be reported (level warning); @number = exact count
 * Findings for identifiers outside <scope> are ignored (the test documents are fragments).
 *
 * Usage: node run-cen-tests.cjs <cen-repo-dir> [--verbose] [--filter substring]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));

const VEFA_NS = 'http://difi.no/xsd/vefa/validator/1.0';
const args = process.argv.slice(2);
const repo = args[0];
const verbose = args.includes('--verbose');
const fIdx = args.indexOf('--filter');
const filter = fIdx >= 0 ? args[fIdx + 1] : null;

const schemas = {
  'tc434-ubl': SR.create(fx, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'schemas', 'EN16931-UBL.json'), 'utf8'))),
  'tc434-cii': SR.create(fx, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'schemas', 'EN16931-CII.json'), 'utf8'))),
};

function els(node, local, ns) {
  return Array.from(node.childNodes).filter((n) => n.nodeType === 1 && n.localName === local && (ns === undefined || n.namespaceURI === ns));
}

let total = 0, passed = 0, failed = 0;
const failures = [];
const dirs = ['test/Invoice-unit-UBL', 'test/CreditNote-unit-UBL', 'test/cii'];
const t0 = Date.now();
for (const dir of dirs) {
  const full = path.join(repo, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full).sort()) {
    if (!file.endsWith('.xml')) continue;
    if (filter && !file.includes(filter)) continue;
    const xml = fs.readFileSync(path.join(full, file), 'utf8');
    let doc;
    try {
      doc = slimdom.parseXmlDocument(xml);
    } catch (e) {
      failures.push({ file: dir + '/' + file, test: '-', msg: 'XML parse error: ' + e.message });
      failed++;
      continue;
    }
    const testSet = doc.documentElement;
    const config = testSet.getAttribute('configuration');
    const validator = schemas[config];
    if (!validator) {
      failures.push({ file: dir + '/' + file, test: '-', msg: 'unknown configuration ' + config });
      failed++;
      continue;
    }
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
        }
      }
      const instanceEl = Array.from(test.childNodes).find((n) => n.nodeType === 1 && n.namespaceURI !== VEFA_NS);
      if (!instanceEl) {
        failures.push({ file: dir + '/' + file, test: tid, msg: 'no instance element' });
        failed++;
        continue;
      }
      total++;
      // re-parse the fragment as a standalone document
      const frag = slimdom.serializeToWellFormedString(instanceEl);
      let idoc;
      try {
        idoc = slimdom.parseXmlDocument(frag);
      } catch (e) {
        failures.push({ file: dir + '/' + file, test: tid, msg: 'fragment parse error: ' + e.message });
        failed++;
        continue;
      }
      const rep = validator.validate(idoc);
      const counts = {};
      const levels = {};
      for (const f of rep.findings) {
        counts[f.id] = (counts[f.id] || 0) + 1;
        levels[f.id] = f.level;
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
      for (const pe of rep.processingErrors) problems.push(`processing error ${pe.id || ''}: ${pe.message.slice(0, 160)}`);
      if (problems.length) {
        failed++;
        failures.push({ file: dir + '/' + file, test: tid, msg: problems.join('; '), description });
      } else {
        passed++;
      }
    }
  }
}
const ms = Date.now() - t0;
for (const f of failures) console.log(`FAIL ${f.file} #${f.test}: ${f.msg}${f.description ? '  [' + f.description + ']' : ''}`);
console.log(`\nCEN unit tests: ${passed} passed, ${failed} failed, ${total} tests in ${ms} ms`);
process.exit(failed ? 1 : 0);
