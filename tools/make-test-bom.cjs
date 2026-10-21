#!/usr/bin/env node
/*
 * make-test-bom.cjs — the bill of materials of the build and test environment (CycloneDX 1.6): everything the
 * verification of the E-Rechnung Prüfer runs on, none of which is part of the program (the program's own SBOM is
 * sbom.cdx.json, tools/make-sbom.cjs). Published as test-environment.cdx.json beside the SBOM; scanned for known
 * vulnerabilities (OSV-Scanner) in the workflows verify and security.
 *
 *   - the GitHub Actions of every workflow, pinned to commits (.github/workflows/*.yml, "uses: owner/repo@sha # vX");
 *   - the npm test tools and every package they depend on (package.json and the installed node_modules, or
 *     package-lock.json with --static): Playwright, pdf.js, esbuild …;
 *   - the browsers Playwright runs (its browsers.json), and Microsoft Edge / Google Chrome where installed;
 *   - the pinned release artefacts and source repositories of build/STANDARDS_MANIFEST.json used by the tests (KoSIT
 *     validator, Saxon HE, test corpora, schemas) with their SHA-256 or commit;
 *   - the runtimes: Node.js, Java (JDK), Python with jsonschema/referencing, and the system packages used by the tests
 *     (qpdf, poppler, libexpat), the runner image (ImageOS / ImageVersion of GitHub Actions).
 * --static: only what the repository states (actions, package-lock.json, manifest) – for the weekly scan, which runs
 * without installing anything.
 *
 * Usage: node tools/make-test-bom.cjs [--static] [--out build/reports/test-environment.cdx.json]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const STATIC = args.includes('--static');
const oi = args.indexOf('--out');
const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(root, 'build', 'reports', 'test-environment.cdx.json'));
const sha = (b, alg) => crypto.createHash(alg || 'sha256').update(b).digest('hex');
const run = (cmd, a) => { try { const r = spawnSync(cmd, a, { encoding: 'utf8', env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) }); return r.status === 0 || r.stdout || r.stderr ? ((r.stdout || '') + (r.stderr || '')).trim() : null; } catch (e) { return null; } };
const components = [];
const refs = new Set();
function add(c) { if (refs.has(c['bom-ref'])) return; refs.add(c['bom-ref']); components.push(c); }
const prop = (name, value) => ({ name: 'e-rechnung-pruefer:' + name, value: String(value) });

// ---- GitHub Actions ----
const wfDir = path.join(root, '.github', 'workflows');
const used = {};
for (const f of fs.readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
  for (const m of fs.readFileSync(path.join(wfDir, f), 'utf8').matchAll(/uses:\s*([\w.-]+\/[\w.-]+)(\/[\w./-]+)?@([0-9a-f]{40}|[\w.-]+)(?:\s*#\s*(v[\w.-]+))?/g)) {
    const key = m[1] + '@' + m[3];
    (used[key] = used[key] || { repo: m[1], sub: new Set(), ref: m[3], tag: m[4] || null, files: new Set() }).files.add(f);
    if (m[2]) used[key].sub.add(m[2].slice(1));
  }
}
for (const [key, u] of Object.entries(used).sort()) {
  const pinned = /^[0-9a-f]{40}$/.test(u.ref);
  add({ type: 'application', 'bom-ref': 'action:' + key, group: u.repo.split('/')[0], name: u.repo.split('/')[1], version: u.tag || u.ref,
    purl: 'pkg:github/' + u.repo.toLowerCase() + '@' + u.ref, externalReferences: [{ type: 'vcs', url: 'https://github.com/' + u.repo }],
    properties: [prop('kind', 'GitHub Action'), prop('pinned-commit', pinned ? u.ref : 'NOT PINNED'), prop('workflows', Array.from(u.files).join(' '))].concat(u.sub.size ? [prop('sub-actions', Array.from(u.sub).join(' '))] : []) });
}

// ---- npm test tools ----
const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const direct = Object.assign({}, pkgJson.dependencies || {}, pkgJson.devDependencies || {});
const npmComponent = (name, version, extra) => Object.assign({ type: 'library', 'bom-ref': 'npm:' + name + '@' + version, name, version, purl: 'pkg:npm/' + (name.startsWith('@') ? '%40' + name.slice(1) : name) + '@' + version }, extra || {});
const lockFile = path.join(root, 'package-lock.json');
if (STATIC) {
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    for (const [p, v] of Object.entries(lock.packages || {})) {
      if (!p) continue;
      const name = p.replace(/^.*node_modules\//, '');
      add(npmComponent(name, v.version, { hashes: v.integrity && /^sha512-/.test(v.integrity) ? [{ alg: 'SHA-512', content: Buffer.from(v.integrity.slice(7), 'base64').toString('hex') }] : undefined, properties: [prop('kind', 'npm test tool' + (direct[name] ? '' : ' (dependency)')), prop('resolved', v.resolved || '')].concat(v.optional ? [prop('optional', 'true')] : []) }));
    }
  } else for (const [n, v] of Object.entries(direct)) add(npmComponent(n, v, { properties: [prop('kind', 'npm test tool'), prop('lockfile', 'none (versions of package.json)')] }));
} else {
  // the installed packages: the dependency closure of package.json in node_modules
  const nm = path.join(root, 'node_modules');
  const seen = new Set();
  const visit = (name, fromDir) => {
    let dir = null;
    for (let d = fromDir; ; d = path.dirname(d)) { const c = path.join(d, 'node_modules', name); if (fs.existsSync(path.join(c, 'package.json'))) { dir = c; break; } if (d === path.dirname(d) || d === path.dirname(root)) break; }
    if (!dir) { const c = path.join(nm, name); if (fs.existsSync(path.join(c, 'package.json'))) dir = c; }
    if (!dir) return;
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    add(npmComponent(pj.name, pj.version, { licenses: pj.license ? [{ expression: String(pj.license) }] : undefined, properties: [prop('kind', 'npm test tool' + (direct[pj.name] ? '' : ' (dependency)'))] }));
    for (const dn of Object.keys(Object.assign({}, pj.dependencies || {}, pj.optionalDependencies || {}))) visit(dn, real);
  };
  for (const n of Object.keys(direct)) visit(n, root);
}

// ---- browsers (Playwright builds; Edge and Chrome of the machine) ----
if (!STATIC) {
  for (const d of [path.join(root, 'node_modules', 'playwright-core')]) {
    const bj = path.join(d, 'browsers.json');
    if (!fs.existsSync(bj)) continue;
    const pw = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version;
    for (const b of JSON.parse(fs.readFileSync(bj, 'utf8')).browsers.filter((x) => ['chromium', 'chromium-headless-shell', 'firefox', 'webkit', 'ffmpeg'].includes(x.name))) {
      add({ type: 'application', 'bom-ref': 'browser:' + b.name + '@' + b.revision, name: b.name, version: b.browserVersion || 'build ' + b.revision, properties: [prop('kind', 'browser build of Playwright ' + pw), prop('revision', b.revision)] });
    }
  }
  for (const [name, cmds] of [['Microsoft Edge', ['microsoft-edge', '--version']], ['Google Chrome', ['google-chrome', '--version']]]) {
    const v = run(cmds[0], cmds.slice(1));
    if (v && /\d+\.\d+/.test(v)) add({ type: 'application', 'bom-ref': 'browser:' + name, name, version: /(\d+(\.\d+)+)/.exec(v)[1], properties: [prop('kind', 'browser of the machine')] });
  }
}

// ---- pinned artefacts and repositories of the manifest ----
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
const release = Object.entries(manifest.sources).find(([k]) => /^Release artefacts/.test(k));
const MAVEN = { 'validator-1.6.3-standalone.jar': 'pkg:maven/org.kosit/validator@1.6.3?classifier=standalone', 'SaxonHE12-8J.zip': 'pkg:maven/net.sf.saxon/Saxon-HE@12.8' };
for (const a of (release ? release[1].artefacts : [])) {
  const file = path.basename(a.url || a.git.split(':').pop());
  add({ type: 'application', 'bom-ref': 'artefact:' + file, name: a.name.replace(/\s*\(.*$/, ''), version: (/(\d+(\.\d+)+|v?\d{4}-\d{2}-\d{2})/.exec(a.name) || ['?'])[0], description: a.name,
    hashes: [{ alg: 'SHA-256', content: a.sha256 }], purl: MAVEN[file], externalReferences: [{ type: 'distribution', url: a.url || 'https://github.com/' + a.git.replace(/^https:\/\/github\.com\//, '').split('#')[0] }],
    properties: [prop('kind', 'release artefact (tools/fetch-sources.cjs, SHA-256 checked)'), prop('licence', a.licence)] });
}
for (const [key, s] of Object.entries(manifest.sources)) {
  for (const r of s.repos || [s]) {
    if (!r.remote || !r.commit) continue;
    const m = /github\.com\/([^/]+)\/([^/.]+(?:\.[^/.]+)*?)(?:\.git)?$/.exec(r.remote);
    if (!m) continue;
    add({ type: 'data', 'bom-ref': 'source:' + r.path, name: r.path, version: r.describe || r.commit.slice(0, 12), purl: 'pkg:github/' + m[1].toLowerCase() + '/' + m[2].toLowerCase() + '@' + r.commit,
      externalReferences: [{ type: 'vcs', url: r.remote.replace(/\.git$/, '') }], properties: [prop('kind', 'pinned source repository (build/STANDARDS_MANIFEST.json)'), prop('manifest-entry', key)] });
  }
}
add({ type: 'application', 'bom-ref': 'maven:veraPDF', name: 'veraPDF validation-model-jakarta', version: '1.30.3', purl: 'pkg:maven/org.verapdf/validation-model-jakarta@1.30.3', properties: [prop('kind', 'CI job pdfa-verapdf (Maven Central, checksums verified by mvn -C)')] });

// ---- runtimes, system packages, runner ----
if (!STATIC) {
  add({ type: 'platform', 'bom-ref': 'runtime:node', name: 'Node.js', version: process.version.replace(/^v/, ''), purl: 'pkg:generic/nodejs@' + process.version.replace(/^v/, ''), properties: [prop('kind', 'runtime'), prop('openssl', process.versions.openssl), prop('v8', process.versions.v8)] });
  const jv = run('java', ['-version']);
  if (jv) { const m = /version "([^"]+)"/.exec(jv); add({ type: 'platform', 'bom-ref': 'runtime:java', name: (/(Temurin|OpenJDK|Zulu|Corretto)[^\n]*/.exec(jv) || ['Java'])[0].trim(), version: m ? m[1] : jv.split('\n')[0], properties: [prop('kind', 'runtime')] }); }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const pyv = run(py, ['-I', '-c', 'import sys, importlib.metadata as m\nprint(sys.version.split()[0])\nfor p in ("jsonschema", "referencing", "jsonschema-specifications", "rpds-py", "attrs"):\n    try: print(p, m.version(p))\n    except Exception: pass']);
  if (pyv && /^\d+\.\d+/.test(pyv)) {
    const [ver, ...pk] = pyv.split('\n');
    add({ type: 'platform', 'bom-ref': 'runtime:python', name: 'Python', version: ver.trim(), purl: 'pkg:generic/python@' + ver.trim(), properties: [prop('kind', 'runtime')] });
    for (const l of pk) { const [n, v] = l.trim().split(/\s+/); if (n && v) add({ type: 'library', 'bom-ref': 'pypi:' + n + '@' + v, name: n, version: v, purl: 'pkg:pypi/' + n.toLowerCase() + '@' + v, properties: [prop('kind', 'Python package of the test oracles')] }); }
  }
  const osr = fs.existsSync('/etc/os-release') ? fs.readFileSync('/etc/os-release', 'utf8') : '';
  const osId = (/^ID=(.*)$/m.exec(osr) || [])[1], osVer = (/^VERSION_ID="?([^"\n]*)"?$/m.exec(osr) || [])[1];
  if (osId === 'ubuntu' || osId === 'debian') {
    const dpkg = run('dpkg-query', ['-W', '-f=${Package} ${Version}\n', 'qpdf', 'libqpdf30', 'poppler-utils', 'libpoppler134', 'libexpat1', 'python3-jsonschema', 'python3', 'git', 'curl', 'unzip']);
    for (const l of (dpkg || '').split('\n')) { const [n, v] = l.trim().split(/\s+/); if (n && v && !/no packages found/i.test(l)) add({ type: 'library', 'bom-ref': 'deb:' + n + '@' + v, name: n, version: v, purl: 'pkg:deb/' + osId + '/' + n + '@' + encodeURIComponent(v) + '?distro=' + osId + '-' + osVer, properties: [prop('kind', 'system package of the runner')] }); }
  }
  add({ type: 'platform', 'bom-ref': 'runner', name: process.env.ImageOS ? 'GitHub Actions runner image ' + process.env.ImageOS : (osId ? osId + ' ' + osVer : process.platform), version: process.env.ImageVersion || (osVer || '') || 'local',
    properties: [prop('kind', 'machine of the run'), prop('platform', process.platform + ' ' + process.arch)].concat(process.env.RUNNER_NAME ? [prop('runner', process.env.RUNNER_NAME)] : []) });
}

