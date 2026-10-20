#!/usr/bin/env node
/* run-fontoxpath.cjs — evaluates expressions.txt with our fontoxpath build and compares with expected.json (Saxon). */
'use strict';
process.env.TZ = 'UTC'; // implicit timezone UTC, as Saxon in run-saxon.cjs (before any Date is created)
const fs = require('fs'); const path = require('path');
const fx = require(path.join(__dirname, '..', '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', '..', 'vendor', 'slimdom.cjs'));
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
const doc = new slimdom.Document();
let same = 0, diff = 0;
const diffs = [];
for (const e of exp.expressions) {
  let ours;
  try {
    const r = fx.evaluateXPath(`string-join(for $v in (${e}) return string($v), ' ')`, doc, null, null, fx.evaluateXPath.STRING_TYPE, { language: fx.evaluateXPath.XPATH_3_1_LANGUAGE });
    ours = r;
  } catch (err) {
    const m = /^([A-Z]{4}\d{4})/.exec(String(err.message || err));
    ours = 'ERROR ' + (m ? 'err:' + m[1] : String(err.message).slice(0, 60));
  }
  const want = exp.expected[e];
  const ok = ours === want || (want.startsWith('ERROR') && ours.startsWith('ERROR') && (want === ours || process.argv.includes('--lenient-errors')));
  if (ok) same++; else { diff++; diffs.push([e, want, ours]); }
}
for (const [e, want, ours] of diffs) console.log(`DIFF ${e}\n     Saxon: ${JSON.stringify(want)}\n     ours:  ${JSON.stringify(ours)}`);
console.log(`\nXPath conformance vs ${exp.engine}: ${same} identical, ${diff} different, ${exp.expressions.length} expressions`);
process.exit(diff ? 1 : 0);
