#!/usr/bin/env node
/*
 * osv-scan.cjs — scans the program and the build and test environment for known vulnerabilities with OSV-Scanner
 * (https://github.com/google/osv-scanner, database https://osv.dev: GitHub Advisory Database, NVD-derived and
 * ecosystem advisories) and checks every finding against the assessments of security/vex.json.
 *
 *   program      dist/sbom.cdx.json flattened: every component with a package URL, including the upstream releases
 *                the program derives from (pedigree ancestors: fontoxpath, xspattern, Apache Xerces-J …), because
 *                OSV-Scanner reads only the components of an SBOM, not their pedigree;
 *   environment  the bills of materials given with --env (tools/make-test-bom.cjs) and the npm lock file of the test
 *                tools (package-lock.json, when present).
 *
 * A finding for the program that security/vex.json does not assess (by its id or an alias) fails the scan (exit 1):
 * it has to be assessed – and fixed when the program is affected (SECURITY.md). Findings for the environment are
 * reported (exit 0) unless --fail-env is given; they never concern the program, but are fixed by updating the tool.
 *
 * Usage: node tools/osv-scan.cjs [--scanner <osv-scanner binary>] [--env <bom.cdx.json>]… [--offline <db dir>]
 *          [--fail-env] [--out build/reports/osv-scan.txt]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const all = (n) => args.reduce((a, x, i) => (x === n ? a.concat([args[i + 1]]) : a), []);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const scanner = opt('--scanner', process.env.OSV_SCANNER || 'osv-scanner');
const offline = opt('--offline', null);
const out = path.resolve(opt('--out', path.join(root, 'build', 'reports', 'osv-scan.txt')));
const envBoms = all('--env');
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

// ---- the program, flattened ----
const sbom = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'sbom.cdx.json'), 'utf8'));
const flat = [];
const seen = new Set();
const take = (c, via) => {
  if (c.purl && !seen.has(c.purl)) { seen.add(c.purl); flat.push({ type: c.type === 'data' ? 'data' : 'library', 'bom-ref': 'scan:' + flat.length, name: c.name, version: c.version, purl: c.purl, properties: [{ name: 'e-rechnung-pruefer:sbom-component', value: via }] }); }
  for (const a of ((c.pedigree || {}).ancestors || [])) take(a, via + ' (ancestor)');
};
take(sbom.metadata.component, sbom.metadata.component['bom-ref']);
for (const c of sbom.components) take(c, c['bom-ref']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osv-scan-'));
const programBom = path.join(tmp, 'program.cdx.json');
fs.writeFileSync(programBom, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, metadata: { component: { type: 'application', name: 'E-Rechnung Prüfer (flattened for scanning)', version: sbom.metadata.component.version } }, components: flat }, null, 2));
log('# OSV scan, ' + new Date().toISOString() + ', E-Rechnung Prüfer ' + sbom.metadata.component.version);
log('program: ' + flat.length + ' package URLs (components and pedigree ancestors): ' + flat.map((c) => c.purl.replace(/^pkg:/, '')).join(', '));

function scan(label, argsList) {
  const env = Object.assign({}, process.env);
  const a = ['scan', 'source', '--format', 'json'].concat(offline ? ['--offline-vulnerabilities'] : []).concat(argsList);
  if (offline) env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY = offline;
  const r = spawnSync(scanner, a, { encoding: 'utf8', env, maxBuffer: 256 * 1048576 });
  if (r.error) throw new Error('osv-scanner could not be run (' + scanner + '): ' + r.error.message);
  // exit 0: nothing found, 1: vulnerabilities found, 128: no packages; anything else is an error of the scanner
  if (![0, 1, 128].includes(r.status)) throw new Error(label + ': osv-scanner exit code ' + r.status + '\n' + (r.stderr || '').split('\n').slice(-15).join('\n'));
  let res = { results: [] };
  try { res = JSON.parse(r.stdout || '{"results":[]}'); } catch (e) { throw new Error(label + ': no JSON from osv-scanner: ' + (r.stdout || '').slice(0, 300)); }
  const found = [];
  for (const rr of res.results || []) for (const p of rr.packages || []) for (const v of p.vulnerabilities || []) found.push({ pkg: p.package.ecosystem + ':' + p.package.name + '@' + p.package.version, id: v.id, aliases: v.aliases || [], summary: v.summary || '' });
  const pkgCount = (res.results || []).reduce((n, rr) => n + (rr.packages || []).length, 0);
  return { found, pkgCount, version: (/osv-scanner version: (\S+)/.exec(spawnSync(scanner, ['--version'], { encoding: 'utf8' }).stdout || '') || [])[1] };
}

let failed = false;
try {
  const vex = JSON.parse(fs.readFileSync(path.join(root, 'security', 'vex.json'), 'utf8')).statements;
  const assessed = new Map();
  for (const s of vex) for (const id of [s.id].concat(s.aliases || [])) assessed.set(id, s);
  const p = scan('program', ['-L', programBom]);
  log('osv-scanner ' + (p.version || '?') + (offline ? ' (offline database ' + offline + ')' : ' (osv.dev)'));
  log('program: ' + p.found.length + ' known vulnerabilities in ' + p.pkgCount + ' packages with findings');
  for (const f of p.found) {
    const s = [f.id].concat(f.aliases).map((x) => assessed.get(x)).find(Boolean);
    log('  ' + f.pkg + ' ' + f.id + (f.aliases.length ? ' (' + f.aliases.join(', ') + ')' : '') + ': ' + (s ? 'assessed in security/vex.json – ' + s.state + (s.justification ? ' (' + s.justification + ')' : '') : 'NOT ASSESSED') + (f.summary ? ' – ' + f.summary : ''));
    if (!s) failed = true;
  }
  // offline (a local database, tests of this script): only the ecosystems of that database; online every ecosystem
  // (pkg:github: GitHub Actions advisories are matched by osv.dev; the local matcher of OSV-Scanner has no version
  // scheme for that ecosystem)
  const DB = { npm: 'npm', maven: 'Maven', pypi: 'PyPI', github: null, deb: null, generic: null };
  const available = (purl) => { const t = /^pkg:([^/]+)\//.exec(purl || ''); if (!t) return false; const eco = DB[t[1]]; return !offline || (eco ? fs.existsSync(path.join(offline, 'osv-scalibr', eco, 'all.zip')) : false); };
  const envFiles = envBoms.map((b) => {
    if (!offline) return path.resolve(b);
    const bom = JSON.parse(fs.readFileSync(b, 'utf8'));
    const kept = (bom.components || []).filter((c) => available(c.purl));
    log('offline: ' + path.basename(b) + ' – ' + kept.length + ' of ' + (bom.components || []).length + ' components in ecosystems of the local database');
    const f = path.join(tmp, 'env-' + path.basename(b));
    fs.writeFileSync(f, JSON.stringify(Object.assign({}, bom, { components: kept, dependencies: undefined })));
    return f;
  });
  const envArgs = envFiles.flatMap((f) => ['-L', f]).concat(fs.existsSync(path.join(root, 'package-lock.json')) ? ['-L', path.join(root, 'package-lock.json')] : []);
  if (envArgs.length) {
    const e = scan('environment', envArgs);
    log('environment (' + envArgs.filter((x) => x !== '-L').map((x) => path.basename(x)).join(', ') + '): ' + e.found.length + ' known vulnerabilities');
    for (const f of e.found) log('  ' + f.pkg + ' ' + f.id + (f.aliases.length ? ' (' + f.aliases.join(', ') + ')' : '') + (f.summary ? ' – ' + f.summary : ''));
    if (e.found.length && args.includes('--fail-env')) failed = true;
  }
} catch (e) {
  log('SCAN ERROR: ' + e.message);
  failed = true;
}
log(failed ? 'RESULT: not passed – assess every finding in security/vex.json (and fix the program where it is affected)' : 'RESULT: passed – no unassessed vulnerability in the program');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
