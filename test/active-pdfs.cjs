#!/usr/bin/env node
/*
 * active-pdfs.cjs — small, deterministic PDFs with active content (actions, additional actions, document JavaScript)
 * for the container checks PDFA3-ACTIONS, PDFA3-AA and PDF-JAVASCRIPT (src/pdfa3-checks.js) and for the hostile-file
 * tests. Each case states the expected status of the three checks; the veraPDF job of the CI validates the same files
 * (written to build/corpus/active-content by test/run-pdfa3-tests.cjs) and test/compare-verapdf.cjs compares the
 * verdicts with veraPDF's rules 6.5.1-1, 6.5.1-2 (PDFA3-ACTIONS), 6.5.2-1, 6.5.2-2, 6.4.1-1, 6.4.1-2 (PDFA3-AA).
 *
 * Usage: node test/active-pdfs.cjs <dir>   (writes the PDFs and cases.json)
 *        require('./active-pdfs.cjs').cases() -> [{ name, bytes, expect, why }]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** a PDF 1.7 file from object bodies (index + 1 = object number) with a correct cross-reference table – or, with
 * brokenXref, with a startxref that points nowhere, so that a reader falls back to scanning the objects */
function pdf(objects, brokenXref) {
  const parts = ['%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'];
  const offsets = [];
  let len = Buffer.byteLength(parts[0], 'latin1');
  objects.forEach((body, i) => {
    offsets.push(len);
    const o = (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    parts.push(o);
    len += Buffer.byteLength(o, 'latin1');
  });
  const xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  const trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>] >>\nstartxref\n' + (brokenXref ? len + 7777 : len) + '\n%%EOF\n';
  parts.push(xref, trailer);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

const PAGES = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
const PAGE = (extra) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]' + (extra || '') + ' >>';
const P = 'pass', E = 'error';

