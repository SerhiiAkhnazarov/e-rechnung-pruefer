#!/usr/bin/env node
/*
 * run-pdfa3-tests.cjs — tests of the container checks src/pdfa3-checks.js.
 *
 * Part 1  ZUGFeRD corpus (github.com/ZUGFeRD/corpus, commit 82e886fb2136 = build/STANDARDS_MANIFEST.json):
 *         every PDF; per-check statistics (pass / error / warning / info / n/a) split by the corpus
 *         classes correct/ (no errors expected), fail/ (artificial errors; mostly in the XML, see
 *         README.md "Purpose") and other; the complete list of error and warning findings must equal
 *         EXPECTED_CORPUS below (every entry explained by the raw PDF objects / XMP).
 * Part 2  Mustang parity: the PDF resources of Mustang's validator tests (validator/src/test/resources)
 *         with the verdicts that Mustang's own tests assert (PDFValidatorTest.java,
 *         ZUGFeRDValidatorTest.java; file and line in MUSTANG_EXPECTATIONS).
 * Part 3  Mutations: same-length byte edits of corpus PDFs (cross-reference offsets stay valid) that
 *         break exactly one requirement; the target check must change to the expected level on every
 *         mutated file and no other check may change except the declared consequences.
 *
 * Usage: node test/run-pdfa3-tests.cjs <zugferd-corpus> [--mustang <mustangproject>] [--json <out.json>] [--verbose]
 * Exit code 0 only if all three parts pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'src', 'pdfa3-checks.js'));
const P = require(path.join(__dirname, '..', 'src', 'pdf-embedded.js'));

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const verbose = args.includes('--verbose');
const optVals = new Set([opt('--mustang'), opt('--json')].filter(Boolean));
const corpus = args.find((a) => !a.startsWith('--') && !optVals.has(a));
if (!corpus) { console.error('usage: run-pdfa3-tests.cjs <zugferd-corpus> [--mustang <dir>] [--json <file>]'); process.exit(2); }
const mustang = opt('--mustang');
const jsonOut = opt('--json');

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p, out); } else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(corpus, f).split(path.sep).join('/');
const cls = (r) => (/(^|\/)correct\//.test(r) || /^XML-Rechnung\//.test(r) ? 'correct' : /(^|\/)fail\//.test(r) ? 'fail' : 'other');
const findingKey = (x) => x.level + ' ' + x.id;

// ------------------------------------------------------------------------------------------------
// Part 1 expectations: every error/warning finding on the pinned corpus, with the reason.
// ------------------------------------------------------------------------------------------------
const RC = 'ZUGFeRD 1.0 release-candidate sample (XMP namespace urn:ferd:pdfa:invoice:rc#, zf:Version "RC", XML profile urn:ferd:invoice:rc:comfort, zf:ConformanceLevel BASIC). by the value list of Mustang PDFValidator.java l. 272 (section 16, l. 278-282) "RC" is invalid as well';
const EXPECTED_CORPUS = {
  'ZUGFeRDv1/correct/Mustangproject/MustangGnuaccountingBeispielRE-20140519_499.pdf': { f: ['warning FX-XMP-NAMESPACE', 'error FX-XMP-VERSION', 'error FX-LEVEL-PROFILE'], why: RC },
  'ZUGFeRDv1/correct/Mustangproject/MustangGnuaccountingBeispielRE-20140522_501.pdf': { f: ['warning FX-XMP-NAMESPACE', 'error FX-XMP-VERSION', 'error FX-LEVEL-PROFILE'], why: RC },
  'ZUGFeRDv1/correct/Mustangproject/MustangGnuaccountingBeispielRE-20140703_502.pdf': { f: ['warning FX-XMP-NAMESPACE', 'error FX-XMP-VERSION', 'error FX-LEVEL-PROFILE'], why: RC },
  'ZUGFeRDv1/correct/Mustangproject/MustangGnuaccountingBeispielRE-20170509_505.pdf': { f: ['error FX-XMP-CONFORMANCELEVEL'], why: 'XMP has zf:DocumentType, zf:DocumentFileName, zf:Version but no zf:ConformanceLevel (the extension schema declares it); by the code of Mustang PDFValidator.java l. 179-187 this is section 11 (ConformanceLevel not found) as well' },
  'ZUGFeRDv1/fail/Mustangproject/fail1.pdf': { f: ['warning FX-LEVEL-PROFILE'], why: 'XML profile id urn:ferd:CrossIndustryDocument:invoice:1p0:komfort (typo, the artificial error of this file) maps to no profile' },
  'ZUGFeRDv1/fail/Mustangproject/fail3.pdf': { f: ['error FX-XMP-CONFORMANCELEVEL'], why: 'XMP without zf:ConformanceLevel (same XMP as RE-20170509_505)' },
  'ZUGFeRDv2/correct/symtrax/Beispiele/EN16931/zugferd_2p1_EN16931_Betriebskostenabrechnung_XRechnung_embedded.pdf': { f: ['warning FX-LEVEL-PROFILE'], why: 'XRechnung 1.2 (urn:...:xrechnung_1.2) with ConformanceLevel "EN 16931": ZUGFeRD 2.1 predates the level XRECHNUNG of ZUGFeRD 2.1.1 (tolerated, warning)' },
  'ZUGFeRDv2/correct/symtrax/Beispiele/EN16931/zugferd_2p1_EN16931_Elektron_XRechnung.pdf': { f: ['warning FX-LEVEL-PROFILE'], why: 'as above' },
  'ZUGFeRDv2/correct/symtrax/Beispiele/EN16931/zugferd_2p1_EN16931_Reisekostenabrechnung_XRechnung_embedded.pdf': { f: ['warning FX-LEVEL-PROFILE'], why: 'as above' },
  'ZUGFeRDv2/fail/FX-With-UBL-REC50304330.pdf': { f: ['error FX-LEVEL-PROFILE', 'warning PDFA3-EF-SUBTYPE'], why: 'factur-x.xml contains a UBL Invoice (CustomizationID urn:cen.eu:en16931:2017) — the artificial error of this file; EmbeddedFile /Subtype /application#2Fxml' },
  'ZUGFeRDv2/fail/MustangRE-20171118_506_ZUGFeRD1and2.pdf': { f: ['warning FX-ATTACHMENT-UNIQUE'], why: 'two invoice XMLs: ZUGFeRD-invoice.xml (ZUGFeRD 1.0, object 9) and factur-x.xml (object 8), both /AFRelationship /Alternative, both in /AF [8 0 R 9 0 R]; XMP names factur-x.xml' },
  'ZUGFeRDv2/fail/Mustangproject/wrongFilename.pdf': { f: ['error FX-XMP-DOCUMENTFILENAME', 'error FX-ATTACHMENT-NAME'], why: 'attachment and fx:DocumentFileName are "factur-y.xml" (the artificial error); Mustang: section 19 (PDFValidator.java l. 253-256) + notice 17, the XML is not extracted (ZUGFeRDInvoiceImporter.java l. 286-298)' },
  'ZUGFeRDv2/fail/python-factur-x/python-factur-x.pdf': { f: ['error PDFA3-HEADER-BINARY', 'error PDFA3-TRAILER-ID', 'warning PDFA3-AF-CATALOG'], why: 'PyPDF2 output: "%PDF-1.3\\n1 0 obj" (no binary comment), trailer << /Size /Root /Info >> without /ID, catalog /AF [7 0 R] while the name tree lists 5 0 R — two identical /Filespec objects (5 and 7) both with /EF << /F 4 0 R /UF 4 0 R >>' },
  'unstructured/RE-E-974-Hetzner_2016-01-19_R0005532486.pdf': { f: ['error PDFA3-PDFAID-PART', 'error PDFA3-PDFAID-CONFORMANCE', 'error FX-XMP-NAMESPACE', 'error FX-ATTACHMENT-PRESENT'], why: 'ordinary PDF (no PDF/A identification, no Factur-X XMP, no attachment) — not a hybrid invoice' },
};

// ------------------------------------------------------------------------------------------------
// Part 2: Mustang's own test verdicts (mustangproject/validator/src/test/java/org/mustangproject/validator)
// ------------------------------------------------------------------------------------------------
const PVT = 'PDFValidatorTest.java', ZVT = 'ZUGFeRDValidatorTest.java';
// Mustang asserts the absence of <error> items; a warning of ours is not a Mustang error. The dual-XML
// samples (factur-x.xml + ZUGFeRD-invoice.xml, both readable by Mustang's importer) get our warning
// FX-ATTACHMENT-UNIQUE, declared below as DUAL.
const DUAL = 'warning FX-ATTACHMENT-UNIQUE';
const MUSTANG_EXPECTATIONS = {
  'invalidXMP.pdf': { must: ['error FX-XMP-CONFORMANCELEVEL'], mustang: PVT + ' l. 163-171: <error type="12">XMP Metadata: ConformanceLevel contains invalid value', also: ['error FX-LEVEL-PROFILE', DUAL] },
  'invalidXMP-ParseError.pdf': { must: ['error PDFA3-XMP-CATALOG'], mustang: PVT + ' l. 183-191: <error type="28">XMP Metadata: Could not parse XMP metadata (XML invalid)', also: [DUAL] },
  'attributeBasedXMP_zugferd_2p0_EN16931_Einfach.pdf': { none: true, mustang: PVT + ' l. 173-180: no <error> (attribute-form XMP, issue 18)' },
  'Facture_F20180027.pdf': { none: true, mustang: PVT + ' l. 68-73: PDF summary valid' },
  'validV2PDF.pdf': { must: [], also: [DUAL], mustang: PVT + ' l. 95-108: PDF valid, no <error> (our only finding is the warning about the second invoice XML ZUGFeRD-invoice.xml)' },
  'XMLinvalidV2PDF.pdf': { none: true, mustang: PVT + ' l. 122-134: PDF part valid (only the XML is invalid)' },
  'validV1WithAdditionalData.pdf': { none: true, mustang: PVT + ' l. 138-149: PDF valid' },
  'zugferd_2p1_EXTENDED_PDFA-3A.pdf': { none: true, mustang: ZVT + ' l. 143-149: PDF summary valid (PDF/A-3A)' },
  'validAvoir_FR_type380_BASICWL.pdf': { none: true, mustang: ZVT + ' l. 42-53: overall valid' },
  'validXRechnung.pdf': { none: true, mustang: ZVT + ' l. 56-60, 322-334: overall valid, count(//error) = 0', also: [] },
  'invalidXRechnung.pdf': { none: true, mustang: ZVT + ' l. 74-78: invalid because of the XML (container not concerned)' },
  'corruptedV2PDF.pdf': { must: ['error PDFA3-NAMETREE'], also: [DUAL], mustang: ZVT + ' l. 362-366: count(/validation/xml) = 0 — Mustang extracts no XML, because it reads attachments only from /Names /EmbeddedFiles (ZUGFeRDInvoiceImporter.java l. 200-222)' },
  'invalidPDF.pdf': { none: true, mustang: ZVT + ' l. 16-33: PDF invalid by veraPDF (font rule, comment l. 17-27) — not decidable without a PDF/A validator; container checks find nothing' },
  '103767-Invoice-2026-03-24-1.pdf': { must: ['error PDFA3-AFRELATIONSHIP'], deviation: true, mustang: PVT + ' l. 193-200: no <error>. DEVIATION: Mustang\'s validator does not check /AFRelationship; the file has /AFRelationship /Unspecified and /Subtype /application#2Foctet-stream for factur-x.xml — Unspecified is a legal PDF/A-3 value but not one of Data/Alternative/Source allowed for the invoice (Mustang FileAttachment.java l. 93)', also: ['warning PDFA3-EF-SUBTYPE'] },
  'ORDER-X_EX01_ORDER_FULL_DATA-COMFORT.pdf': { must: ['error FX-XMP-DOCUMENTTYPE'], mustang: 'Order-X document (not an invoice; fx:DocumentType ORDER, namespace urn:factur-x:pdfa:CrossIndustryDocument:1p0#, order-x.xml); used by Mustang for Order-X tests', also: ['error FX-XMP-NAMESPACE', 'error FX-ATTACHMENT-NAME', 'warning FX-LEVEL-PROFILE'] },
};

// ------------------------------------------------------------------------------------------------
// Part 3: mutations
// ------------------------------------------------------------------------------------------------
const latin1 = (b) => Buffer.from(b).toString('latin1');
/** replace inside [from, to) every regex match by a same-length string; returns count */
function replaceIn(buf, from, to, re, fn) {
  const s = buf.toString('latin1', from, to);
  let n = 0;
  const out = s.replace(re, (...m) => { const r = fn(...m); if (r.length !== m[0].length) throw new Error('length changed'); n++; return r; });
  if (n) buf.write(out, from, 'latin1');
  return n;
}
async function graph(bytes) {
  const d = await P.loadDocument(bytes, []);
  const r = d.resolve;
  const cat = d.trailer ? d.trailer.get('Root') : null;
  return { d, r, catObj: cat instanceof P.util.Ref ? d.objects.get(cat.num) : null };
}
const objRange = (buf, o) => { if (!o || o.inObjStm !== undefined) return null; const e = buf.indexOf('endobj', o.offset, 'latin1'); return e < 0 ? null : [o.offset, e]; };
const xmpRange = (g) => { const m = g.catObj && g.catObj.dict ? g.catObj.dict.get('Metadata') : null; const o = m ? g.d.objects.get(m.num) : null; return o && o.streamStart >= 0 && o.resolvedLength === undefined && !o.dict.has('Filter') ? [o.streamStart, o.streamStart + (typeof g.r(o.dict.get('Length')) === 'number' ? g.r(o.dict.get('Length')) : 0)] : null; };
async function invoiceObjs(buf, g) {
  const ex = await P.extractEmbeddedFiles(new Uint8Array(buf));
  const inv = P.pickInvoiceXml(ex.files);
  if (!inv) return {};
  let spec = null;
  for (const o of g.d.objects.values()) { if (o.dict && o.dict.has('EF')) { const ef = g.r(o.dict.get('EF')); const x = ef instanceof Map ? (ef.get('UF') || ef.get('F')) : null; if (x && x.num === inv.objectNumber) { spec = o; break; } } }
  return { inv, spec, ef: g.d.objects.get(inv.objectNumber) };
}

