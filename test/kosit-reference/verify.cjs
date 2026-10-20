#!/usr/bin/env node
/*
 * verify.cjs — the KoSIT reference comparison as one fresh run, so that its result belongs to the
 * current inputs (fingerprint, tools/verify-all.cjs) and never to outputs left over from earlier code:
 *  1. run.sh build      assemble the configuration repository + compile KositReference.java
 *  2. run.sh selftest   the configuration's own test material (assertion counts checked as in CI)
 *  3. run.sh corpus     reference reports for build/corpus/<dir> into a NEW directory
 *  4. Prüfer CLI        over the same corpus into a NEW directory
 *  5. compare-kosit     scenario, XSD verdict, Schematron messages, assessment, processing errors
 * Usage: node test/kosit-reference/verify.cjs
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
// every corpus directory: KoSIT's own material, CEN, test suites, Peppol BIS (examples, snippets, unit-test
// fragments) and the ZUGFeRD/Factur-X corpus (documents without KoSIT scenario: KoSIT rejects them by fallback)
const DIRS = ['xr-ubl', 'xr-cii', 'cen-ubl', 'cen-cii', 'extra-ubl', 'extra-cii', 'peppol-ubl', 'peppol-cii', 'zugferd-ubl', 'zugferd-cii'];
const run = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, env: Object.assign({}, process.env, env || {}) });
  if (r.status !== 0 && !(env && env.ALLOW_FAIL)) { console.log(r.stdout + r.stderr); throw new Error(cmd + ' ' + args.join(' ') + ' exited with ' + r.status); }
  return r.stdout + (r.stderr || '');
};
const t0 = Date.now();
run('sh', ['test/kosit-reference/run.sh', 'build']);
const self = run('sh', ['test/kosit-reference/run.sh', 'selftest']);
fs.writeFileSync(path.join(root, 'build', 'kosit-reference', 'selftest.txt'), self);
const expectSelf = ['Assertions run: 229, Assertions failed: 0', 'Assertions run: 55, Assertions failed: 0', 'Assertions run: 41, Assertions failed: 0', 'test-processing-error: 12 checks, 0 failed'];
const missing = expectSelf.filter((e) => !self.includes(e));
if (missing.length || /INVALID|FAILED \[/.test(self)) { console.log('configuration self-test FAILED: ' + missing.join('; ')); process.exit(1); }
console.log('configuration self-tests: ' + expectSelf.join(' | '));
const refDir = path.join(root, 'build', 'kosit-reference', 'reports');
const ourDir = path.join(root, 'build', 'kosit-reference', 'pruefer');
fs.rmSync(refDir, { recursive: true, force: true });
fs.rmSync(ourDir, { recursive: true, force: true });
run('sh', ['test/kosit-reference/run.sh', 'corpus'].concat(DIRS), { ALLOW_FAIL: '1' });
for (const d of DIRS) run(process.execPath, ['tools/pruefer-cli.cjs', '--quiet', '--out', path.join(ourDir, d), path.join(root, 'build', 'corpus', d)], { ALLOW_FAIL: '1' });
run(process.execPath, ['test/compare-kosit.cjs', '--selftest']);
const cmp = spawnSync(process.execPath, ['test/compare-kosit.cjs', refDir, ourDir, '--out', path.join(root, 'build', 'kosit-reference', 'compare.txt')], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
process.stdout.write(cmp.stdout + (cmp.stderr || ''));
console.log('kosit reference (fresh run): ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
process.exit(cmp.status);
