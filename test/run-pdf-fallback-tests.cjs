#!/usr/bin/env node
/*
 * run-pdf-fallback-tests.cjs — destroys the cross-reference data of every PDF (all "startxref"
 * keywords are overwritten) and checks that the scan fallback of src/pdf-embedded.js still
 * extracts byte-identical XML attachments.
 *
 * Usage: node run-pdf-fallback-tests.cjs <dir>
 */
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const P = require(path.join(__dirname, '..', 'src', 'pdf-embedded.js'));
function walk(d, out) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.pdf$/i.test(e.name)) out.push(p); } return out; }
(async () => {
  let same = 0, diff = 0;
  for (const f of walk(process.argv[2], [])) {
    const bytes = new Uint8Array(fs.readFileSync(f));
    const good = await P.extractEmbeddedFiles(bytes);
    const s = Buffer.from(bytes).toString('latin1').replace(/startxref/g, 'startxyzf');
    const r = await P.extractEmbeddedFiles(new Uint8Array(Buffer.from(s, 'latin1')));
    const h = (x) => x.files.filter((a) => /\.xml$/i.test(a.name)).map((a) => a.name + ':' + crypto.createHash('sha256').update(a.bytes).digest('hex')).sort().join('|');
    if (h(good) === h(r) && (r.method === 'scan' || !good.files.length)) same++;
    else { diff++; console.log('DIFF', f, good.files.map((x) => x.name), r.files.map((x) => x.name), r.method, r.warnings.slice(0, 2)); }
  }
  console.log(`PDF scan-fallback (xref destroyed): ${same} identical XML attachments, ${diff} different`);
  process.exit(diff ? 1 : 0);
})();
