#!/usr/bin/env node
/*
 * build-bt-paths.cjs — derives the syntax binding of the EN 16931 business terms from the official KoSIT
 * visualization (xrechnung-visualization, Apache-2.0): for every corpus document, the KoSIT stylesheet output
 * (test/kosit-visualization/run.sh -> build/oracle/xr) names each business group / business term (xr:id) together
 * with the path of the source element (xr:src). The source element is located in the corpus document and its
 * namespace-qualified path recorded:
 *
 *   build/bt-paths.json  { syntax: { 'UBL-Invoice' | 'UBL-CreditNote' | 'CII': { '<path>': ['BT-27', ...] } },
 *                          groups: { 'BG-4': ['BT-27', ..., 'BG-5'] }   (direct members, from the nesting of xr:invoice) }
 *
 * Paths use fixed prefixes (ubl, cn, cac, cbc, ext, rsm, ram, udt, qdt; root element without prefix), no positions;
 * attributes as '/@name'. The root element itself is never mapped (KoSIT uses it as xr:src of computed terms).
 * Used by src/vat-relevance.js to tell which business term a finding refers to when its message names none.
 *
 * Usage: node tools/build-bt-paths.cjs <xrechnung-visualization-dir> [--oracle build/oracle/xr] [--corpus build/corpus] [--out build/bt-paths.json]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const slimdom = require(path.join(root, 'vendor', 'slimdom.cjs'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const { canonicalPath } = require(path.join(root, 'src', 'vat-relevance.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const xrv = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!xrv) { console.error('usage: node tools/build-bt-paths.cjs <xrechnung-visualization-dir> [--oracle dir] [--corpus dir] [--out file]'); process.exit(2); }
const oracle = path.resolve(opt('--oracle', path.join(root, 'build', 'oracle', 'xr')));
const corpus = path.resolve(opt('--corpus', path.join(root, 'build', 'corpus')));
const out = path.resolve(opt('--out', path.join(root, 'build', 'bt-paths.json')));
const XR = 'urn:ce.eu:en16931:2017:xoev-de:kosit:standard:xrechnung-1';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function parse(file) {
  const dec = XmlEncoding.decode(new Uint8Array(fs.readFileSync(file)));
  if (!dec.ok) return null;
  const text = dec.text.charCodeAt(0) === 0xfeff ? dec.text.slice(1) : dec.text;
  try { return slimdom.parseXmlDocument(text); } catch (e) { return null; }
}
const elementChildren = (n) => { const r = []; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) r.push(c); return r; };
/** the node addressed by an xr:src path (lexical names of the instance, positions only where siblings share the name) */
function resolve(doc, src) {
  let node = doc;
  for (const seg of src.split('/').filter(Boolean)) {
    if (seg.startsWith('@')) { if (!node || node.nodeType !== 1) return null; return node.getAttributeNode(seg.slice(1)); }
    const m = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return null;
    const hits = elementChildren(node).filter((c) => c.nodeName === m[1]);
    node = hits[(m[2] ? Number(m[2]) : 1) - 1];
    if (!node) return null;
  }
  return node;
}

