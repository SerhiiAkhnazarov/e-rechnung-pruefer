#!/usr/bin/env node
/*
 * kosit-official.cjs — parity with the OFFICIAL KoSIT validator: the released standalone JAR
 * (github.com/itplr-kosit/validator, release v1.6.3) with the released XRechnung configuration
 * (github.com/itplr-kosit/validator-configuration-xrechnung, release v2026-08-31) over the whole corpus,
 * compared with the Prüfer CLI (test/compare-kosit.cjs). Both downloads are checked against the SHA-256
 * recorded below before use; the CI job kosit-parity additionally compares the JAR with the copy on
 * Maven Central (org.kosit:validator:1.6.3:standalone, .sha1 of the repository).
 *
 * Usage: node test/kosit-official.cjs <dir with validator-1.6.3-standalone.jar and the configuration zip>
 * The directory is prepared by tools/fetch-sources.cjs (or by hand: the two release assets).
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const dir = process.argv[2];
const ARTEFACTS = {
  'validator-1.6.3-standalone.jar': '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9',
  'xrechnung-3.0.2-validator-configuration-2026-08-31.zip': '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8',
};
// every corpus directory: KoSIT's own material, CEN, test suites, Peppol BIS (examples, snippets, unit-test
// fragments) and the ZUGFeRD/Factur-X corpus (documents without KoSIT scenario: KoSIT rejects them by fallback)
const DIRS = ['xr-ubl', 'xr-cii', 'cen-ubl', 'cen-cii', 'extra-ubl', 'extra-cii', 'peppol-ubl', 'peppol-cii', 'zugferd-ubl', 'zugferd-cii'];
for (const [f, h] of Object.entries(ARTEFACTS)) {
  const p = path.join(dir, f);
  const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (got !== h) { console.log('SHA-256 mismatch ' + f + ': ' + got + ' (expected ' + h + ')'); process.exit(1); }
  console.log('verified ' + f + ' sha256 ' + h);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kosit-'));
const config = path.join(work, 'config');
fs.mkdirSync(config);
let r = spawnSync('unzip', ['-q', path.join(dir, 'xrechnung-3.0.2-validator-configuration-2026-08-31.zip'), '-d', config]);
if (r.status !== 0) { console.log('unzip failed'); process.exit(1); }
const reports = path.join(root, 'build', 'kosit-official', 'reports');
const ours = path.join(root, 'build', 'kosit-official', 'pruefer');
fs.rmSync(path.join(root, 'build', 'kosit-official'), { recursive: true, force: true });
const t0 = Date.now();
for (const d of DIRS) {
  fs.mkdirSync(path.join(reports, d), { recursive: true });
  // CommandLineOptions.java: -s scenarios, -r repository, -o output directory; exit code = number of rejected documents
  r = spawnSync('java', ['-jar', path.join(dir, 'validator-1.6.3-standalone.jar'), '-s', path.join(config, 'scenarios.xml'), '-r', config, '-o', path.join(reports, d), path.join(root, 'build', 'corpus', d)],
    { encoding: 'utf8', maxBuffer: 1 << 30, env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
  fs.writeFileSync(path.join(reports, d + '.log'), (r.stdout || '') + (r.stderr || ''));
  r = spawnSync(process.execPath, ['tools/pruefer-cli.cjs', '--quiet', '--out', path.join(ours, d), path.join(root, 'build', 'corpus', d)], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  console.log(d + ': ' + fs.readdirSync(path.join(reports, d)).length + ' KoSIT reports, ' + fs.readdirSync(path.join(root, 'build', 'corpus', d)).length + ' documents');
}
fs.rmSync(work, { recursive: true, force: true });
const cmp = spawnSync(process.execPath, ['test/compare-kosit.cjs', reports, ours, '--out', path.join(root, 'build', 'kosit-official', 'compare.txt')], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
process.stdout.write(cmp.stdout + (cmp.stderr || ''));
console.log('official KoSIT validator 1.6.3 + configuration v2026-08-31: ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
process.exit(cmp.status);
