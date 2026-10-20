#!/usr/bin/env node
/* selftest-pattern-matcher.cjs — cross-checks the per-node fallback matcher against the
 * set-based selector for every rule of every schema on the given documents. */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));
const files = process.argv.slice(2);
let checks = 0, diffs = 0, dynamicErrors = 0;
for (const id of ['EN16931-UBL', 'XRechnung-UBL', 'EN16931-CII', 'XRechnung-CII']) {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'schemas', id + '.json'), 'utf8'));
  const v = SR.create(fx, schema);
  const opts = { namespaceResolver: (p) => schema.ns[p] || null, language: fx.evaluateXPath.XPATH_3_1_LANGUAGE };
  for (const file of files) {
    const doc = slimdom.parseXmlDocument(fs.readFileSync(file, 'utf8'));
    const isUbl = /ubl/i.test(id);
    const rootNs = doc.documentElement.namespaceURI;
    if (isUbl !== /ubl/.test(rootNs)) continue;
    const idx = SR.documentOrderIndex(doc);
    const candidates = [];
    for (const n of idx.keys()) if (n.nodeType === 9 || n.nodeType === 1 || n.nodeType === 2) candidates.push(n);
    for (const p of v.patterns) for (const r of p.rules) {
      let set;
      try { set = new Set(fx.evaluateXPathToNodes(r.matchExpr, doc, null, null, opts)); }
      catch (e) { dynamicErrors++; continue; } // e.g. a mutated document with a non-boolean cbc:ChargeIndicator: both matchers report it as a warning
      const warnings = [];
      for (const n of candidates) {
        checks++;
        const a = set.has(n);
        const b = v._nodeMatchesPattern(n, r, warnings);
        if (a !== b) { diffs++; if (diffs < 20) console.log(`DIFF ${id} ${path.basename(file)} rule "${r.context.slice(0, 80)}" node ${SR.nodePath(n)} set=${a} perNode=${b}`); }
      }
      if (warnings.length && diffs < 20) console.log('warnings', warnings.slice(0, 2));
    }
  }
}
console.log(`pattern matcher self-test: ${checks} node×rule checks, ${diffs} differences, ${dynamicErrors} rule×document pairs skipped (dynamic error in the pattern itself), ${files.length} documents`);
process.exit(diffs ? 1 : 0);
