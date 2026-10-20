#!/usr/bin/env node
/*
 * fetch-sources.cjs — prepares <ext-dir> with everything the verification needs, exactly at the versions
 * recorded in build/STANDARDS_MANIFEST.json (single source of truth; CI and local runs use this script):
 *  - git repositories at their pinned commits (partial clones; sparse where only a sub-tree is needed),
 *  - the OASIS UBL 2.1 schemas from the ph-ubl archive (SHA-256 checked) unpacked to os-UBL-2.1/,
 *  - downloaded release artefacts, each checked against its SHA-256 before use:
 *      Saxon HE 12.8 (Saxonica GitHub), KoSIT validator 1.6.3 standalone JAR and the XRechnung
 *      configuration release v2026-08-31 (GitHub release assets of itplr-kosit).
 * Writes <ext-dir>/DOWNLOADS.txt (URL, SHA-256, size of every download).
 *
 * Usage: node tools/fetch-sources.cjs <ext-dir> [--only name,name]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const ext = path.resolve(args[0] || 'ext');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
fs.mkdirSync(ext, { recursive: true });
const log = [];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function run(cmd, a, opts) {
  const r = spawnSync(cmd, a, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }, opts || {}));
  if (r.status !== 0) throw new Error(cmd + ' ' + a.join(' ') + ' failed (' + r.status + ')');
}
// sub-trees for sparse checkouts (repositories of which only a part is used)
const SPARSE = {
  'ph-schematron': ['ph-schematron-isosch/src/main/resources/external/schematron/20100710-xslt2'],
  'ph-cii': ['ph-cii-d16b/src/main/resources/external/schemas/d16b'],
  'ph-ubl': ['docs/UBL-2.1.zip'],
};
const repos = [];
for (const src of Object.values(manifest.sources)) for (const r of src.repos || [src]) if (r.remote && r.commit && r.path) repos.push(r);
for (const r of repos) {
  const name = r.path;
  if (only && !only.has(name)) continue;
  const dir = path.join(ext, name);
  if (fs.existsSync(path.join(dir, '.git'))) {
    const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    if (head === r.commit) { console.log('ok   ' + name + ' ' + r.commit.slice(0, 12)); continue; }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('git  ' + name + ' ' + r.remote + ' @ ' + r.commit.slice(0, 12));
  run('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', r.remote, dir]);
  if (SPARSE[name]) { run('git', ['-C', dir, 'sparse-checkout', 'init', '--no-cone']); run('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone'].concat(SPARSE[name])); }
  run('git', ['-C', dir, 'checkout', '-q', r.commit]);
  log.push(['git', r.remote, r.commit].join('\t'));
}
// OASIS UBL 2.1 from the ph-ubl archive
const ublSrc = Object.values(manifest.sources).find((s) => s.archive && /UBL-2\.1\.zip$/.test(s.archive.file));
if (ublSrc && (!only || only.has('os-UBL-2.1'))) {
  const zip = path.join(ext, ublSrc.archive.file);
  if (sha(zip) !== ublSrc.archive.sha256) throw new Error('SHA-256 mismatch ' + zip);
  fs.rmSync(path.join(ext, 'os-UBL-2.1'), { recursive: true, force: true });
  run('unzip', ['-q', zip, 'xsd/*', 'xsdrt/*', '-d', path.join(ext, 'os-UBL-2.1')]);
  console.log('unzip os-UBL-2.1 (sha256 ' + ublSrc.archive.sha256.slice(0, 12) + ' verified)');
  log.push(['archive', ublSrc.archive.file, ublSrc.archive.sha256].join('\t'));
}
// release artefacts
const DOWNLOADS = [
  // Saxonica publishes the HE distributions in the git repository Saxonica/Saxon-HE (not as release assets)
  { name: 'saxon', git: { remote: 'https://github.com/Saxonica/Saxon-HE.git', commit: '45924081b69cabf8e55baafcfb1833f7c544b823', path: '12/Java/SaxonHE12-8J.zip' },
    file: 'SaxonHE12-8J.zip', sha256: '2ba851aec7925b882208182c48c936230205d558e335636bbe46626bd8003598', unzipTo: 'saxon' },
  { name: 'kosit-official', url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar', file: 'validator-1.6.3-standalone.jar',
    sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9' },
  { name: 'kosit-official', url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip',
    file: 'xrechnung-3.0.2-validator-configuration-2026-08-31.zip', sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8' },
];
for (const d of DOWNLOADS) {
  if (only && !only.has(d.name)) continue;
  const dir = path.join(ext, d.name);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, d.file);
  if (!fs.existsSync(target) || sha(target) !== d.sha256) {
    if (d.git) {
      const tmp = path.join(ext, '.git-' + d.name);
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log('git  ' + d.git.remote + ' @ ' + d.git.commit.slice(0, 12) + ' : ' + d.git.path);
      run('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', d.git.remote, tmp]);
      run('git', ['-C', tmp, 'sparse-checkout', 'set', '--no-cone', d.git.path]);
      run('git', ['-C', tmp, 'checkout', '-q', d.git.commit]);
      fs.copyFileSync(path.join(tmp, d.git.path), target);
      fs.rmSync(tmp, { recursive: true, force: true });
      d.url = d.git.remote + '#' + d.git.commit + ':' + d.git.path;
    } else {
      console.log('get  ' + d.url);
      run('curl', ['-sSfL', '--retry', '3', '-o', target, d.url]);
    }
  }
  d.url = d.url || (d.git.remote + '#' + d.git.commit + ':' + d.git.path);
  const h = sha(target);
  if (h !== d.sha256) throw new Error('SHA-256 mismatch ' + d.file + ': ' + h + ' (expected ' + d.sha256 + ')');
  console.log('ok   ' + d.file + ' sha256 ' + h.slice(0, 16) + '…');
  log.push(['download', d.url, h, fs.statSync(target).size].join('\t'));
  if (d.unzipTo) run('unzip', ['-q', '-o', target, '-d', path.join(ext, d.unzipTo)]);
}
fs.writeFileSync(path.join(ext, 'DOWNLOADS.txt'), '# fetched by tools/fetch-sources.cjs ' + new Date().toISOString() + '\n' + log.join('\n') + '\n');
console.log('sources ready in ' + ext);
