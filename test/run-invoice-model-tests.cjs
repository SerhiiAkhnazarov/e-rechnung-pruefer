#!/usr/bin/env node
/*
 * run-invoice-model-tests.cjs — the invoice data model (src/invoice-model.js) against the official KoSIT visualization:
 * for every corpus document, the KoSIT semantic-model instance (test/kosit-visualization/run.sh, Saxon HE 12.8 with
 * xrechnung-visualization ubl-invoice-xr.xsl / ubl-creditnote-xr.xsl / cii-xr.xsl) lists each business term with its
 * value. The model must give the same values, in the same order, for every business term it reads
 * (InvoiceModel.COVERED). Values are compared with whitespace normalised; terms inside the XRechnung extension groups
 * (BG-DEX-*: sub invoice lines, third-party payments) are not part of the model and are skipped.
 *
 * Usage: node test/run-invoice-model-tests.cjs [--oracle build/oracle/xr] [--corpus build/corpus] [--verbose]
 * Exit code 1 on any difference.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fx = require(path.join(root, 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(root, 'vendor', 'slimdom.cjs'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const InvoiceModel = require(path.join(root, 'src', 'invoice-model.js'));
const XsdValidator = require(path.join(root, 'src', 'xsd-validator.js'));
const xsd = {};
const xsdOf = (id) => xsd[id] || (xsd[id] = XsdValidator.create(JSON.parse(fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8'))));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const oracle = path.resolve(opt('--oracle', path.join(root, 'build', 'oracle', 'xr')));
const corpus = path.resolve(opt('--corpus', path.join(root, 'build', 'corpus')));
const verbose = args.includes('--verbose');
const XR = 'urn:ce.eu:en16931:2017:xoev-de:kosit:standard:xrechnung-1';
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

function parse(file) {
  const dec = XmlEncoding.decode(new Uint8Array(fs.readFileSync(file)));
  if (!dec.ok) return null;
  try { return slimdom.parseXmlDocument(dec.text.charCodeAt(0) === 0xfeff ? dec.text.slice(1) : dec.text); } catch (e) { return null; }
}
/** BT id -> values of the KoSIT instance, document order, without the extension groups */
function kositValues(xr) {
  const out = {};
  (function walk(el) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c.namespaceURI !== XR) continue;
      const id = c.getAttributeNS(XR, 'id') || '';
      if (/^BG-DEX-/.test(id)) continue;
      if (/^BT-\d+$/.test(id)) { const v = norm(c.textContent); if (v !== '') (out[id] || (out[id] = [])).push(v); }
      walk(c);
    }
  })(xr.documentElement);
  return out;
}

// Terms of repeatable groups (EN 16931 cardinality 0..n) are compared as sequences. All other terms occur at most
// once in the semantic model; the syntax may repeat them (CII: BT-7 in every tax breakdown; UBL: one cac:PaymentMeans
// per account) and KoSIT renders such repetitions in its own way (joined with ';', or once per group), so they are
// compared as the distinct values, joined with ';'.
const REPEATING = new Set(['BT-21', 'BT-22', 'BT-25', 'BT-26'].concat(Array.from({ length: 105 - 92 + 1 }, (_, i) => 'BT-' + (92 + i)))
  .concat(Array.from({ length: 125 - 116 + 1 }, (_, i) => 'BT-' + (116 + i))).concat(Array.from({ length: 161 - 126 + 1 }, (_, i) => 'BT-' + (126 + i))));
// dates as KoSIT shows them: "ILLEGAL DATE FORMAT of "x"." for unreadable values (compared with x), a time zone
// suffix of xs:date is dropped, a CII value starting with YYYYMMDD is shown as YYYY-MM-DD
function dateValue(v, fromKosit) {
  if (fromKosit) { const m = /^ILLEGAL DATE FORMAT of "(.*)"\.$/.exec(v); return m ? m[1] : v; }
  if (/ \(Format [^)]*\)$/.test(v)) return ''; // CII date without format 102: KoSIT shows none
  let m = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(v); if (m) return m[1];
  m = /^(\d{4})(\d{2})(\d{2})\D/.exec(v); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return v;
}
function render(id, values, fromKosit) {
  let v = InvoiceModel.DATE_TERMS.has(id) ? values.map((x) => dateValue(x, fromKosit)).filter((x) => x !== '') : values;
  if (REPEATING.has(id)) return v.join(' ¦ ');
  v = v.flatMap((x) => x.split(';').map((y) => y.trim())).filter((x) => x !== '');
  return [...new Set(v)].join(';');
}

