#!/usr/bin/env node
/*
 * check-published.cjs — reads the published site (GitHub Pages) back over HTTPS and checks that it is the
 * verified build of one commit:
 *   1. E-Rechnung-Pruefer.html: SHA-256 = "sha256" of BUILD_INFO.json (and = --expect-sha256 when given);
 *      index.html is byte-identical with it;
 *   2. BUILD_INFO.json: "programSha256" present (the page without its build note = the program tested in the
 *      CI jobs, tools/build-standalone.cjs), "fingerprint" = fingerprint id of VERIFICATION.json;
 *   3. VERIFICATION.json: produced on GitHub Actions for --commit, every suite passed (none failed, none not run);
 *   4. STANDARDS_MANIFEST.json: SHA-256 = "manifestSha256" of BUILD_INFO.json.
 * GitHub Pages answers through a CDN (cached for up to 10 minutes): every request carries ?commit=<sha>, and the
 * check is repeated (--retries, --wait seconds) until the files of that commit are served.
 * --out <dir>: writes the four files and SHA256SUMS.txt there (the assets of a release, release.yml).
 *
 * Usage: node tools/check-published.cjs <base-url> --commit <sha> [--expect-sha256 <hex>] [--out <dir>]
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
const retries = parseInt(opt('--retries', '20'), 10);
const wait = parseInt(opt('--wait', '30'), 10);
// https, or a server on this machine (tests of this script)
if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(base) || !commit) {
  console.error('usage: node tools/check-published.cjs <https base-url> --commit <sha> [--expect-sha256 <hex>] [--out <dir>] [--retries N] [--wait s]');
  process.exit(2);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const FILES = ['E-Rechnung-Pruefer.html', 'index.html', 'BUILD_INFO.json', 'VERIFICATION.json', 'STANDARDS_MANIFEST.json'];

async function fetchAll() {
  const got = {};
  for (const f of FILES) {
    const url = base + (f === 'index.html' ? '' : f) + '?commit=' + encodeURIComponent(commit);
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
    got[f] = Buffer.from(await r.arrayBuffer());
  }
  return got;
}

function check(got) {
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
          const assets = FILES.filter((f) => f !== 'index.html');
          for (const f of assets) fs.writeFileSync(path.join(outDir, f), got[f]);
          fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), assets.map((f) => sha(got[f]) + '  ' + f).join('\n') + '\n');
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
