#!/usr/bin/env node
/*
 * check-published.cjs — reads the published site (GitHub Pages) back over HTTPS and checks that it is the
 * verified build of one commit:
 *   1. E-Rechnung-Pruefer.html: SHA-256 = "sha256" of BUILD_INFO.json (and = --expect-sha256 when given);
 *      index.html is byte-identical with it;
 *   2. BUILD_INFO.json: "programSha256" present (the page without its build note = the program tested in the
 *      CI jobs, tools/build-standalone.cjs), "fingerprint" = fingerprint id of VERIFICATION.json;
 *   3. VERIFICATION.json: produced on GitHub Actions for --commit, every suite passed (none failed, none not run);
 *   4. STANDARDS_MANIFEST.json: SHA-256 = "manifestSha256" of BUILD_INFO.json;
 *   5. sbom.cdx.json (CycloneDX 1.6, tools/make-sbom.cjs): the SBOM of this page – version and SHA-256 of the page,
 *      programSha256 and manifestSha256 as in BUILD_INFO.json; vex.cdx.json refers to this SBOM (BOM-Link) and version;
 *      test-environment.cdx.json is the environment of this commit;
 *   6. .well-known/security.txt (RFC 9116): served directly (no redirect), Content-Type text/plain; charset=utf-8,
 *      Expires more than 30 days ahead; .well-known/csaf/provider-metadata.json served directly (CSAF requirement 6);
 *   7. with --local <dir> (the directory that was deployed, pages.yml): every file of it is served byte for byte.
 * GitHub Pages answers through a CDN (cached for up to 10 minutes): every request carries ?commit=<sha>, and the
 * check is repeated (--retries, --wait seconds) until the files of that commit are served.
 * --out <dir>: writes the files of the release and SHA256SUMS.txt there (the assets of a release, release.yml).
 *
 * Usage: node tools/check-published.cjs <base-url> --commit <sha> [--expect-sha256 <hex>] [--out <dir>] [--local <dir>]
 *          [--retries 20] [--wait 30]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const base = (args[0] || '').replace(/\/?$/, '/');
const commit = opt('--commit', null);
const expectSha = opt('--expect-sha256', null);
const outDir = opt('--out', null);
const localDir = opt('--local', null);
const retries = parseInt(opt('--retries', '20'), 10);
const wait = parseInt(opt('--wait', '30'), 10);
// https, or a server on this machine (tests of this script)
if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(base) || !commit) {
  console.error('usage: node tools/check-published.cjs <https base-url> --commit <sha> [--expect-sha256 <hex>] [--out <dir>] [--retries N] [--wait s]');
  process.exit(2);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const FILES = ['E-Rechnung-Pruefer.html', 'index.html', 'BUILD_INFO.json', 'VERIFICATION.json', 'STANDARDS_MANIFEST.json', 'sbom.cdx.json', 'vex.cdx.json', 'test-environment.cdx.json', '.well-known/security.txt', '.well-known/csaf/provider-metadata.json'];
// the assets of a release: the program, its build information, verification report, manifest, SBOM, VEX, environment
const ASSETS = ['E-Rechnung-Pruefer.html', 'BUILD_INFO.json', 'VERIFICATION.json', 'STANDARDS_MANIFEST.json', 'sbom.cdx.json', 'vex.cdx.json', 'test-environment.cdx.json'];

const localFiles = () => {
  const outList = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else outList.push(r); } })(localDir, '');
  return outList;
};

async function get(f) {
  const url = base + (f === 'index.html' ? '' : f) + '?commit=' + encodeURIComponent(commit);
  // no redirect is followed: every file is served directly (CSAF 2.0 requirement 6, RFC 9116)
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'manual' });
  if (r.status !== 200) throw new Error(url + ': HTTP ' + r.status + (r.headers.get('location') ? ' -> ' + r.headers.get('location') : ''));
  return { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
}

async function fetchAll() {
  const got = {}, types = {};
  for (const f of FILES) { const r = await get(f); got[f] = r.bytes; types[f] = r.type; }
  if (localDir) {
    for (const f of localFiles()) {
      if (got[f]) continue;
      const r = await get(f);
      got[f] = r.bytes; types[f] = r.type;
    }
  }
  return { got, types };
}

function check(all) {
  const got = all.got, types = all.types;
  const problems = [];
  const lines = [];
  const page = got['E-Rechnung-Pruefer.html'];
  let info, ver;
  try { info = JSON.parse(got['BUILD_INFO.json'].toString('utf8')); } catch (e) { problems.push('BUILD_INFO.json: ' + e.message); }
  try { ver = JSON.parse(got['VERIFICATION.json'].toString('utf8')); } catch (e) { problems.push('VERIFICATION.json: ' + e.message); }
  if (problems.length) return { problems, lines };
  const pageSha = sha(page);
  lines.push('page ' + base + 'E-Rechnung-Pruefer.html: ' + page.length + ' bytes, SHA-256 ' + pageSha);
  if (pageSha !== info.sha256) problems.push('SHA-256 of the page ' + pageSha + ' != BUILD_INFO.json sha256 ' + info.sha256);
  if (expectSha && pageSha !== expectSha) problems.push('SHA-256 of the page ' + pageSha + ' != expected ' + expectSha);
  if (!got['index.html'].equals(page)) problems.push('index.html differs from E-Rechnung-Pruefer.html');
  if (!/^[0-9a-f]{64}$/.test(info.programSha256 || '')) problems.push('BUILD_INFO.json has no programSha256');
  lines.push('version ' + info.version + ', program SHA-256 ' + info.programSha256 + ', verification: ' + info.verification);
  const fp = ver.fingerprint || {};
  const suites = Object.entries(ver.suites || {});
  const notPassed = suites.filter(([, s]) => s.status !== 'pass').map(([n, s]) => n + ' (' + s.status + ')');
  lines.push('VERIFICATION.json: ' + suites.length + ' suites, ' + (suites.length - notPassed.length) + ' passed; ' + (ver.environment || '?') + ', commit ' + (fp.git && fp.git.commit) + ', fingerprint ' + fp.id);
  if (!suites.length) problems.push('VERIFICATION.json lists no suite');
  if (notPassed.length) problems.push('suites not passed: ' + notPassed.join(', '));
  if (!/^GitHub Actions/.test(ver.environment || '')) problems.push('VERIFICATION.json was not produced on GitHub Actions (' + ver.environment + ')');
  if (!fp.git || fp.git.commit !== commit) problems.push('VERIFICATION.json belongs to commit ' + (fp.git && fp.git.commit) + ', not ' + commit);
  if (fp.git && fp.git.dirty) problems.push('VERIFICATION.json was produced from inputs with uncommitted changes');
  if (info.fingerprint !== fp.id) problems.push('BUILD_INFO.json fingerprint ' + info.fingerprint + ' != VERIFICATION.json ' + fp.id);
  const manSha = sha(got['STANDARDS_MANIFEST.json']);
  if (manSha !== info.manifestSha256) problems.push('SHA-256 of STANDARDS_MANIFEST.json ' + manSha + ' != BUILD_INFO.json manifestSha256 ' + info.manifestSha256);
  let bom = null;
  try { bom = JSON.parse(got['sbom.cdx.json'].toString('utf8')); } catch (e) { problems.push('sbom.cdx.json: ' + e.message); }
  if (bom) {
    const top = (bom.metadata && bom.metadata.component) || {};
    const prop = (n) => ((top.properties || []).find((p) => p.name === n) || {}).value;
    lines.push('sbom.cdx.json: CycloneDX ' + bom.specVersion + ', ' + (bom.components || []).length + ' components, version ' + top.version);
    if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') problems.push('sbom.cdx.json is not CycloneDX 1.6');
    if (top.version !== info.version) problems.push('sbom.cdx.json version ' + top.version + ' != BUILD_INFO.json ' + info.version);
    const h256 = (top.hashes || []).find((h) => h.alg === 'SHA-256');
    if (!h256 || h256.content !== pageSha) problems.push('sbom.cdx.json: SHA-256 of the program differs from the page');
    if (prop('e-rechnung-pruefer:programSha256') !== info.programSha256 || prop('e-rechnung-pruefer:manifestSha256') !== info.manifestSha256) problems.push('sbom.cdx.json: programSha256 / manifestSha256 differ from BUILD_INFO.json');
    let vex = null;
    try { vex = JSON.parse(got['vex.cdx.json'].toString('utf8')); } catch (e) { problems.push('vex.cdx.json: ' + e.message); }
    if (vex) {
      const link = 'urn:cdx:' + String(bom.serialNumber).replace(/^urn:uuid:/, '') + '/' + bom.version + '#';
      const refs = (vex.vulnerabilities || []).flatMap((v) => (v.affects || []).map((a) => a.ref));
      lines.push('vex.cdx.json: ' + (vex.vulnerabilities || []).length + ' statements on components of this SBOM');
      if (!vex.metadata || !vex.metadata.component || vex.metadata.component.version !== info.version) problems.push('vex.cdx.json is not the VEX of version ' + info.version);
      if (refs.some((r) => !r.startsWith(link))) problems.push('vex.cdx.json refers to another SBOM than sbom.cdx.json');
    }
  }
  let env = null;
  try { env = JSON.parse(got['test-environment.cdx.json'].toString('utf8')); } catch (e) { problems.push('test-environment.cdx.json: ' + e.message); }
  if (env) {
    const c = ((env.metadata || {}).properties || []).find((p) => p.name === 'e-rechnung-pruefer:commit');
    lines.push('test-environment.cdx.json: ' + (env.components || []).length + ' components of the build and test environment');
    if (!c || c.value !== commit) problems.push('test-environment.cdx.json belongs to commit ' + (c && c.value) + ', not ' + commit);
  }
  const txt = got['.well-known/security.txt'].toString('utf8');
  const exp = /^Expires: (\S+)$/m.exec(txt);
  lines.push('.well-known/security.txt: ' + types['.well-known/security.txt'] + ', Expires ' + (exp ? exp[1] : 'missing'));
  if (!/^text\/plain;\s*charset=utf-8$/i.test(types['.well-known/security.txt'])) problems.push('security.txt is served as ' + types['.well-known/security.txt'] + ', not text/plain; charset=utf-8 (RFC 9116)');
  if (!exp || Date.parse(exp[1]) - Date.now() < 30 * 864e5) problems.push('security.txt expires in less than 30 days (' + (exp && exp[1]) + '): renew legal/security.json securityTxtExpires');
  try { const m = JSON.parse(got['.well-known/csaf/provider-metadata.json'].toString('utf8')); lines.push('CSAF provider metadata: role ' + m.role + ', ' + m.distributions.map((d) => d.directory_url).join(' ')); } catch (e) { problems.push('provider-metadata.json: ' + e.message); }
  if (localDir) {
    const files = localFiles();
    const differ = files.filter((f) => !got[f] || !got[f].equals(fs.readFileSync(path.join(localDir, f))));
    lines.push('deployed directory ' + localDir + ': ' + (files.length - differ.length) + ' of ' + files.length + ' files served byte for byte');
    if (differ.length) problems.push('served files differ from the deployed directory: ' + differ.slice(0, 8).join(', '));
  }
  return { problems, lines };
}

(async () => {
  let last = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
    try {
      const got = await fetchAll();
      const r = check(got);
      if (!r.problems.length) {
        for (const l of r.lines) console.log(l);
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          const assets = ASSETS;
          for (const f of assets) fs.writeFileSync(path.join(outDir, f), got.got[f]);
          fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), assets.map((f) => sha(got.got[f]) + '  ' + f).join('\n') + '\n');
          console.log('written to ' + outDir + ': ' + assets.concat('SHA256SUMS.txt').join(', '));
        }
        console.log('published site verified (attempt ' + attempt + '): the files of commit ' + commit + ' are served');
        process.exit(0);
      }
      last = r.problems.concat(r.lines);
    } catch (e) { last = [e.message]; }
    console.log('attempt ' + attempt + '/' + retries + ': ' + last[0]);
    if (attempt < retries) await new Promise((res) => setTimeout(res, wait * 1000));
  }
  console.log('PUBLISHED SITE NOT VERIFIED:\n  ' + last.join('\n  '));
  process.exit(1);
})();