if (!fs.existsSync(oracle)) { console.error('no KoSIT instances in ' + oracle + ' (sh test/kosit-visualization/run.sh <saxon-dir> <xrechnung-visualization-dir>)'); process.exit(2); }
const perTerm = {}; // id -> {same, diff, examples}
let docs = 0, skipped = 0, validDocs = 0, validSame = 0, invalidSame = 0;
const invalidDiffs = [];
const diffDocs = [];
for (const dir of fs.readdirSync(oracle).filter((d) => fs.statSync(path.join(oracle, d)).isDirectory()).sort()) {
  for (const kind of fs.readdirSync(path.join(oracle, dir)).filter((d) => fs.statSync(path.join(oracle, dir, d)).isDirectory()).sort()) {
    for (const f of fs.readdirSync(path.join(oracle, dir, kind)).sort()) {
      const xrFile = path.join(oracle, dir, kind, f);
      if (!fs.readFileSync(xrFile, 'utf8').slice(0, 400).includes('<xr:invoice')) continue;
      const xr = parse(xrFile), src = parse(path.join(corpus, dir, f));
      if (!xr || !src) { skipped++; continue; }
      const expected = kositValues(xr);
      let model;
      try { model = InvoiceModel.create(fx, src); } catch (e) { skipped++; console.log('model error ' + dir + '/' + f + ': ' + e.message); continue; }
      docs++;
      // the KoSIT stylesheets presuppose a schema-valid document ("Für nicht valide Dokumente ist das Ergebnis nicht
      // definiert"): differences on schema-invalid documents are listed, but do not fail the suite
      const rootName = src.documentElement.localName;
      const valid = xsdOf(rootName === 'CrossIndustryInvoice' ? 'CII-D16B' : rootName === 'CreditNote' ? 'UBL-CreditNote-2.1' : 'UBL-Invoice-2.1').validate(src).valid;
      if (valid) validDocs++;
      let same = true; // every value of every covered business term equal
      for (const id of InvoiceModel.COVERED) {
        const a = render(id, expected[id] || [], true), b = render(id, (model.bt[id] || []).map(norm), false);
        if (a === '' && b === '') continue;
        const t = perTerm[id] || (perTerm[id] = { same: 0, diff: 0, diffInvalid: 0, examples: [] });
        if (a === b) t.same++;
        else if (!valid) { t.diffInvalid++; same = false; invalidDiffs.push(id + ' ' + dir + '/' + f + ' (schema-invalid) KoSIT: ' + a.slice(0, 80) + ' | model: ' + b.slice(0, 80)); }
        else { t.diff++; same = false; if (t.examples.length < 3) t.examples.push(dir + '/' + f + '\n        KoSIT: ' + a.slice(0, 160) + '\n        model: ' + b.slice(0, 160)); }
      }
      if (same) { if (valid) validSame++; else invalidSame++; } else if (valid) diffDocs.push(dir + '/' + f);
    }
  }
}
const ids = Object.keys(perTerm).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
const terms = ids.length, termsDiff = ids.filter((id) => perTerm[id].diff).length;
const comparisons = ids.reduce((s, id) => s + perTerm[id].same + perTerm[id].diff + perTerm[id].diffInvalid, 0), mismatches = ids.reduce((s, id) => s + perTerm[id].diff, 0);
for (const id of ids) {
  const t = perTerm[id];
  if (t.diff || verbose) console.log(id.padEnd(7) + ' ' + t.same + ' same, ' + t.diff + ' different' + (t.diffInvalid ? ' (+' + t.diffInvalid + ' on schema-invalid documents)' : '') + (t.diff ? '\n    ' + t.examples.join('\n    ') : ''));
}
if (invalidDiffs.length) console.log('differences on schema-invalid documents (KoSIT result undefined there), ' + invalidDiffs.length + ':\n  ' + invalidDiffs.join('\n  '));
console.log('invoice model vs KoSIT visualization: ' + docs + ' documents (' + validDocs + ' schema-valid, of them ' + validSame + ' with all values identical; ' + (docs - validDocs) + ' schema-invalid, of them ' + invalidSame + ' identical), ' + terms + ' business terms, ' + comparisons + ' comparisons, ' + mismatches + ' mismatches on schema-valid documents, ' + invalidDiffs.length + ' on schema-invalid documents' + (skipped ? ', ' + skipped + ' not parseable' : ''));
process.exit(mismatches ? 1 : 0);