const maps = { 'UBL-Invoice': {}, 'UBL-CreditNote': {}, CII: {} };
const groups = {};
const counts = { instances: 0, terms: 0, unresolved: 0, rootSkipped: 0 };
const unresolved = [];
const add = (o, k, v) => { (o[k] || (o[k] = new Set())).add(v); };
for (const dir of fs.readdirSync(oracle).filter((d) => fs.statSync(path.join(oracle, d)).isDirectory()).sort()) {
  for (const kind of fs.readdirSync(path.join(oracle, dir)).filter((d) => fs.statSync(path.join(oracle, dir, d)).isDirectory()).sort()) {
    const syntax = kind === 'cii' ? 'CII' : kind === 'ubl-creditnote' ? 'UBL-CreditNote' : 'UBL-Invoice';
    for (const f of fs.readdirSync(path.join(oracle, dir, kind)).sort()) {
      const xrFile = path.join(oracle, dir, kind, f);
      const head = fs.readFileSync(xrFile, 'utf8').slice(0, 400);
      if (!head.includes('<xr:invoice')) continue;
      const xr = parse(xrFile);
      const src = parse(path.join(corpus, dir, f));
      if (!xr || !src) continue;
      counts.instances++;
      (function walk(el, bg) {
        for (const c of elementChildren(el)) {
          if (c.namespaceURI !== XR) continue;
          const id = c.getAttributeNS(XR, 'id');
          let nextBg = bg;
          if (id) {
            counts.terms++;
            if (bg) add(groups, bg, id);
            // xr:src is one path, or alternatives 'a | b' when KoSIT reads the term from either element (e.g. BT-149 from the
            // gross or the net price); every alternative that exists in the document is recorded
            const s = c.getAttributeNS(XR, 'src');
            const nodes = s ? s.split(' | ').map((alt) => resolve(src, alt.trim())).filter(Boolean) : [];
            if (!nodes.length) { counts.unresolved++; if (unresolved.length < 20) unresolved.push(dir + '/' + f + ' ' + id + ' ' + s); }
            for (const node of nodes) {
              const p = canonicalPath(node);
              if (p.split('/').length <= 2) counts.rootSkipped++; // '/Invoice': root element
              else add(maps[syntax], p, id);
            }
            if (/^BG-/.test(id)) nextBg = id;
          }
          walk(c, nextBg);
        }
      })(xr.documentElement, null);
    }
  }
}
// A group whose KoSIT source element also contains groups that belong neither to it nor to the group around it is not
// located there (CII: BG-13 "DELIVERY INFORMATION" has xr:src rsm:SupplyChainTradeTransaction, BG-19 "DIRECT DEBIT"
// ram:ApplicableHeaderTradeSettlement — their terms are scattered below). Such a path would make every unmapped element
// below it look like that group, so the group is dropped from that path (its terms keep their own paths). Syntax nesting
// inside the same enclosing group is kept (UBL: BG-30 cac:ClassifiedTaxCategory lies inside BG-31 cac:Item, both in BG-25).
const descendants = (bg, seen) => { seen = seen || new Set(); for (const m of groups[bg] || []) if (!seen.has(m)) { seen.add(m); if (/^BG-/.test(m)) descendants(m, seen); } return seen; };
const dropped = [];
for (const [syntax, m] of Object.entries(maps)) {
  const original = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(v)]));
  const enclosing = (p) => { let q = p; while (q.lastIndexOf('/') > 0) { q = q.slice(0, q.lastIndexOf('/')); const g = original[q] && [...original[q]].filter((x) => /^BG-/.test(x)); if (g && g.length) return g; } return []; };
  for (const [p, ids] of Object.entries(m)) {
    for (const g of [...ids].filter((x) => /^BG-/.test(x))) {
      const allowed = descendants(g);
      for (const e of enclosing(p)) for (const d of descendants(e)) allowed.add(d);
      const foreign = Object.keys(original).find((q) => q.startsWith(p + '/') && [...original[q]].some((x) => /^BG-/.test(x) && !allowed.has(x) && !original[p].has(x)));
      if (foreign) { ids.delete(g); dropped.push(syntax + ' ' + p + ' ' + g + ' (contains ' + [...original[foreign]].join(',') + ' at ' + foreign.slice(p.length) + ')'); }
    }
    if (!ids.size) delete m[p];
  }
}
const sortIds = (a, b) => { const k = (x) => [x.startsWith('BG') ? 1 : 0, Number((/\d+$/.exec(x) || [0])[0]), x]; const [p, q] = [k(a), k(b)]; return p[0] - q[0] || p[1] - q[1] || (p[2] < q[2] ? -1 : p[2] > q[2] ? 1 : 0); };
const plain = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, [...o[k]].sort(sortIds)]));
const files = ['src/xsl/ubl-invoice-xr.xsl', 'src/xsl/ubl-creditnote-xr.xsl', 'src/xsl/cii-xr.xsl', 'src/xsl/common-xr.xsl', 'src/xsl/functions.xsl'];
const result = {
  generator: 'tools/build-bt-paths.cjs',
  source: { repository: 'xrechnung-visualization', files: files.map((f) => ({ file: 'xrechnung-visualization/' + f, sha256: sha(path.join(xrv, f)) })), licence: 'Apache-2.0' },
  corpus: { instances: counts.instances, terms: counts.terms, unresolved: counts.unresolved, rootSkipped: counts.rootSkipped },
  groupsNotLocated: dropped.sort(),
  syntax: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, plain(v)])),
  groups: plain(groups),
};
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
const ids = new Set(Object.values(maps).flatMap((m) => Object.values(m).flatMap((s) => [...s])));
console.log('BT paths: ' + counts.instances + ' KoSIT instances, ' + counts.terms + ' terms, ' + Object.entries(maps).map(([k, v]) => k + ' ' + Object.keys(v).length + ' paths').join(', ') +
  ', ' + ids.size + ' distinct BT/BG, ' + Object.keys(groups).length + ' groups; unresolved ' + counts.unresolved + ', root-level skipped ' + counts.rootSkipped + ' -> ' + path.relative(process.cwd(), out));
if (unresolved.length) console.log('unresolved (first ' + unresolved.length + '):\n  ' + unresolved.join('\n  '));
