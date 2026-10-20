#!/usr/bin/env node
/*
 * compare-platforms.cjs — job "platforms" of .github/workflows/verify.yml: the Linux run (job verify: Chromium,
 * WebKit, Firefox) and the Windows run (job windows: Microsoft Edge, Google Chrome) of one commit must have
 * verified the same sources and the same program:
 *   - filesId of both VERIFICATION.json (tools/fingerprint.cjs: every input file, byte by byte),
 *   - commit of both runs = the commit of this workflow run, both without uncommitted changes,
 *   - programSha256 of both BUILD_INFO.json (tools/build-standalone.cjs: the tested page without its build note),
 *   - every suite of both runs passed.
 * Not an input of the verification (not in tools/fingerprint.cjs).
 *
 * Usage: node .github/scripts/compare-platforms.cjs <linux artifact dir> <windows artifact dir> <commit>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [linuxDir, windowsDir, commit] = process.argv.slice(2);
if (!linuxDir || !windowsDir || !commit) { console.error('usage: compare-platforms.cjs <linux dir> <windows dir> <commit>'); process.exit(2); }
const read = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return { error: e.message }; } };
const runs = [['Linux (verify)', linuxDir], ['Windows (windows)', windowsDir]].map(([name, dir]) => {
  const v = read(dir, 'build/reports/VERIFICATION.json');
  const b = read(dir, 'dist/BUILD_INFO.json');
  const suites = Object.entries(v.suites || {});
  return {
    name, error: v.error || b.error,
    filesId: v.fingerprint && v.fingerprint.filesId, commit: v.fingerprint && v.fingerprint.git && v.fingerprint.git.commit,
    dirty: !!(v.fingerprint && v.fingerprint.git && v.fingerprint.git.dirty), environment: v.environment,
    programSha256: b.programSha256, pageSha256: b.sha256,
    passed: suites.filter(([, s]) => s.status === 'pass').length, total: suites.length,
    notPassed: suites.filter(([, s]) => s.status !== 'pass').map(([n, s]) => n + ' (' + s.status + ')'),
  };
});
const problems = [];
for (const r of runs) {
  if (r.error) problems.push(r.name + ': ' + r.error);
  if (r.commit !== commit) problems.push(r.name + ': commit ' + r.commit + ' instead of ' + commit);
  if (r.dirty) problems.push(r.name + ': inputs with uncommitted changes');
  if (!r.total || r.notPassed.length) problems.push(r.name + ': suites not passed: ' + (r.notPassed.join(', ') || 'none recorded'));
}
const [L, W] = runs;
if (!L.filesId || L.filesId !== W.filesId) problems.push('filesId differs: Linux ' + L.filesId + ', Windows ' + W.filesId);
if (!L.programSha256 || L.programSha256 !== W.programSha256) problems.push('programSha256 differs: Linux ' + L.programSha256 + ', Windows ' + W.programSha256);

console.log('| | Linux (job verify) | Windows (job windows) |');
console.log('|---|---|---|');
for (const [label, key] of [['commit', 'commit'], ['filesId (Eingabedateien)', 'filesId'], ['programSha256 (getestete Seite ohne Build-Vermerk)', 'programSha256'], ['SHA-256 der Seite (mit Build-Vermerk)', 'pageSha256'], ['Umgebung', 'environment']]) {
  console.log('| ' + label + ' | `' + L[key] + '` | `' + W[key] + '` |');
}
console.log('| Testreihen bestanden | ' + L.passed + ' / ' + L.total + ' | ' + W.passed + ' / ' + W.total + ' |');
console.log('');
console.log(problems.length ? 'PLATFORM COMPARISON FAILED:\n- ' + problems.join('\n- ') : 'platform comparison: identical inputs (filesId) and identical program (programSha256) on Linux and Windows; all suites of both runs passed');
process.exit(problems.length ? 1 : 0);
