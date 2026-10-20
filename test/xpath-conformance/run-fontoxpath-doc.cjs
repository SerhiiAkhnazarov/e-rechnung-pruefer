#!/usr/bin/env node
/* run-fontoxpath-doc.cjs — evaluates expressions-doc.txt with our fontoxpath build against doc.xml and compares with
 * expected-doc.json (Saxon). Runs twice: with the per-document index enabled (as the validator does) and disabled. */
'use strict';
process.env.TZ = 'UTC'; // implicit timezone UTC, as Saxon in run-saxon-doc.cjs (before any Date is created)
const fs = require('fs'); const path = require('path');
const fx = require(path.join(__dirname, '..', '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', '..', 'vendor', 'slimdom.cjs'));
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-doc.json'), 'utf8'));
const ns = { inv: 'urn:test:inv', cac: 'urn:test:cac', cbc: 'urn:test:cbc', x: 'urn:test:x', cn: 'urn:test:cn' };
let failed = false;
for (const indexed of [true, false]) {
  fx.setDescendantIndexEnabled(indexed);
  const doc = slimdom.parseXmlDocument(fs.readFileSync(path.join(__dirname, 'doc.xml'), 'utf8'));
  let same = 0, diff = 0; const diffs = [];
  for (const e of exp.expressions) {
    let ours;
    try {
      ours = fx.evaluateXPath(`string-join(for $v in (${e}) return (if ($v instance of node()) then path($v) else string($v)), ' ')`, doc, null, null, fx.evaluateXPath.STRING_TYPE, { language: fx.evaluateXPath.XPATH_3_1_LANGUAGE, namespaceResolver: (p) => ns[p] });
    } catch (err) {
      const m = /^([A-Z]{4}\d{4})/.exec(String(err.message || err));
      ours = 'ERROR ' + (m ? 'err:' + m[1] : String(err.message).slice(0, 60));
    }
    const want = exp.expected[e];
    const ok = ours === want || (want.startsWith('ERROR') && ours.startsWith('ERROR') && want === ours);
    if (ok) same++; else { diff++; diffs.push([e, want, ours]); }
  }
  for (const [e, want, ours] of diffs) console.log(`DIFF ${e}\n     Saxon: ${JSON.stringify(want)}\n     ours:  ${JSON.stringify(ours)}`);
  console.log(`XPath document battery vs ${exp.engine} (index ${indexed ? 'on' : 'off'}): ${same} identical, ${diff} different, ${exp.expressions.length} expressions`);
  if (diff) failed = true;
}
process.exit(failed ? 1 : 0);
