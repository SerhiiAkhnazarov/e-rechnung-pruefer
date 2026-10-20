#!/usr/bin/env node
/*
 * verify-manifest.cjs — checks that the standard sources checked out under <ext-dir> are
 * byte-identical (SHA-256) to what build/STANDARDS_MANIFEST.json records, and that the compiled
 * rule files in build/ match the manifest's derived hashes.
 *
 * Usage: node verify-manifest.cjs <ext-dir> [--reports [--strict]]
 *   --reports  every suite result in build/reports/VERIFICATION.json must carry the current fingerprint
 *              and have passed; suites not run must name the reason (missing browser / CI-only tool)
 *   --strict   additionally no suite may be 'not run' (release gate)
 *   <ext-dir> contains: einvoicing-en16931, xrechnung-schematron, peppol-bis-invoice-3,
 *   validator-configuration-xrechnung, os-UBL-2.1 (unzipped from ph-ubl docs/UBL-2.1.zip), ph-cii,
 *   mustangproject (as cloned by .github/workflows/verify.yml)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const ext = process.argv[2];
if (!ext) { console.error('usage: verify-manifest.cjs <ext-dir>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let ok = 0, bad = 0, skipped = 0;
// manifest paths are '<repository>/<path>' (tools/make-manifest.cjs); '<ext-dir>/<repository>' is the checkout
const PRODUCT_REPOS = ['einvoicing-en16931', 'xrechnung-schematron', 'peppol-bis-invoice-3', 'validator-configuration-xrechnung', 'os-UBL-2.1', 'ph-cii', 'mustangproject'];
for (const [name, src] of Object.entries(manifest.sources)) {
  for (const f of src.files || []) {
    const repo = f.file.split('/')[0];
    if (!PRODUCT_REPOS.includes(repo)) { skipped++; continue; }
    const local = path.join(ext, f.file);
    if (!fs.existsSync(local)) { console.log('MISSING ' + local); bad++; continue; }
    const h = sha(local);
    if (h === f.sha256) ok++; else { bad++; console.log(`HASH MISMATCH ${local}\n   manifest ${f.sha256}\n   actual   ${h}`); }
  }
}
for (const [f, d] of Object.entries(manifest.derived)) {
  const local = path.join(root, d.file);
  if (!fs.existsSync(local)) { console.log('MISSING DERIVED ' + d.file); bad++; continue; }
  const h = sha(local);
  if (h === d.sha256) ok++; else { bad++; console.log(`DERIVED HASH MISMATCH ${local}`); }
}
console.log(`manifest verification: ${ok} files identical, ${bad} mismatches, ${skipped} not checked`);
// --reports: every recorded test result must have been produced from the current inputs (version axis).
// A report belongs to these sources when its file fingerprint (filesId: manifest, patches, engine, src,
// rule sets, XSD models, scenarios, tools, tests) equals the current one and every suite carries the id
// of that run. The toolchain the run used (Node, Java, Saxon, Playwright) is part of the run id and is
// reported; on another machine it differs by nature and does not make the results stale.
if (process.argv.includes('--reports')) {
  const { compute } = require('./fingerprint.cjs');
  const ext = process.argv[2];
  const fp = compute({ saxonJar: path.join(ext, 'saxon', 'saxon-he-12.8.jar') });
  const vf = path.join(root, 'build', 'reports', 'VERIFICATION.json');
  if (!fs.existsSync(vf)) { console.log('reports: build/reports/VERIFICATION.json missing'); bad++; }
  else {
    const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
    let stale = 0, failedSuites = 0, notRun = 0;
    const strict = process.argv.includes('--strict'); // release gate (CI): every suite must have run
    const sameFiles = v.fingerprint && v.fingerprint.filesId === fp.filesId;
    if (!sameFiles) console.log('STALE: the reports were produced from other sources (filesId ' + String(v.fingerprint && v.fingerprint.filesId).slice(0, 16) + ', current ' + fp.filesId.slice(0, 16) + ')');
    else if (v.fingerprint.id !== fp.id) console.log('note: reports produced with toolchain ' + JSON.stringify(v.fingerprint.toolchain) + ' (' + (v.environment || 'local') + '); this machine: ' + JSON.stringify(fp.toolchain));
    for (const [name, r] of Object.entries(v.suites)) {
      if (!sameFiles || r.fingerprint !== v.fingerprint.id) { stale++; console.log('STALE REPORT ' + name + ' (fingerprint ' + String(r.fingerprint).slice(0, 16) + ', run ' + String(v.fingerprint && v.fingerprint.id).slice(0, 16) + ')'); }
      if (r.status === 'not-run') { notRun++; console.log('NOT RUN ' + name + ' — ' + (r.reason || 'no reason recorded')); if (!r.reason || strict) failedSuites++; }
      else if (r.status !== 'pass') { failedSuites++; console.log('SUITE FAILED ' + name + ': ' + r.status); }
    }
    console.log(`reports: ${Object.keys(v.suites).length} suites, ${stale} stale, ${failedSuites} failed${strict ? '/not run' : ''}, ${notRun} not run in this environment (files ${fp.filesId.slice(0, 16)}, run ${String(v.fingerprint && v.fingerprint.id).slice(0, 16)}, ${v.environment || 'local'})`);
    if (stale || failedSuites) bad++;
  }
}
process.exit(bad ? 1 : 0);
