#!/usr/bin/env node
/*
 * importable-hashes.cjs — build/importable.json: for every rule set the user loads himself (Peppol BIS: not
 * redistributable, docs/RULESETS.md) the SHA-256 of the official source file and of the rule set compiled from it,
 * without its provenance fields ("sources", "importedFrom"). The page embeds both (BUILD.importable): a rule set loaded
 * in the browser is kept in the browser's storage only if it is byte for byte this compiled rule set, and one read back
 * from the storage is used only after the same check (protection against a stored rule set altered by another page of
 * the same origin or another local file; src/app.js loadImported). Hashes, not the rules themselves, are committed.
 *
 * Usage: node tools/importable-hashes.cjs [--check]   (reads build/schemas/PEPPOL-*.json, build/STANDARDS_MANIFEST.json)
 *   --check: compare with the committed build/importable.json instead of writing it (exit code 1 on a difference)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const IMPORTABLE = [['PEPPOL-UBL', 'PEPPOL-EN16931-UBL.sch'], ['PEPPOL-CII', 'PEPPOL-EN16931-CII.sch']];
const canonical = (c) => { const o = Object.assign({}, c); delete o.sources; delete o.importedFrom; return JSON.stringify(o); };

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
const pep = Object.entries(manifest.sources).find(([k]) => k.startsWith('OpenPeppol peppol-bis-invoice-3'));
const out = { _comment: 'tools/importable-hashes.cjs: SHA-256 of the official Peppol BIS rule files (manifest) and of the rule sets compiled from them (canonical JSON without sources/importedFrom); used by the page to verify a stored rule set', ruleSets: {} };
for (const [id, file] of IMPORTABLE) {
  const f = path.join(root, 'build', 'schemas', id + '.json');
  if (!fs.existsSync(f)) { console.error(f + ' missing: compile the Peppol rule sets first (sh tools/compile-rules.sh <ext>)'); process.exit(2); }
  const compiled = JSON.parse(fs.readFileSync(f, 'utf8'));
  const src = pep ? (pep[1].files || []).find((x) => x.file.endsWith(file)) : null;
  out.ruleSets[id] = { file, sourceSha256: src ? src.sha256 : null, compiledSha256: sha(canonical(compiled)), asserts: compiled.stats ? compiled.stats.asserts : null };
}
const text = JSON.stringify(out, null, 2) + '\n';
const target = path.join(root, 'build', 'importable.json');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur !== text) { console.error('build/importable.json differs from the compiled Peppol rule sets:\n' + text); process.exit(1); }
  console.log('build/importable.json: identical with the compiled rule sets');
} else {
  fs.writeFileSync(target, text);
  console.log(target + ': ' + Object.entries(out.ruleSets).map(([id, v]) => id + ' compiled ' + v.compiledSha256.slice(0, 16) + '…').join(', '));
}
module.exports = { canonical };
