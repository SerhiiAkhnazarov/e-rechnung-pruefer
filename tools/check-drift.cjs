#!/usr/bin/env node
/*
 * check-drift.cjs — detects new upstream versions of the standards this build is pinned to.
 * For every source repository in build/STANDARDS_MANIFEST.json with a remote it lists the remote's
 * tags and branch heads (git ls-remote, nothing is downloaded) and reports
 *   - tags that did not exist when the manifest was made (new release candidates),
 *   - whether the pinned commit is still reachable under a tag or branch head of the remote,
 *   - for Peppol (pinned to a branch head, see the manifest note): whether that branch has moved.
 * Versions reviewed and deliberately not adopted are listed with their reason in build/drift-acknowledged.json.
 * Exit code 1 when anything relevant changed, so a scheduled CI job (.github/workflows/drift.yml)
 * turns red and the pinned versions are reviewed (versions in force: README.md, section "Was geprüft wird").
 *
 * Usage: node tools/check-drift.cjs [--out build/reports/drift.txt]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
// reviewed upstream versions that are deliberately not adopted (with reason): build/drift-acknowledged.json
const ackFile = path.join(root, 'build', 'drift-acknowledged.json');
const ack = fs.existsSync(ackFile) ? JSON.parse(fs.readFileSync(ackFile, 'utf8')) : {};

// repositories that define what the product checks (test corpora and tools are reported, not failed)
const PRODUCT = ['einvoicing-en16931', 'xrechnung-schematron', 'validator-configuration-xrechnung', 'peppol-bis-invoice-3', 'mustangproject', 'validator'];
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
let drift = 0;

function lsRemote(url) {
  const r = spawnSync('git', ['ls-remote', '--tags', '--heads', url], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return null;
  const refs = {};
  for (const l of r.stdout.split('\n')) { const [sha, ref] = l.split('\t'); if (ref) refs[ref.replace(/\^\{\}$/, '')] = refs[ref.replace(/\^\{\}$/, '')] && !ref.endsWith('^{}') ? refs[ref.replace(/\^\{\}$/, '')] : sha; }
  return refs;
}
function entries(src) { return src.repos ? src.repos : [src]; }

log('# drift check against build/STANDARDS_MANIFEST.json (generated ' + manifest.generated + '), ' + new Date().toISOString());
const madeAt = Date.parse(manifest.generated);
for (const [name, src] of Object.entries(manifest.sources)) {
  for (const repo of entries(src)) {
    if (!repo.remote || !repo.commit) continue;
    const logicalName = String(repo.path || '').split('/')[0];
    const product = PRODUCT.includes(logicalName);
    const refs = lsRemote(repo.remote);
    if (!refs) { log('?  ' + logicalName + ': remote not reachable (' + repo.remote + ')'); if (product) drift++; continue; }
    const tags = Object.keys(refs).filter((r) => r.startsWith('refs/tags/')).map((r) => r.slice(10));
    const pinnedTag = tags.find((t) => refs['refs/tags/' + t] === repo.commit);
    const heads = Object.keys(refs).filter((r) => r.startsWith('refs/heads/') && refs[r] === repo.commit).map((r) => r.slice(11));
    const known = new Set(Object.keys(ack[logicalName] || {}));
    const acknowledged = tags.filter((t) => known.has(t));
    // tags newer than the pinned describe: compare by version numbers where possible
    const base = (repo.describe || '').replace(/-\d+-g[0-9a-f]+$/, '');
    const ver = (t) => (t.match(/\d+/g) || []).map(Number);
    const newer = tags.filter((t) => !known.has(t) && cmpVer(ver(t), ver(base)) > 0 && sameFamily(t, base));
    let status = pinnedTag ? 'pinned = tag ' + pinnedTag : heads.length ? 'pinned = head of ' + heads.join(', ') : 'pinned commit ' + repo.commit.slice(0, 12) + ' (' + (repo.describe || '-') + ')';
    if (logicalName === 'peppol-bis-invoice-3') {
      const branch = (name.match(/branch ([^,)]+)/) || [])[1];
      const head = branch && refs['refs/heads/' + branch];
      if (branch && head !== repo.commit) { status += '; branch ' + branch + ' ' + (head ? 'moved to ' + head.slice(0, 12) : 'deleted'); if (product) drift++; }
      // OpenPeppol prepares each release on quarter branches (YYYY-Qn-DEV/-QA/-MR); a later quarter = upcoming release
      const q = (b) => { const m = /^(\d{4})-Q(\d)/.exec(b); return m ? +m[1] * 10 + +m[2] : 0; };
      const later = [...new Set(Object.keys(refs).filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice(11)).filter((b) => q(b) > q(branch || '')))].sort();
      if (later.length) status += '; upcoming release branches (not released, informational): ' + later.slice(0, 6).join(', ');
    }
    if (acknowledged.length) status += '; reviewed, not adopted: ' + acknowledged.join(', ');
    if (newer.length) { status += '; NEW TAGS: ' + newer.slice(-8).join(', '); if (product) drift++; }
    log((newer.length ? '!  ' : 'ok ') + logicalName.padEnd(36) + status + (product ? '' : '  (corpus/tool, informational)'));
  }
}
function cmpVer(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
function sameFamily(t, base) { const p = (s) => s.replace(/[\d.]+.*$/, ''); return p(t) === p(base); }
log('drift: ' + (drift ? drift + ' product source(s) changed upstream — review and re-pin (tools/make-manifest.cjs)' : 'none'));
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, lines.join('\n') + '\n'); }
process.exit(drift ? 1 : 0);
