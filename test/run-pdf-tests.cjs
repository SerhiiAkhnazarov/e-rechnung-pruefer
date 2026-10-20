#!/usr/bin/env node
/*
 * run-pdf-tests.cjs — compares src/pdf-embedded.js with pdf.js (Mozilla, the reference PDF
 * implementation) on every PDF below the given directories: the set of attachment names and the
 * exact bytes of each attachment must be identical.
 *
 * Usage: node run-pdf-tests.cjs <dir> [<dir>...] [--verbose]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PdfEmbedded = require(path.join(__dirname, '..', 'src', 'pdf-embedded.js'));

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dirs = args.filter((a) => !a.startsWith('--'));

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function withPdfJs(bytes) {
  const pdfjs = await import(require(path.join(__dirname, 'resolve-tool.cjs')).pdfjsUrl());
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true });
  const doc = await task.promise;
  const att = (await doc.getAttachments()) || new Map();
  const out = [];
  const entries = att instanceof Map ? Array.from(att.entries()) : Object.entries(att);
  for (const [key, a] of entries) {
    let content = a.content;
    if (!content && typeof doc.getAttachmentContent === 'function') content = await doc.getAttachmentContent(key);
    out.push({ name: a.filename || key, bytes: content });
  }
  const meta = await doc.getMetadata().catch(() => null);
  if (typeof doc.destroy === "function") await doc.destroy(); else if (task.destroy) await task.destroy();
  return { files: out, xmp: meta && meta.metadata ? meta.metadata.getRaw() : null };
}

(async () => {
  const files = [];
  for (const d of dirs) walk(d, files);
  let ok = 0, fail = 0, noAttachments = 0, refError = 0;
  const problems = [];
  const t0 = Date.now();
  for (const f of files.sort()) {
    const bytes = new Uint8Array(fs.readFileSync(f));
    let ours, ref;
    try { ours = await PdfEmbedded.extractEmbeddedFiles(bytes); } catch (e) { fail++; problems.push(`${f}: OURS threw ${e.message}`); continue; }
    try { ref = await withPdfJs(bytes); } catch (e) { refError++; if (verbose) console.log(`REF-ERROR ${f}: ${e.message}`); if (ours.files.length) console.log(`  (ours found ${ours.files.length} file(s) in a PDF pdf.js rejects: ${ours.files.map((x) => x.name).join(', ')})`); continue; }
    const refMap = new Map(ref.files.map((x) => [x.name, crypto.createHash('sha256').update(x.bytes).digest('hex')]));
    const ourMap = new Map(ours.files.map((x) => [x.name, crypto.createHash('sha256').update(x.bytes).digest('hex')]));
    const p = [];
    for (const [n, h] of refMap) { if (!ourMap.has(n)) p.push(`missing ${n}`); else if (ourMap.get(n) !== h) p.push(`bytes differ for ${n} (ours ${ours.files.find((x) => x.name === n).size} B)`); }
    for (const [n] of ourMap) if (!refMap.has(n)) p.push(`extra ${n}`);
    if (!refMap.size) noAttachments++;
    if (p.length) { fail++; problems.push(`${path.relative(process.cwd(), f)}: ${p.join('; ')}${ours.warnings.length ? ' | warnings: ' + ours.warnings.slice(0, 3).join(' / ') : ''}`); }
    else { ok++; if (verbose) console.log(`OK ${path.relative(process.cwd(), f)}: ${ours.files.map((x) => x.name + '(' + x.size + ')').join(', ') || '-'}${ours.xmp && ours.xmp.zugferd ? ' xmp=' + JSON.stringify(ours.xmp.zugferd) : ''}`); }
  }
  for (const p of problems) console.log('FAIL ' + p);
  console.log(`\nPDF extraction parity vs pdf.js: ${ok} identical, ${fail} differ, ${refError} rejected by pdf.js, ${noAttachments} without attachments, ${files.length} PDFs in ${Date.now() - t0} ms`);
  process.exit(fail ? 1 : 0);
})();