function cases() {
  return [
    { name: 'js-openaction.pdf', why: 'JavaScript as /OpenAction of the catalog (runs on opening)',
      objects: ['<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>', PAGES, PAGE(), '<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: true, launch: false },
    { name: 'launch-page-aa.pdf', why: 'Launch action in the additional actions of a page (/AA /O: page opened)',
      objects: ['<< /Type /Catalog /Pages 2 0 R >>', PAGES, PAGE(' /AA << /O 4 0 R >>'), '<< /Type /Action /S /Launch /F (calc.exe) >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': E, 'PDF-JAVASCRIPT': P }, javascript: false, launch: true },
    { name: 'js-nametree.pdf', why: 'document-level JavaScript in the name tree /Names /JavaScript',
      objects: ['<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript << /Names [(init) 4 0 R] >> >> >>', PAGES, PAGE(), '<< /S /JavaScript /JS (this.print\\(\\)) >>'],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': E }, javascript: true, launch: false },
    { name: 'named-print.pdf', why: 'a link annotation with the named action /Print (only NextPage, PrevPage, FirstPage, LastPage allowed)',
      objects: ['<< /Type /Catalog /Pages 2 0 R >>', PAGES, PAGE(' /Annots [4 0 R]'), '<< /Type /Annot /Subtype /Link /Rect [10 10 100 30] /F 4 /Border [0 0 0] /A << /S /Named /N /Print >> >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    { name: 'catalog-aa.pdf', why: 'additional actions in the catalog (/AA /WC: document closed), with an allowed GoTo action',
      objects: ['<< /Type /Catalog /Pages 2 0 R /AA << /WC << /S /GoTo /D [3 0 R /Fit] >> >> >>', PAGES, PAGE()],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': E, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    { name: 'field-aa-js.pdf', why: 'a form field with additional actions (/AA /K: keystroke) running JavaScript; the widget is merged with the field',
      objects: ['<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>', PAGES, PAGE(' /Annots [4 0 R]'), '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Betrag) /Rect [10 10 200 30] /F 4 /P 3 0 R /AA << /K << /S /JavaScript /JS (event.rc = true) >> >> >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': E, 'PDF-JAVASCRIPT': P }, javascript: true, launch: false },
    { name: 'widget-a-uri.pdf', why: 'a widget annotation with /A (an allowed URI action, but widgets must have neither /A nor /AA)',
      objects: ['<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>', PAGES, PAGE(' /Annots [4 0 R]'), '<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (Link) /Rect [10 10 200 30] /F 4 /P 3 0 R /A << /S /URI /URI (https://example.com/) >> >>'],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': E, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    { name: 'next-chain-js.pdf', why: 'an allowed GoTo /OpenAction whose /Next action is JavaScript',
      objects: ['<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>', PAGES, PAGE(), '<< /S /GoTo /D [3 0 R /Fit] /Next 5 0 R >>', '<< /S /JavaScript /JS (1) >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: true, launch: false },
    { name: 'next-cycle.pdf', why: 'a /Next chain that points back to itself (must terminate); only allowed actions',
      objects: ['<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>', PAGES, PAGE(), '<< /S /GoTo /D [3 0 R /Fit] /Next 5 0 R >>', '<< /S /URI /URI (https://example.com/) /Next 4 0 R >>'],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    { name: 'outline-js.pdf', why: 'a bookmark (outline item) with a JavaScript action',
      objects: ['<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>', PAGES, PAGE(), '<< /Type /Outlines /First 5 0 R /Last 5 0 R /Count 1 >>', '<< /Title (Start) /Parent 4 0 R /A << /S /JavaScript /JS (1) >> >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: true, launch: false },
    { name: 'allowed-actions.pdf', why: 'only allowed actions: GoTo /OpenAction, a link with URI, a bookmark with the named action NextPage',
      objects: ['<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /GoTo /D [3 0 R /Fit] >> /Outlines 5 0 R >>', PAGES, PAGE(' /Annots [4 0 R]'), '<< /Type /Annot /Subtype /Link /Rect [10 10 100 30] /F 4 /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>', '<< /Type /Outlines /First 6 0 R /Last 6 0 R /Count 1 >>', '<< /Title (Weiter) /Parent 5 0 R /A << /S /Named /N /NextPage >> >>'],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    { name: 'structure-s-keys.pdf', why: 'structure elements carry /S keys (structure types) – they are no actions and must not be reported',
      objects: ['<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 4 0 R /MarkInfo << /Marked true >> >>', PAGES, PAGE(), '<< /Type /StructTreeRoot /K 5 0 R >>', '<< /Type /StructElem /S /JavaScript /P 4 0 R >>'],
      expect: { 'PDFA3-ACTIONS': P, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: false, launch: false },
    // without a usable cross-reference table (the reader scans the objects): active content must be found all the same
    // (not given to veraPDF: these files are about the scan fallback of this reader, not about PDF/A)
    { name: 'js-openaction-no-xref.pdf', why: 'as js-openaction.pdf, but startxref points nowhere (scan fallback)', brokenXref: true, method: 'scan',
      objects: ['<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>', PAGES, PAGE(), '<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': P, 'PDF-JAVASCRIPT': P }, javascript: true, launch: false },
    { name: 'launch-page-aa-no-xref.pdf', why: 'as launch-page-aa.pdf, but startxref points nowhere (scan fallback)', brokenXref: true, method: 'scan',
      objects: ['<< /Type /Catalog /Pages 2 0 R >>', PAGES, PAGE(' /AA << /O 4 0 R >>'), '<< /Type /Action /S /Launch /F (calc.exe) >>'],
      expect: { 'PDFA3-ACTIONS': E, 'PDFA3-AA': E, 'PDF-JAVASCRIPT': P }, javascript: false, launch: true },
  ].map((c) => Object.assign(c, { bytes: pdf(c.objects, c.brokenXref) }));
}

module.exports = { cases, pdf };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node test/active-pdfs.cjs <dir>'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const list = cases();
  for (const c of list) fs.writeFileSync(path.join(dir, c.name), c.bytes);
  // (all cases, including the scan-fallback ones)
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(list.map((c) => ({ name: c.name, why: c.why, expect: c.expect })), null, 1) + '\n');
  console.log(dir + ': ' + list.length + ' PDFs with active content');
}