const XMP_DEP = ['PDFA3-PDFAID-PART', 'PDFA3-PDFAID-CONFORMANCE', 'FX-XMP-NAMESPACE', 'FX-XMP-DOCUMENTTYPE', 'FX-XMP-DOCUMENTFILENAME', 'FX-XMP-VERSION', 'FX-XMP-CONFORMANCELEVEL', 'FX-XMP-EXTENSION-SCHEMA', 'FX-FILENAME-MATCH', 'FX-LEVEL-PROFILE', 'FX-AFRELATIONSHIP-PROFILE'];
const MUTATIONS = [
  { name: 'header %PDF-2.0', target: 'PDFA3-HEADER', level: 'error', apply: async (buf) => replaceIn(buf, 0, 8, /^%PDF-1\.\d/, () => '%PDF-2.0') },
  { name: 'binary comment -> ASCII', target: 'PDFA3-HEADER-BINARY', level: 'error', apply: async (buf) => { const m = /^%PDF-\d\.\d(\r\n|\r|\n)%([^\r\n]*)/.exec(buf.toString('latin1', 0, 64)); if (!m) return 0; const at = 9 + m[1].length + 1; return replaceIn(buf, at, at + m[2].length, /[\x80-\xff]/g, () => 'x'); } },
  { name: 'trailer /ID -> /IX', target: 'PDFA3-TRAILER-ID', level: 'error', apply: async (buf) => { const s = latin1(buf); let n = 0; for (const m of s.matchAll(/trailer\s*<</g)) { const e = s.indexOf('>>', m.index) > 0 ? s.indexOf('startxref', m.index) : -1; if (e > 0) n += replaceIn(buf, m.index, e, /\/ID(?=[\s\[])/g, () => '/IX'); } for (const m of s.matchAll(/\/Type\s*\/XRef\b/g)) { const st = s.lastIndexOf(' obj', m.index); const e = s.indexOf('stream', m.index); if (st > 0 && e > 0) n += replaceIn(buf, st, e, /\/ID(?=[\s\[])/g, () => '/IX'); } return n; } },
  { name: 'catalog /Metadata -> /Metadatx', target: 'PDFA3-XMP-CATALOG', level: 'error', also: XMP_DEP, apply: async (buf, g) => { const r = objRange(buf, g.catObj); return r ? replaceIn(buf, r[0], r[1], /\/Metadata(?=[\s\d\/<])/g, () => '/Metadatx') : 0; } },
  { name: 'pdfaid:part 3 -> 2', target: 'PDFA3-PDFAID-PART', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(pdfaid:part>\s*|pdfaid:part=["'])3/g, (m, a) => a + '2') : 0; } },
  { name: 'pdfaid:conformance -> X', target: 'PDFA3-PDFAID-CONFORMANCE', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(pdfaid:conformance>\s*|pdfaid:conformance=["'])[ABUabu]/g, (m, a) => a + 'X') : 0; } },
  { name: 'fx namespace URI -> urn:factur-y:', target: 'FX-XMP-NAMESPACE', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /urn:(factur-x|zugferd|ferd):pdfa:CrossIndustryDocument:invoice:/g, (m, a) => 'urn:' + a.slice(0, -1) + 'Q:pdfa:CrossIndustryDocument:invoice:') : 0; } },
  { name: 'DocumentType INVOICE -> INVOICX', target: 'FX-XMP-DOCUMENTTYPE', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:DocumentType>\s*|:DocumentType=["'])INVOICE/g, (m, a) => a + 'INVOICX') : 0; } },
  { name: 'DocumentFileName -> ...-q.xml', target: 'FX-XMP-DOCUMENTFILENAME', level: 'error', also: ['FX-FILENAME-MATCH'], apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:DocumentFileName>\s*|:DocumentFileName=["'])([\w\-]+)(\.xml)/g, (m, a, b, c) => a + b.slice(0, -1) + 'q' + c) : 0; } },
  { name: 'DocumentFileName zugferd-invoice.xml <-> ZUGFeRD-invoice.xml', target: 'FX-FILENAME-MATCH', level: 'error', also: [], apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:DocumentFileName>\s*|:DocumentFileName=["'])(zugferd|ZUGFeRD)(-invoice\.xml)/g, (m, a, b, c) => a + (b === 'zugferd' ? 'ZUGFeRD' : 'zugferd') + c) : 0; } },
  { name: 'Version -> 9.9', target: 'FX-XMP-VERSION', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:Version>\s*|:Version=["'])(1\.0|2p0|1p0)/g, (m, a, b) => a + '9.9'.padEnd(b.length, '9')) : 0; } },
  { name: 'ConformanceLevel -> invalid', target: 'FX-XMP-CONFORMANCELEVEL', level: 'error', also: ['FX-LEVEL-PROFILE', 'FX-AFRELATIONSHIP-PROFILE', 'FX-ATTACHMENT-NAME'], apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:ConformanceLevel>\s*|:ConformanceLevel=["'])([A-Z][A-Z \d\-]*[A-Z\d])/g, (m, a, b) => a + b.slice(0, -1) + 'Q') : 0; } },
  { name: 'ConformanceLevel EN 16931 <-> EXTENDED', target: 'FX-LEVEL-PROFILE', level: 'error', also: ['FX-AFRELATIONSHIP-PROFILE'], apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /(:ConformanceLevel>\s*|:ConformanceLevel=["'])(EN 16931|EXTENDED)(?=[<"'])/g, (m, a, b) => a + (b === 'EXTENDED' ? 'EN 16931' : 'EXTENDED')) : 0; } },
  { name: 'pdfaExtension:schemas -> schemaz', target: 'FX-XMP-EXTENSION-SCHEMA', level: 'error', apply: async (buf, g) => { const r = xmpRange(g); return r ? replaceIn(buf, r[0], r[1], /pdfaExtension:schemas\b/g, () => 'pdfaExtension:schemaz') : 0; } },
  { name: 'attachment name factur-x.xml -> factur-y.xml', target: 'FX-ATTACHMENT-NAME', level: 'error', also: ['FX-FILENAME-MATCH'], requirePass: ['FX-ATTACHMENT-UNIQUE'], apply: async (buf) => {
    // literal strings in PDFDocEncoding, in UTF-16BE (BOM FE FF) and hex strings <FEFF...> / <...>
    const s = latin1(buf); let n = 0;
    const u16 = (t) => '\xfe\xff' + Array.from(t).map((c) => '\x00' + c).join('');
    const hex = (t, bom) => (bom ? 'feff' : '') + Array.from(t).map((c) => (bom ? '00' : '') + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    for (const [from, to] of [['(factur-x.xml)', '(factur-y.xml)'], ['(' + u16('factur-x.xml') + ')', '(' + u16('factur-y.xml') + ')']]) {
      let i = -1; while ((i = s.indexOf(from, i + 1)) >= 0) n += replaceIn(buf, i, i + from.length, /[\s\S]+/, () => to);
    }
    for (const bom of [true, false]) {
      const re = new RegExp('<' + hex('factur-x.xml', bom) + '>', 'gi');
      for (const m of s.matchAll(re)) n += replaceIn(buf, m.index, m.index + m[0].length, /[\s\S]+/, () => '<' + hex('factur-y.xml', bom) + '>');
    }
    return n; } },
  { name: 'catalog /Names /EmbeddedFiles -> /EmbeddedFilez', target: 'PDFA3-NAMETREE', level: 'error', also: ['PDFA3-DESC', 'PDFA3-AFRELATIONSHIP', 'PDFA3-EF-SUBTYPE', 'PDFA3-EF-PARAMS-MODDATE', 'PDFA3-FILESPEC-F-UF'], apply: async (buf, g) => { const r = objRange(buf, g.catObj); let n = r ? replaceIn(buf, r[0], r[1], /\/EmbeddedFiles(?=[\s\d\/<])/g, () => '/EmbeddedFilez') : 0; if (!n && g.catObj) { const nm = g.catObj.dict.get('Names'); const no = nm instanceof P.util.Ref ? g.d.objects.get(nm.num) : null; const rr = objRange(buf, no); if (rr) n = replaceIn(buf, rr[0], rr[1], /\/EmbeddedFiles(?=[\s\d\/<])/g, () => '/EmbeddedFilez'); } return n; } },
  { name: 'catalog /AF -> /AX', target: 'PDFA3-AF-CATALOG', level: 'error', apply: async (buf, g) => { const r = objRange(buf, g.catObj); return r ? replaceIn(buf, r[0], r[1], /\/AF(?=[\s\d\[])/g, () => '/AX') : 0; } },
  { name: 'filespec /UF -> /UX', target: 'PDFA3-FILESPEC-F-UF', level: 'error', apply: async (buf, g) => { const { spec } = await invoiceObjs(buf, g); const r = objRange(buf, spec); if (!r) return 0; const s = buf.toString('latin1', r[0], r[1]); const ef = s.indexOf('/EF'); const close = ef >= 0 ? s.indexOf('>>', ef) : -1; let n = 0; n += replaceIn(buf, r[0], r[0] + (ef >= 0 ? ef : s.length), /\/UF(?=[\s(<])/g, () => '/UX'); if (close >= 0) n += replaceIn(buf, r[0] + close, r[1], /\/UF(?=[\s(<])/g, () => '/UX'); return n; } },
  { name: 'filespec /AFRelationship key removed', target: 'PDFA3-AFRELATIONSHIP', level: 'error', also: ['FX-AFRELATIONSHIP-PROFILE'], apply: async (buf, g) => { const { spec } = await invoiceObjs(buf, g); const r = objRange(buf, spec); return r ? replaceIn(buf, r[0], r[1], /\/AFRelationship(?=[\s\/])/g, () => '/AFRelationshiq') : 0; } },
  { name: 'filespec /AFRelationship /Alternative -> /Unspecified', target: 'PDFA3-AFRELATIONSHIP', level: 'error', also: ['FX-AFRELATIONSHIP-PROFILE'], apply: async (buf, g) => { const { spec } = await invoiceObjs(buf, g); const r = objRange(buf, spec); return r ? replaceIn(buf, r[0], r[1], /(\/AFRelationship\s*)\/Alternative/g, (m, a) => a + '/Unspecified') : 0; } },
  { name: 'filespec /Desc removed', target: 'PDFA3-DESC', level: 'info', apply: async (buf, g) => { const { spec } = await invoiceObjs(buf, g); const r = objRange(buf, spec); return r ? replaceIn(buf, r[0], r[1], /\/Desc(?=[\s(<])/g, () => '/Desx') : 0; } },
  { name: 'EmbeddedFile /Subtype removed', target: 'PDFA3-EF-SUBTYPE', level: 'error', apply: async (buf, g) => { const { ef } = await invoiceObjs(buf, g); if (!ef || ef.inObjStm !== undefined) return 0; return replaceIn(buf, ef.offset, ef.streamStart, /\/Subtype(?=[\s\/])/g, () => '/Subtypx'); } },
  { name: 'EmbeddedFile /Subtype text/xml -> text/xmx', target: 'PDFA3-EF-SUBTYPE', level: 'warning', apply: async (buf, g) => { const { ef } = await invoiceObjs(buf, g); if (!ef || ef.inObjStm !== undefined) return 0; return replaceIn(buf, ef.offset, ef.streamStart, /\/text#2Fxml\b/g, () => '/text#2Fxmx'); } },
  { name: 'EmbeddedFile /Params /ModDate removed', target: 'PDFA3-EF-PARAMS-MODDATE', level: 'warning', apply: async (buf, g) => { const { ef } = await invoiceObjs(buf, g); if (!ef || ef.inObjStm !== undefined) return 0; let n = replaceIn(buf, ef.offset, ef.streamStart, /\/ModDate(?=[\s(<])/g, () => '/ModDatx'); if (!n) { const pr = ef.dict.get('Params'); const po = pr instanceof P.util.Ref ? g.d.objects.get(pr.num) : null; const rr = objRange(buf, po); if (rr) n = replaceIn(buf, rr[0], rr[1], /\/ModDate(?=[\s(<])/g, () => '/ModDatx'); } return n; } },
  { name: 'trailer /Encrypt inserted', target: 'PDFA3-ENCRYPT', level: 'error', insert: true, apply: async (buf) => { const s = latin1(buf); const t = s.lastIndexOf('trailer'); const sx = s.lastIndexOf('startxref'); if (t < 0 || sx < t) return 0; const lt = s.indexOf('<<', t); if (lt < 0 || lt > sx) return 0; return { at: lt + 2, text: ' /Encrypt 999999 0 R ' }; } },
];

async function statuses(bytes) { const r = await C.checkContainer(bytes); const m = {}; for (const c of r.checks) m[c.id] = c.status; return { m, r }; }

(async () => {
  const t0 = Date.now();
  let failures = 0;
  const report = { corpus: {}, mustang: {}, mutations: [] };

  // ---------------- Part 1 ----------------
  const files = walk(corpus, []).sort();
  const stats = {};
  for (const id of Object.keys(C.CHECKS)) stats[id] = { correct: { pass: 0, error: 0, warning: 0, info: 0, 'n/a': 0 }, fail: { pass: 0, error: 0, warning: 0, info: 0, 'n/a': 0 }, other: { pass: 0, error: 0, warning: 0, info: 0, 'n/a': 0 } };
  const seen = new Set();
  const classCount = { correct: 0, fail: 0, other: 0 };
  for (const f of files) {
    const r = rel(f);
    const k = cls(r);
    classCount[k]++;
    const res = await C.checkContainer(new Uint8Array(fs.readFileSync(f)));
    report.corpus[r] = { class: k, results: res.results, checks: res.checks.map((c) => ({ id: c.id, status: c.status })), facts: res.facts };
    for (const c of res.checks) {
      const levels = res.results.filter((x) => x.id === c.id).map((x) => x.level);
      const worst = levels.includes('error') ? 'error' : levels.includes('warning') ? 'warning' : levels.includes('info') ? 'info' : c.status === 'n/a' ? 'n/a' : 'pass';
      stats[c.id][k][worst]++;
    }
    const got = Array.from(new Set(res.results.filter((x) => x.level !== 'info').map(findingKey))).sort();
    const exp = EXPECTED_CORPUS[r] ? EXPECTED_CORPUS[r].f.slice().sort() : [];
    seen.add(r);
    if (JSON.stringify(got) !== JSON.stringify(exp)) { failures++; console.log('CORPUS MISMATCH ' + r + '\n  expected: ' + (exp.join(', ') || '-') + '\n  actual:   ' + (got.join(', ') || '-')); for (const x of res.results.filter((x) => x.level !== 'info')) console.log('    ' + x.level + ' ' + x.id + ': ' + x.message); }
    else if (verbose) console.log('ok ' + r + (got.length ? ' [' + got.join(', ') + ']' : ''));
  }
  for (const r of Object.keys(EXPECTED_CORPUS)) if (!seen.has(r)) { failures++; console.log('CORPUS MISSING FILE ' + r); }
  console.log('\nPart 1 — ZUGFeRD corpus: ' + files.length + ' PDFs (correct ' + classCount.correct + ', fail ' + classCount.fail + ', other ' + classCount.other + ')');
  console.log('worst finding per PDF and check; columns correct | fail | other, each pass/error/warning/info/n.a.');
  const fmt = (o) => [o.pass, o.error, o.warning, o.info, o['n/a']].map((x) => String(x).padStart(3)).join('/');
  for (const [id, s] of Object.entries(stats)) console.log('  ' + id.padEnd(26) + ' ' + C.CHECKS[id].level.padEnd(7) + ' ' + fmt(s.correct) + ' | ' + fmt(s.fail) + ' | ' + fmt(s.other));
  console.log('  error/warning findings per file:');
  for (const [r, e] of Object.entries(EXPECTED_CORPUS)) console.log('    ' + r + ': ' + e.f.join(', ') + '\n      — ' + e.why);
  report.stats = stats;

  // ---------------- Part 2 ----------------
  let mOk = 0, mFail = 0, mDev = 0;
  if (mustang) {
    const dir = path.join(mustang, 'validator', 'src', 'test', 'resources');
    console.log('\nPart 2 — Mustang parity (' + dir + ')');
    for (const [name, e] of Object.entries(MUSTANG_EXPECTATIONS)) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) { mFail++; console.log('  MISSING ' + name); continue; }
      const res = await C.checkContainer(new Uint8Array(fs.readFileSync(f)));
      const got = Array.from(new Set(res.results.filter((x) => x.level !== 'info').map(findingKey))).sort();
      const exp = e.none ? [] : e.must.concat(e.also || []).sort();
      const ok = JSON.stringify(got) === JSON.stringify(exp);
      report.mustang[name] = { got, expected: exp, mustang: e.mustang, deviation: !!e.deviation };
      if (ok) { mOk++; if (e.deviation) mDev++; console.log('  ' + (e.deviation ? 'ok (documented deviation) ' : 'ok ') + name + ': ' + (got.join(', ') || 'no error/warning') + '\n      Mustang: ' + e.mustang); }
      else { mFail++; console.log('  MISMATCH ' + name + ': expected ' + (exp.join(', ') || '-') + ', actual ' + (got.join(', ') || '-') + '\n      Mustang: ' + e.mustang); }
    }
    const others = fs.readdirSync(dir).filter((x) => /\.pdf$/i.test(x) && !MUSTANG_EXPECTATIONS[x]);
    if (others.length) { mFail++; console.log('  resources without expectation: ' + others.join(', ')); }
    failures += mFail;
  }

  // ---------------- Part 3 ----------------
  console.log('\nPart 3 — mutations (same-length edits of corpus PDFs; xref offsets stay valid)');
  const base = new Map();
  let mutApplied = 0, mutDetected = 0;
  for (const mu of MUTATIONS) {
    let applied = 0, detected = 0;
    const bad = [];
    for (const f of files) {
      const orig = fs.readFileSync(f);
      if (!base.has(f)) { const b0 = await statuses(new Uint8Array(orig)); base.set(f, { m: b0.m, ids: new Set(b0.r.results.map((x) => x.id)) }); }
      const before = base.get(f).m;
      // the requirement must hold before the mutation: status pass and no finding of the target check
      if (before[mu.target] !== 'pass' || base.get(f).ids.has(mu.target)) continue;
      if ((mu.requirePass || []).some((id) => before[id] !== 'pass')) continue; // e.g. several invoice XMLs: target selection differs
      let buf = Buffer.from(orig);
      const g = await graph(new Uint8Array(buf));
      let n;
      try { n = await mu.apply(buf, g); } catch (e) { bad.push(rel(f) + ': mutation error ' + e.message); continue; }
      if (n && typeof n === 'object') { buf = Buffer.concat([buf.subarray(0, n.at), Buffer.from(n.text, 'latin1'), buf.subarray(n.at)]); n = 1; }
      if (!n) continue;
      applied++;
      const { m: after, r: res } = await statuses(new Uint8Array(buf));
      const lv = res.results.filter((x) => x.id === mu.target).map((x) => x.level);
      const hit = mu.level === 'info' ? lv.includes('info') : (lv.includes(mu.level) && after[mu.target] === 'fail');
      const allowed = new Set([mu.target].concat(mu.also || []));
      const changed = Object.keys(after).filter((id) => after[id] !== before[id] && !allowed.has(id));
      if (hit && !changed.length) detected++;
      else bad.push(rel(f) + ': ' + (hit ? '' : mu.target + ' not reported as ' + mu.level + ' (levels: ' + (lv.join(',') || '-') + ')') + (changed.length ? ' side effects: ' + changed.map((id) => id + ' ' + before[id] + '->' + after[id]).join(', ') : ''));
    }
    mutApplied += applied; mutDetected += detected;
    const ok = applied > 0 && detected === applied;
    if (!ok) failures++;
    report.mutations.push({ name: mu.name, target: mu.target, level: mu.level, applied, detected, problems: bad });
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + mu.target.padEnd(26) + ' ' + (mu.name + ':').padEnd(62) + ' ' + detected + '/' + applied + ' mutated PDFs detected');
    for (const b of bad.slice(0, verbose ? 1000 : 5)) console.log('         ' + b);
  }

  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); }
  const nErr = Object.values(EXPECTED_CORPUS).length;
  console.log(`\nPDF/A-3 container checks: ${files.length} corpus PDFs, ${failures ? 'FAILED' : 'expectations met'} (${nErr} PDFs with error/warning findings as expected)` +
    (mustang ? `; Mustang parity ${mOk}/${mOk + mFail} (${mDev} documented deviation)` : '') +
    `; mutations ${mutDetected}/${mutApplied} detected in ${MUTATIONS.length} mutation types; ${failures} failures in ${Date.now() - t0} ms`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
