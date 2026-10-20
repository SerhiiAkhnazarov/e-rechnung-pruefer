#!/usr/bin/env node
/* check-batches.cjs — every rule of every compiled rule set evaluates all its asserts in one XPath
 * call (src/schematron.js: batchExpr, including the hoisted common subexpressions). A batch that does
 * not compile would silently fall back to one call per assert; this check compiles every batch and
 * fails on any static error (XPST*). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fx = require(path.join(root, 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(root, 'vendor', 'slimdom.cjs'));
const SR = require(path.join(root, 'src', 'schematron.js'));
const doc = slimdom.parseXmlDocument('<x/>');
let bad = 0, n = 0, sets = 0;
for (const f of fs.readdirSync(path.join(root, 'build', 'schemas')).filter((f) => f.endsWith('.json')).sort()) {
  sets++;
  const v = SR.create(fx, JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', f), 'utf8')));
  for (const p of v.patterns) for (const r of p.rules) {
    if (!r.batchExpr) continue;
    n++;
    try { fx.evaluateXPath(r.batchExpr, doc.documentElement, null, v._xpathOptions.variables, fx.evaluateXPath.ALL_RESULTS_TYPE, v._xpathOptions); }
    catch (e) { if (/XPST/.test(e.message)) { bad++; console.log(f, r.context.slice(0, 60), e.message.slice(0, 160)); } }
  }
}
console.log(`batches ${n} in ${sets} rule sets, static errors ${bad}`);
process.exit(bad ? 1 : 0);
