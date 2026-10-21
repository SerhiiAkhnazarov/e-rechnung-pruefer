#!/usr/bin/env node
/*
 * check-security-txt.cjs — weekly check of the published security.txt files (RFC 9116; drift.yml): the file of the
 * project site must be served (HTTPS, no redirect, text/plain; charset=utf-8) and must not expire within the next
 * 30 days; the file at the root of the domain (user site SerhiiAkhnazarov.github.io, optional) is checked the same way
 * when it exists and must then have the same content. A file about to expire is renewed by a new securityTxtExpires
 * in legal/security.json (at most a year ahead) and a new build.
 *
 * Usage: node tools/check-security-txt.cjs [--out build/reports/security-txt.txt]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sec = JSON.parse(fs.readFileSync(path.join(root, 'legal', 'security.json'), 'utf8'));
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? path.resolve(args[oi + 1]) : null;
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const DAY = 864e5;

async function get(url) {
  const r = await fetch(url + '?check=' + Date.now(), { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' } });
  return { status: r.status, type: r.headers.get('content-type') || '', text: r.status === 200 ? await r.text() : '' };
}

(async () => {
  let failed = false;
  const project = sec.site + '.well-known/security.txt';
  const rootUrl = sec.securityTxtCanonical.find((u) => u !== project);
  log('# security.txt check, ' + new Date().toISOString());
  let projectText = null;
  for (const [url, required] of [[project, true], [rootUrl, false]].filter(([u]) => u)) {
    let r;
    try { r = await get(url); } catch (e) { r = { status: 'error ' + e.message, type: '', text: '' }; }
    if (r.status !== 200) {
      log(url + ': ' + r.status + (required ? ' – MISSING' : ' – not present (optional: user site with .well-known/security.txt, docs/SICHERHEIT.md)'));
      if (required) failed = true;
      continue;
    }
    const exp = /^Expires: (\S+)$/m.exec(r.text);
    const left = exp ? Math.floor((Date.parse(exp[1]) - Date.now()) / DAY) : null;
    const problems = [];
    if (!/^text\/plain;\s*charset=utf-8$/i.test(r.type)) problems.push('Content-Type ' + r.type);
    if (!/^Contact: /m.test(r.text)) problems.push('no Contact');
    if (left === null) problems.push('no Expires');
    else if (left < 30) problems.push('expires in ' + left + ' days – renew securityTxtExpires in legal/security.json');
    if (url === project) projectText = r.text;
    else if (projectText !== null && r.text !== projectText) problems.push('differs from ' + project);
    log(url + ': served, Expires ' + (exp ? exp[1] : '?') + ' (' + left + ' days)' + (problems.length ? ' – ' + problems.join('; ') : ' – ok'));
    if (problems.length) failed = true;
  }
  log(failed ? 'RESULT: not passed' : 'RESULT: passed');
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, lines.join('\n') + '\n'); }
  process.exit(failed ? 1 : 0);
})();
