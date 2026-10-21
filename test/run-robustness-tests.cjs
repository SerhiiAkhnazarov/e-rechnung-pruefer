#!/usr/bin/env node
/*
 * run-robustness-tests.cjs — hostile and damaged files through the whole pipeline (src/pruefer-core.js in the Node
 * environment of tools/node-env.cjs, the same code as the page). Every file must give a result – no exception, no
 * hang – within a time limit, with the expected verdict where one is defined, without reading local files or opening
 * network connections, and with bounded memory.
 *
 *  1. Constructed attacks: entity expansion ("billion laughs", quadratic blow-up), external entities (XXE: a local
 *     file and a network address served by a local listener that must see no connection), element nesting above, at
 *     and below the limit (src/pruefer-core.js MAX_DEPTH = Chromium's limit), PDF decompression bombs (one stream above
 *     64 MiB; several streams together above 256 MiB – src/pdf-embedded.js limits), deeply nested PDF arrays, a PDF
 *     whose /Length points beyond the end, truncated XML and PDF, empty file, random bytes, a 20 MB text node.
 *  2. Mutation fuzzing: deterministic (seeded) mutations of the given files – bit flips, overwritten byte runs,
 *     truncation, duplicated and inserted ranges – each must give a verdict without exception within the time limit.
 *
 * The browser counterpart (the page in Chromium, WebKit, Firefox, Edge, Chrome): test/robustness-browser.cjs.
 * Usage: node test/run-robustness-tests.cjs [--mutations N] [--seed S] <seed files (XML or PDF) ...>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const root = path.join(__dirname, '..');
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const PdfEmbedded = require(path.join(root, 'src', 'pdf-embedded.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MUTATIONS = Number(opt('--mutations', '24'));
const SEED = Number(opt('--seed', '20261021'));
const seeds = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const TIME_LIMIT_MS = 60000;
const VERDICTS = new Set(['keine-xml', 'nicht-pruefbar', 'format', 'kein-profil', 'pflicht', 'luecke', 'technisch', 'ok', 'unvollstaendig']);

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' – ' + detail : '')); } };

// constructed inputs (shared with the browser test)
const { UBL, CBC, utf8, billionLaughs, quadraticBlowup, xxe, LEAK, nested, zeroBomb, pdf, randomBytes } = require(path.join(__dirname, 'robustness-inputs.cjs'));

// a well-formed UBL invoice from the seeds (for truncation and a bomb next to a real invoice), else a stub
function firstSeed(ext) { return seeds.find((f) => f.toLowerCase().endsWith(ext)); }

// ---------------------------------------------------------------------------------------------------------------
async function run(env, bytes, name) {
  const t0 = Date.now();
  const rss0 = process.memoryUsage().rss;
  let r = null, error = null;
  const timeout = new Promise((res) => setTimeout(() => res('timeout'), TIME_LIMIT_MS).unref());
  try {
    const out = await Promise.race([PrueferCore.analyzeBytes(env, bytes, name), timeout]);
    if (out === 'timeout') error = 'no result within ' + TIME_LIMIT_MS + ' ms'; else r = out;
  } catch (e) { error = 'exception: ' + (e && e.message || e); }
  return { r, error, ms: Date.now() - t0, rssDelta: process.memoryUsage().rss - rss0 };
}

(async () => {
  const env = createEnv({ exclude: /^PEPPOL-/ });
  const T = async (name, bytes, expect) => {
    const o = await run(env, bytes, name + (expect.ext || '.xml'));
    const v = o.r && o.r.ust ? o.r.ust.id : null;
    check('attack ' + name + ': result without exception within the time limit', !o.error && !!v, o.error || 'no verdict');
    if (expect.verdict) check('attack ' + name + ': verdict ' + expect.verdict, v === expect.verdict, 'got ' + v + ' ' + JSON.stringify(o.r && (o.r.warnings || []).slice(0, 2)));
    if (expect.test) check('attack ' + name + ': ' + expect.testName, !!(o.r && expect.test(o.r)), JSON.stringify(o.r && { warnings: o.r.warnings, pdf: o.r.pdf && o.r.pdf.warnings }).slice(0, 400));
    if (expect.maxRss) check('attack ' + name + ': memory growth below ' + Math.round(expect.maxRss / 1048576) + ' MiB', o.rssDelta < expect.maxRss, Math.round(o.rssDelta / 1048576) + ' MiB');
    console.log('  ' + name + ': ' + v + ', ' + o.ms + ' ms, rss ' + (o.rssDelta >= 0 ? '+' : '') + Math.round(o.rssDelta / 1048576) + ' MiB');
    return o;
  };

  // --- XML -------------------------------------------------------------------------------------------------
  await T('billion laughs (entity expansion)', billionLaughs(), { verdict: 'format', test: (r) => !!(r.xml && r.xml.parseError), testName: 'refused by the parser' });
  await T('quadratic blow-up (100 kB entity × 20 000)', quadraticBlowup(), { maxRss: 1536 * 1048576 });
  {
    let connections = 0;
    const server = net.createServer((s) => { connections++; s.destroy(); });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    await T('external entities (XXE: local file, network)', xxe(port), {
      test: (r) => !LEAK.test(JSON.stringify(r) + String(r.xml && r.xml.text)), testName: 'no content of a local file in the result',
    });
    await new Promise((res) => setTimeout(res, 200));
    check('attack XXE: no network connection opened (local listener saw ' + connections + ')', connections === 0);
    server.close();
  }
  const MAX = PrueferCore.MAX_DEPTH;
  check('limit: MAX_DEPTH is 5000 (Chromium: 5001 nested elements are "Excessive node nesting")', MAX === 5000);
  await T('nesting ' + MAX + ' elements (at the limit)', nested(MAX), { test: (r) => !(r.xml && r.xml.parseError), testName: 'processed (no depth refusal)' });
  await T('nesting ' + (MAX + 1) + ' elements (above the limit)', nested(MAX + 1), { verdict: 'format', test: (r) => /tiefer als 5000 Ebenen/.test(r.xml && r.xml.parseError || ''), testName: 'refused with the depth message' });
  await T('nesting 200 000 elements', nested(200000), { verdict: 'format' });
  check('maxElementDepth: iterative, siblings and children', PrueferCore.maxElementDepth(env.parseXml('<r><a><b/></a><c><d><e/></d></c><f/></r>').doc, 100) === 4);
  await T('20 MB text node', utf8('<?xml version="1.0"?><Invoice xmlns="' + UBL + '"><Note xmlns="' + CBC + '">' + 'A'.repeat(20 * 1048576) + '</Note></Invoice>'), {});
  await T('empty file', new Uint8Array(0), {});
  await T('1 MiB random bytes', randomBytes(1 << 20, 0x12345678), {});
  const seedXml = firstSeed('.xml');
  if (seedXml) {
    const b = fs.readFileSync(seedXml);
    await T('truncated XML (half of ' + path.basename(seedXml) + ')', new Uint8Array(b.subarray(0, b.length >> 1)), { verdict: 'format' });
  }

  // --- PDF -------------------------------------------------------------------------------------------------
  const L = PdfEmbedded.limits;
  check('limits: 64 MiB per stream, 256 MiB per document', L.MAX_STREAM_BYTES === 64 * 1048576 && L.MAX_DOCUMENT_BYTES === 256 * 1048576);
  const bomb200 = zeroBomb(200 * 1048576);
  console.log('  (bomb: ' + bomb200.length + ' bytes deflate -> 200 MiB)');
  await T('PDF decompression bomb (one embedded file of 200 MiB)', pdf({ 'factur-x.xml': { deflated: bomb200 } }), {
    ext: '.pdf', verdict: 'keine-xml', maxRss: 400 * 1048576,
    test: (r) => (r.pdf && r.pdf.warnings || []).some((w) => /exceeds the limit of 64 MiB/.test(w)), testName: 'refused with the stream limit',
  });
  const bomb60 = zeroBomb(60 * 1048576);
  const six = {}; for (let i = 1; i <= 6; i++) six['anlage-' + i + '.bin'] = { deflated: bomb60 };
  await T('PDF with six streams of 60 MiB (360 MiB together)', pdf(six), {
    ext: '.pdf', maxRss: 900 * 1048576,
    test: (r) => (r.pdf && r.pdf.warnings || []).some((w) => /decoded streams of this document exceed the limit of 256 MiB/.test(w)) && (r.pdf.attachments || []).length === 4, testName: 'four decoded, the rest refused with the document limit',
  });
  if (seedXml) {
    const xml = fs.readFileSync(seedXml);
    await T('PDF: a real invoice next to a bomb', pdf({ 'factur-x.xml': { data: xml }, 'bomb.bin': { deflated: bomb200 } }), {
      ext: '.pdf', test: (r) => r.pdf && r.pdf.invoiceAttachment === 'factur-x.xml' && r.ust && r.ust.id !== 'keine-xml', testName: 'the invoice is still checked',
    });
  }
  await T('PDF with arrays nested 100 000 deep', pdf({}, ['[' .repeat(100000) + ']'.repeat(100000)]), { ext: '.pdf', verdict: 'keine-xml' });
  await T('PDF with /Length beyond the end of the file', pdf({ 'factur-x.xml': { data: Buffer.from('<x/>'), length: 99999999 } }), { ext: '.pdf' });
  const seedPdf = firstSeed('.pdf');
  if (seedPdf) {
    const b = fs.readFileSync(seedPdf);
    await T('truncated PDF (half of ' + path.basename(seedPdf) + ')', new Uint8Array(b.subarray(0, b.length >> 1)), { ext: '.pdf' });
  }

  // --- mutation fuzzing ----------------------------------------------------------------------------------------
  let s = SEED >>> 0 || 1;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = (n) => Math.floor(rand() * n);
  const KINDS = ['bitflip', 'overwrite', 'truncate', 'duplicate', 'insert', 'delete'];
  const kinds = {};
  let runs = 0, verdicts = {};
  for (const f of seeds) {
    const orig = fs.readFileSync(f);
    for (let m = 0; m < MUTATIONS; m++) {
      const kind = KINDS[m % KINDS.length];
      let b = Buffer.from(orig);
      const at = pick(b.length), len = 1 + pick(Math.min(4096, b.length));
      if (kind === 'bitflip') for (let k = 0; k < 1 + pick(32); k++) { const p = pick(b.length); b[p] ^= 1 << pick(8); }
      else if (kind === 'overwrite') for (let k = at; k < Math.min(b.length, at + len); k++) b[k] = pick(256);
      else if (kind === 'truncate') b = b.subarray(0, at);
      else if (kind === 'duplicate') b = Buffer.concat([b.subarray(0, at), b.subarray(at, at + len), b.subarray(at)]);
      else if (kind === 'insert') { const ins = Buffer.alloc(len); for (let k = 0; k < len; k++) ins[k] = pick(256); b = Buffer.concat([b.subarray(0, at), ins, b.subarray(at)]); }
      else b = Buffer.concat([b.subarray(0, at), b.subarray(Math.min(b.length, at + len))]);
      const o = await run(env, new Uint8Array(b), path.basename(f));
      runs++;
      kinds[kind] = (kinds[kind] || 0) + 1;
      const v = o.r && o.r.ust ? o.r.ust.id : null;
      if (v) verdicts[v] = (verdicts[v] || 0) + 1;
      check('fuzz ' + path.basename(f) + ' #' + m + ' (' + kind + ' at ' + at + '): verdict without exception within the time limit', !o.error && VERDICTS.has(v), o.error || 'verdict ' + v);
    }
  }

  for (const f of failures.slice(0, 40)) console.log('FAIL ' + f);
  if (failures.length > 40) console.log('… ' + (failures.length - 40) + ' more');
  console.log('fuzzing: ' + runs + ' mutated files from ' + seeds.length + ' seed files (seed ' + SEED + '; ' + Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ') + '), verdicts ' + Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', '));
  console.log('robustness tests: ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (constructed attacks: XML entities, XXE, nesting, PDF decompression bombs, PDF structure, damaged files; mutation fuzzing)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
