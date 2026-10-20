#!/usr/bin/env node
/*
 * check-reproducible.cjs — proves that the compiled artefacts shipped in the repository are reproducible
 * from the pinned sources: the merged XRechnung Schematron (tools/merge-xrechnung-sch.sh), every rule set (tools/compile-rules.sh) and every XSD model
 * (tools/compile-xsd-models.sh) and the KoSIT scenario list (tools/compile-scenarios.cjs) is compiled again into a temporary directory and compared byte by byte
 * with build/schemas/ and build/xsd/.
 * Usage: node tools/check-reproducible.cjs <ext-dir>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const ext = process.argv[2] || path.join(root, 'ext');
let diff = 0, same = 0;
const crypto = require('crypto');
// 0. the merged XRechnung Schematron (KoSIT build step) against the SHA-256 in the manifest
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
  const r = spawnSync('sh', [path.join(root, 'tools', 'merge-xrechnung-sch.sh'), ext, tmp], { encoding: 'utf8', env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
  if (r.status !== 0) { console.log('merge-xrechnung-sch.sh failed:\n' + r.stdout + r.stderr); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
  const merged = Object.values(manifest.sources).flatMap((x) => x.merged || []);
  for (const m of merged) {
    const local = path.join(tmp, m.file.split('/build/schematron/')[1]);
    const h = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
    if (h === m.sha256) { same++; console.log('  same     ' + m.file + ' (merge step, sha256 ' + h.slice(0, 12) + ')'); } else { diff++; console.log('  DIFFERS  ' + m.file); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const [script, dir] of [['compile-rules.sh', 'build/schemas'], ['compile-xsd-models.sh', 'build/xsd']]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
  const r = spawnSync('sh', [path.join(root, 'tools', script), ext], { env: { ...process.env, OUT_DIR: tmp }, encoding: 'utf8' });
  if (r.status !== 0) { console.log(script + ' failed:\n' + r.stdout + r.stderr); process.exit(1); }
  const shipped = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json'));
  for (const f of fs.readdirSync(tmp).sort()) {
    const a = fs.readFileSync(path.join(tmp, f));
    const p = path.join(root, dir, f);
    if (/^PEPPOL-/.test(f)) { console.log('  local    ' + dir + '/' + f + ' (not shipped: no redistribution licence, docs/RULESETS.md)'); continue; }
    if (!fs.existsSync(p)) { console.log('  NEW      ' + dir + '/' + f + ' (not in repository)'); diff++; continue; }
    if (Buffer.compare(a, fs.readFileSync(p)) === 0) { same++; console.log('  same     ' + dir + '/' + f); }
    else { diff++; console.log('  DIFFERS  ' + dir + '/' + f); }
  }
  for (const f of shipped) if (!/^PEPPOL-/.test(f) && !fs.existsSync(path.join(tmp, f))) { console.log('  ORPHAN   ' + dir + '/' + f + ' (no source)'); diff++; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
// KoSIT scenarios (build/scenarios.json) from the configuration repository
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
  const out = path.join(tmp, 'scenarios.json');
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'compile-scenarios.cjs'), path.join(ext, 'validator-configuration-xrechnung'), out], { encoding: 'utf8' });
  if (r.status !== 0) { console.log('compile-scenarios failed:\n' + r.stdout + r.stderr); process.exit(1); }
  if (Buffer.compare(fs.readFileSync(out), fs.readFileSync(path.join(root, 'build', 'scenarios.json'))) === 0) { same++; console.log('  same     build/scenarios.json'); }
  else { diff++; console.log('  DIFFERS  build/scenarios.json'); }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('reproducible build: ' + same + ' artefacts byte-identical, ' + diff + ' differences');
process.exit(diff ? 1 : 0);
