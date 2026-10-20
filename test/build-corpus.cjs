#!/usr/bin/env node
/*
 * build-corpus.cjs — materialises every test document we know of as a standalone XML file so
 * that the Saxon reference pipeline (test/run-oracle-parity.sh) and our engine can be run on
 * identical inputs:
 *
 *   build/corpus/xr-ubl/   XRechnung UBL instances: originals + every XML-Mutate mutation
 *   build/corpus/xr-cii/   XRechnung CII instances: originals + every XML-Mutate mutation
 *   build/corpus/cen-ubl/  CEN unit-test fragments (Invoice/CreditNote)
 *   build/corpus/cen-cii/  CEN unit-test fragments (CII)
 *   build/corpus/extra-ubl|extra-cii/  additional instances passed via --extra <dir> (recursively)
 *   build/corpus/peppol-ubl|peppol-cii/  Peppol BIS Billing 3.0 (--peppol <repo>): rules/examples,
 *                          rules/national-examples, rules/snippets and the fragments of every VEFA
 *                          testSet in rules/unit-UBL-* / rules/unit-CII-*
 *   build/corpus/zugferd-cii|zugferd-ubl/  ZUGFeRD corpus (--zugferd <dir>): every *.xml and the
 *                          invoice XML embedded in every *.pdf (src/pdf-embedded.js); the file name
 *                          keeps the corpus path (correct/, fail/ ... directories) for later grouping
 *
 * Usage: node build-corpus.cjs [--append] --xr <xrechnung-schematron-repo> --cen <cen-repo> [--extra <dir>]...
 *                              [--peppol <peppol-bis-invoice-3>] [--zugferd <zugferd-corpus>]
 *   --append keeps the existing build/corpus and only (re)writes the directories whose source is given.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));

const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const xrRepo = opt('--xr');
const cenRepo = opt('--cen');
const peppolRepo = opt('--peppol');
const zugferdDir = opt('--zugferd');
const append = args.includes('--append');
const extras = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--extra') extras.push(args[i + 1]);
const out = path.join(__dirname, '..', 'build', 'corpus');
if (!append) {
  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ['xr-ubl', 'xr-cii', 'cen-ubl', 'cen-cii', 'extra-ubl', 'extra-cii']) fs.mkdirSync(path.join(out, d), { recursive: true });
}
function fresh(dirs) { for (const d of dirs) { fs.rmSync(path.join(out, d), { recursive: true, force: true }); fs.mkdirSync(path.join(out, d), { recursive: true }); } }
if (append) {
  if (xrRepo) fresh(['xr-ubl', 'xr-cii']);
  if (cenRepo) fresh(['cen-ubl', 'cen-cii']);
  if (extras.length) fresh(['extra-ubl', 'extra-cii']);
}
if (peppolRepo) fresh(['peppol-ubl', 'peppol-cii']);
if (zugferdDir) fresh(['zugferd-ubl', 'zugferd-cii']);

const VEFA_NS = 'http://difi.no/xsd/vefa/validator/1.0';
const UBL_NS = ['urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'];
const CII_NS = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';

function safe(s) { return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120); }
function parsePI(data) { const a = {}; const re = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g; let m; while ((m = re.exec(data)) !== null) a[m[1]] = m[2]; return a; }
function nextElementSibling(n) { let s = n.nextSibling; while (s && s.nodeType !== 1) s = s.nextSibling; return s; }
function pathTo(node) { const p = []; let n = node; while (n && n.parentNode && n.parentNode.nodeType !== 9) { const parent = n.parentNode; let idx = 0; for (let c = parent.firstChild; c && c !== n; c = c.nextSibling) if (c.nodeType === 1) idx++; p.unshift(idx); n = parent; } return p; }
function resolvePath(doc, p) { let n = doc.documentElement; for (const idx of p) { let i = 0, found = null; for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) { if (i === idx) { found = c; break; } i++; } } if (!found) throw new Error('path'); n = found; } return n; }
function mutations(attrs) {
  const mut = attrs.mutator || 'identity';
  switch (mut) {
    case 'identity': return [];
    case 'remove':
      if (attrs.attribute) return [{ name: 'remove_' + attrs.attribute, apply: (el) => el.removeAttribute(attrs.attribute) }];
      return [{ name: 'remove', apply: (el) => el.parentNode.removeChild(el) }];
    case 'empty':
      if (attrs.attribute) return [{ name: 'empty_' + attrs.attribute, apply: (el) => el.setAttribute(attrs.attribute, '') }];
      return [{ name: 'empty', apply: (el) => { while (el.firstChild) el.removeChild(el.firstChild); } }];
    case 'code': {
      const sep = attrs.separator || ',';
      return (attrs.values || '').split(sep).map((v) => v.trim()).map((v, i) => ({
        name: 'code' + i + '_' + safe(v),
        apply: (el) => { if (attrs.attribute) el.setAttribute(attrs.attribute, v); else { while (el.firstChild) el.removeChild(el.firstChild); el.appendChild(el.ownerDocument.createTextNode(v)); } },
      }));
    }
    case 'whitespace':
      return ['prefix', 'suffix', 'both'].map((variant) => ({ name: 'ws_' + variant, apply: (el) => { const t = el.textContent; while (el.firstChild) el.removeChild(el.firstChild); el.appendChild(el.ownerDocument.createTextNode((variant !== 'suffix' ? '  ' : '') + t + (variant !== 'prefix' ? '  ' : ''))); } }));
    default: throw new Error('unsupported mutator ' + mut);
  }
}

let counts = {};
function write(dir, name, xml) {
  fs.writeFileSync(path.join(out, dir, name), xml);
  counts[dir] = (counts[dir] || 0) + 1;
}

// 1. XRechnung instances + mutations
if (xrRepo) {
  for (const [sub, dir] of [['ubl-inv', 'xr-ubl'], ['ubl-cn', 'xr-ubl'], ['cii', 'xr-cii']]) {
    const full = path.join(xrRepo, 'test', 'instances', sub);
    for (const file of fs.readdirSync(full).sort()) {
      if (!file.endsWith('.xml')) continue;
      const xml = fs.readFileSync(path.join(full, file), 'utf8');
      const base = file.replace(/\.xml$/, '');
      write(dir, base + '.xml', xml);
      const doc = slimdom.parseXmlDocument(xml);
      const pis = [];
      (function walk(n) { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 7 && c.target === 'xmute') { const t = nextElementSibling(c); pis.push({ attrs: parsePI(c.data), targetPath: t ? pathTo(t) : null }); } if (c.nodeType === 1) walk(c); } })(doc);
      let k = 0;
      for (const pi of pis) {
        for (const m of mutations(pi.attrs)) {
          if (pi.targetPath === null) continue;
          const copy = slimdom.parseXmlDocument(xml);
          m.apply(resolvePath(copy, pi.targetPath));
          k++;
          write(dir, `${base}__m${String(k).padStart(3, '0')}_${safe(pi.attrs.id || 'pi')}_${m.name}.xml`, slimdom.serializeToWellFormedString(copy));
        }
      }
    }
  }
}

// 2. CEN unit-test fragments
if (cenRepo) {
  for (const [sub, dir] of [['Invoice-unit-UBL', 'cen-ubl'], ['CreditNote-unit-UBL', 'cen-ubl'], ['cii', 'cen-cii']]) {
    const full = path.join(cenRepo, 'test', sub);
    for (const file of fs.readdirSync(full).sort()) {
      if (!file.endsWith('.xml')) continue;
      const doc = slimdom.parseXmlDocument(fs.readFileSync(path.join(full, file), 'utf8'));
      let i = 0;
      for (const test of Array.from(doc.documentElement.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'test' && n.namespaceURI === VEFA_NS)) {
        i++;
        const inst = Array.from(test.childNodes).find((n) => n.nodeType === 1 && n.namespaceURI !== VEFA_NS);
        if (!inst) continue;
        write(dir, `${sub}__${file.replace(/\.xml$/, '')}__t${i}.xml`, slimdom.serializeToWellFormedString(inst));
      }
    }
  }
}

// 3. extra directories: classify by root namespace
function walkDir(d, cb) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkDir(p, cb); else cb(p); } }
for (const ex of extras) {
  walkDir(ex, (p) => {
    if (!p.endsWith('.xml')) return;
    let xml;
    try { xml = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
    let doc;
    try { doc = slimdom.parseXmlDocument(xml); } catch (e) { return; }
    const ns = doc.documentElement.namespaceURI;
    const dir = UBL_NS.includes(ns) ? 'extra-ubl' : ns === CII_NS ? 'extra-cii' : null;
    if (!dir) return;
    write(dir, safe(path.relative(ex, p)), xml);
  });
}

// 4. Peppol BIS Billing 3.0: examples, national examples, snippets (by root namespace) + VEFA fragments
function classify(doc) { const ns = doc.documentElement.namespaceURI; return UBL_NS.includes(ns) ? 'ubl' : ns === CII_NS ? 'cii' : null; }
if (peppolRepo) {
  for (const sub of ['examples', 'national-examples', 'snippets']) {
    const base = path.join(peppolRepo, 'rules', sub);
    if (!fs.existsSync(base)) continue;
    walkDir(base, (p) => {
      if (!p.endsWith('.xml')) return;
      let doc;
      try { doc = slimdom.parseXmlDocument(fs.readFileSync(p, 'utf8')); } catch (e) { return; }
      const kind = classify(doc);
      if (!kind) return; // VEFA testSets, SBDH envelopes, ...
      write('peppol-' + kind, safe(sub + '__' + path.relative(base, p)), fs.readFileSync(p, 'utf8'));
    });
  }
  for (const dir of fs.readdirSync(path.join(peppolRepo, 'rules')).filter((d) => /^unit-(UBL|CII)-/.test(d)).sort()) {
    const full = path.join(peppolRepo, 'rules', dir);
    for (const file of fs.readdirSync(full).sort()) {
      if (!/\.xml?$/.test(file)) continue;
      let doc;
      try { doc = slimdom.parseXmlDocument(fs.readFileSync(path.join(full, file), 'utf8')); } catch (e) { continue; }
      if (doc.documentElement.localName !== 'testSet' || doc.documentElement.namespaceURI !== VEFA_NS) continue;
      let i = 0;
      for (const test of Array.from(doc.documentElement.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'test' && n.namespaceURI === VEFA_NS)) {
        i++;
        const inst = Array.from(test.childNodes).find((n) => n.nodeType === 1 && n.namespaceURI !== VEFA_NS);
        if (!inst) continue;
        const kind = UBL_NS.includes(inst.namespaceURI) ? 'ubl' : inst.namespaceURI === CII_NS ? 'cii' : null;
        if (!kind) continue;
        write('peppol-' + kind, `${dir}__${file.replace(/\.xml?$/, '')}__t${i}.xml`, slimdom.serializeToWellFormedString(inst));
      }
    }
  }
}

// 5. ZUGFeRD corpus: XML files + XML embedded in PDFs
async function zugferd() {
  if (!zugferdDir) return;
  const PdfEmbedded = require(path.join(__dirname, '..', 'src', 'pdf-embedded.js'));
  const files = [];
  walkDir(zugferdDir, (p) => { if (/\.(xml|pdf)$/i.test(p) && !p.includes(path.sep + '.git' + path.sep)) files.push(p); });
  files.sort();
  let pdfs = 0, pdfWithout = 0;
  const skippedLarge = [];
  for (const p of files) {
    const rel = path.relative(zugferdDir, p);
    let xml = null, name = safe(rel);
    if (/\.pdf$/i.test(p)) {
      pdfs++;
      let ex;
      try { ex = await PdfEmbedded.extractEmbeddedFiles(new Uint8Array(fs.readFileSync(p))); } catch (e) { pdfWithout++; continue; }
      const inv = PdfEmbedded.pickInvoiceXml(ex.files);
      if (!inv) { pdfWithout++; continue; }
      try { xml = new TextDecoder('utf-8', { fatal: false }).decode(inv.bytes); } catch (e) { pdfWithout++; continue; }
      name = safe(rel + '__' + inv.name);
    } else {
      // the two Qvalia "Large_Invoice" samples (25 MB and 61 MB UBL) are reader stress tests, not
      // rule tests; they would dominate every Saxon/engine run and are left out above 5 MB
      if (fs.statSync(p).size > 5 * 1024 * 1024) { skippedLarge.push(rel); continue; }
      xml = fs.readFileSync(p, 'utf8');
    }
    if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
    let doc;
    try { doc = slimdom.parseXmlDocument(xml); } catch (e) { continue; }
    const kind = classify(doc);
    if (!kind) continue;
    if (!name.endsWith('.xml')) name += '.xml';
    write('zugferd-' + kind, name, xml);
  }
  console.log(`ZUGFeRD corpus: ${pdfs} PDFs read, ${pdfWithout} without extractable invoice XML, skipped (> 5 MB): ${skippedLarge.join(', ') || '-'}`);
}

zugferd().then(() => console.log('corpus written to ' + out + ': ' + JSON.stringify(counts)));