const commit = run('git', ['-C', root, 'rev-parse', 'HEAD']);
const commitDate = run('git', ['-C', root, 'log', '-1', '--format=%cI']);
const bom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:' + (() => { const h = sha('E-Rechnung Prüfer test environment ' + (STATIC ? 'static ' : '') + JSON.stringify(components)).slice(0, 32).split(''); h[12] = '5'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16); const s = h.join(''); return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20); })(),
  version: 1,
  metadata: {
    timestamp: STATIC && commitDate ? new Date(commitDate).toISOString().replace(/\.\d{3}Z$/, 'Z') : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    lifecycles: [{ phase: STATIC ? 'pre-build' : 'build' }],
    tools: { components: [{ type: 'application', name: 'tools/make-test-bom.cjs (E-Rechnung Prüfer)' }] },
    component: { type: 'application', 'bom-ref': 'verification', name: 'E-Rechnung Prüfer – build and test environment' + (STATIC ? ' (as stated by the repository)' : ''), version: commit || 'unknown', description: 'not part of the program; the program: sbom.cdx.json' },
    properties: [prop('commit', commit || ''), prop('mode', STATIC ? 'static (repository: workflows, package-lock.json, manifest)' : 'environment of this run')],
  },
  components,
  dependencies: [{ ref: 'verification', dependsOn: components.map((c) => c['bom-ref']) }].concat(components.map((c) => ({ ref: c['bom-ref'] }))),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bom, (k, v) => (v === undefined ? undefined : v), 2) + '\n');
const unpinned = components.filter((c) => (c.properties || []).some((p) => p.value === 'NOT PINNED'));
console.log(out + ': test environment, ' + components.length + ' components (' + Object.entries(components.reduce((o, c) => { const k2 = c['bom-ref'].split(':')[0]; o[k2] = (o[k2] || 0) + 1; return o; }, {})).map(([k2, n]) => k2 + ' ' + n).join(', ') + ')' + (unpinned.length ? '; NOT PINNED: ' + unpinned.map((c) => c['bom-ref']).join(' ') : ''));
if (unpinned.length && args.includes('--require-pinned')) process.exit(1);
