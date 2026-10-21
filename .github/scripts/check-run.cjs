#!/usr/bin/env node
/*
 * check-run.cjs — payload of a GitHub check run that makes a CI result readable through the REST API
 * (GET /repos/{owner}/{repo}/commits/{sha}/check-runs → output.summary / output.text), independently of the
 * job log: one table row per test suite of build/reports/VERIFICATION.json (status, summary line), the
 * fingerprint, and for every suite that did not pass the end of its report file; attached files (e.g. the
 * veraPDF comparison) are appended in full as far as the size limit of a check run allows.
 * Used by .github/workflows/verify.yml; not an input of the verification (not in tools/fingerprint.cjs).
 *
 * Usage: node .github/scripts/check-run.cjs --name <check name> --sha <commit> [--verification <file>]
 *          [--require a,b,...] [--gate <outcome of a step> [--gate-label <text>]] [--attach <file>]... > payload.json
 *   exit code 1 when VERIFICATION.json is missing or unreadable, a suite failed, a required suite did not
 *   pass, or the gate outcome is not "success" (the payload is written in every case)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const all = (n) => args.flatMap((a, i) => (a === n && i + 1 < args.length ? [args[i + 1]] : []));
const MAX = 65000; // GitHub: 65 535 characters per output field
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// a Markdown table cell: backslashes first, then the pipes that would end the cell, line breaks as spaces
const cell = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const readTail = (file, lines) => {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n'); } catch (e) { return '(' + file + ': ' + e.code + ')'; }
};

const name = opt('--name') || 'verification report';
const sha = opt('--sha') || process.env.GITHUB_SHA;
const vfile = opt('--verification');
const required = (opt('--require') || '').split(',').filter(Boolean);
const gate = opt('--gate');
const gateLabel = opt('--gate-label') || 'Prüfschritt';
if (!sha) { console.error('check-run: no commit (--sha or GITHUB_SHA)'); process.exit(2); }

let v = null;
let readError = null;
if (vfile) { try { v = JSON.parse(fs.readFileSync(vfile, 'utf8')); } catch (e) { readError = e.message; } }
const suites = v && v.suites ? Object.entries(v.suites) : [];
const count = (st) => suites.filter(([, s]) => s.status === st).length;
const passed = count('pass');
const failed = count('FAIL');
const notRun = suites.length - passed - failed;
const missing = required.filter((r) => !v || !v.suites || !v.suites[r] || v.suites[r].status !== 'pass');
const ok = !readError && (!vfile || v) && failed === 0 && missing.length === 0 && (gate == null || gate === 'success');

const fp = v && v.fingerprint ? v.fingerprint : null;
const lines = [];
if (vfile) {
  lines.push(readError ? '**' + vfile + ' fehlt oder ist nicht lesbar:** ' + readError : passed + ' von ' + suites.length + ' Testreihen bestanden, ' + failed + ' fehlgeschlagen, ' + notRun + ' nicht gelaufen.');
  if (fp) lines.push('', 'Fingerprint `' + fp.id + '` (Dateien `' + fp.filesId + '`), Commit `' + (fp.git && fp.git.commit) + '`' + (fp.git && fp.git.dirty ? ' (mit Änderungen)' : '') + ', Umgebung: ' + (v.environment || '?') + ', erzeugt ' + (v.generated || '?'));
  if (gate != null) lines.push('', gateLabel + ': **' + gate + '**');
  if (required.length) lines.push('', 'Erforderliche Testreihen: ' + required.map((r) => '`' + r + '`').join(', ') + (missing.length ? ' — **nicht bestanden: ' + missing.join(', ') + '**' : ' — alle bestanden'));
  if (suites.length) {
    lines.push('', '| Testreihe | Status | Ergebnis |', '|---|---|---|');
    for (const [n, s] of suites) lines.push('| ' + cell(n) + ' | ' + cell(s.status) + ' | ' + cell(cut(s.summary || s.reason || '', 600)) + ' |');
  }
} else if (gate != null) {
  lines.push(gateLabel + ': **' + gate + '**');
}
let summary = lines.join('\n');
if (summary.length > MAX) summary = cut(summary, MAX);

const blocks = [];
for (const [n, s] of suites) {
  if (s.status === 'pass') continue;
  blocks.push('### ' + n + ' (' + s.status + ')\n\n' + (s.status === 'not-run' ? (s.reason || '') : '```\n' + readTail(s.report || ('build/reports/' + n + '.txt'), 80) + '\n```'));
}
for (const f of all('--attach')) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch (e) { t = '(' + f + ': ' + e.code + ')'; }
  blocks.push('### ' + f + '\n\n```\n' + t + '\n```');
}
let text = blocks.join('\n\n');
if (text.length > MAX) text = cut(text, MAX);

const title = !vfile ? name + ': ' + (gate == null ? 'ohne Prüfschritt' : gate) : readError ? 'Bericht fehlt' : passed + ' von ' + suites.length + ' Testreihen bestanden, ' + failed + ' fehlgeschlagen, ' + notRun + ' nicht gelaufen';
const payload = { name, head_sha: sha, status: 'completed', conclusion: ok ? 'success' : 'failure', output: { title: cut(title, 250), summary: summary || name } };
if (text) payload.output.text = text;
process.stdout.write(JSON.stringify(payload));
process.exit(ok ? 0 : 1);
