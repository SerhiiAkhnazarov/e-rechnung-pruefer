#!/usr/bin/env node
/*
 * run-line-tests.cjs — the line numbers of the findings (PrueferCore.elementLineIndex: the line of the start tag of
 * every element) against an independent reference, libexpat (test/line-oracle/expat_lines.py, Python standard
 * library), over every XML document of the corpus (build/corpus) and hand-made edge cases (CR LF, lone CR, start tags
 * over several lines, '<' and line breaks in comments, CDATA sections, processing instructions and attribute values,
 * a document type declaration with an internal subset, UTF-16). Then, for the documents with findings, the line of
 * every finding must be the reference line of the element the finding refers to.
 *
 * Usage: node test/run-line-tests.cjs [--python python3] [--dirs a,b]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const python = opt('--python', 'python3');

// ---- edge cases ------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
const CASES = {
  'crlf-multiline-tag.xml': '<?xml version="1.0"?>\r\n<a>\r\n  <b\r\n    x="1">\r\n  </b>\r\n</a>\r\n',
  'cr-only.xml': '<a>\r<b/>\r<c>\r</c></a>',
  'mixed-line-ends.xml': '<a>\r\n<b/>\n<c/>\r<d/>\r\n\r\n<e/></a>',
  'comment.xml': '<a>\n<!-- <x>\n<y> not a tag -->\n<b/>\n</a>',
  'cdata.xml': '<a><![CDATA[\n<x>\n]]>\n<b/><![CDATA[]]><c/></a>',
  'pi.xml': '<?pi \n data?>\n<a>\n<?pi2 x\ny?><b/></a>',
  'doctype-internal-subset.xml': '<?xml version="1.0"?>\n<!DOCTYPE a [\n<!ELEMENT a ANY>\n<!-- ] > -->\n<!ATTLIST a x CDATA "a>b">\n<?pi ]>?>\n]>\n<a x="1">\n<b/>\n</a>\n',
  'doctype-system.xml': '<!DOCTYPE a SYSTEM "a>b.dtd">\n<a>\n<b/>\n</a>',
  'attribute-values.xml': '<a\n x="1>2"\n y=\'3\n4\'>\n<b z="&gt;&lt;"/>\n</a>',
  'nested-empty.xml': '<a><b/><c><d/></c>\n<e/>\n\n<f><g><h/></g></f></a>',
  'whitespace-in-tags.xml': '<a\t\n\t><b\n/><c\r\n></c\n></a>',
  'namespaces.xml': '<p:a xmlns:p="urn:x">\n<p:b/>\n<c xmlns="urn:y"/>\n</p:a>',
};
for (const [n, t] of Object.entries(CASES)) fs.writeFileSync(path.join(tmp, n), t, 'utf8');
{
  const t = '<?xml version="1.0" encoding="UTF-16"?>\n<a>\n<b/>\n\n<c/>\n</a>';
  const buf = Buffer.alloc(2 + t.length * 2);
  buf[0] = 0xff; buf[1] = 0xfe;
  for (let i = 0; i < t.length; i++) buf.writeUInt16LE(t.charCodeAt(i), 2 + i * 2);
  fs.writeFileSync(path.join(tmp, 'utf16le-bom.xml'), buf);
}

// ---- the documents --------------------------------------------------------------------------------------------
const corpus = path.join(root, 'build', 'corpus');
const dirs = opt('--dirs', null) ? opt('--dirs').split(',') : fs.existsSync(corpus) ? fs.readdirSync(corpus).sort() : [];
const list = fs.readdirSync(tmp).sort().map((f) => path.join(tmp, f));
for (const d of dirs) {
  const dir = path.join(corpus, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.xml')) list.push(path.join(dir, f));
}
const r = spawnSync(python, ['-I', path.join(__dirname, 'line-oracle', 'expat_lines.py')], { input: list.join('\n'), encoding: 'utf8', maxBuffer: 1 << 30 });
if (r.status !== 0) { console.log('expat reference failed: ' + (r.error ? r.error.message : r.stderr)); process.exit(2); }
const ref = new Map();
let expat = '';
for (const line of r.stdout.split('\n')) { if (!line) continue; const o = JSON.parse(line); if (o.expat) expat = o.expat; else ref.set(o.f, o); }

const env = createEnv({ exclude: /^PEPPOL-/ });
let compared = 0, elements = 0, noRef = 0, noDecode = 0, domChecked = 0, fail = 0;
const failures = [];
const bad = (m) => { fail++; if (failures.length < 30) failures.push(m); };
const decoded = (p) => { const d = XmlEncoding.decode(new Uint8Array(fs.readFileSync(p))); if (!d.ok || d.text === null) return null; return d.text.charCodeAt(0) === 0xfeff ? d.text.slice(1) : d.text; };
for (const p of list) {
  const o = ref.get(p);
  const edge = p.startsWith(tmp);
  if (!o || o.error) { noRef++; if (edge) bad('edge case ' + path.basename(p) + ': no expat reference (' + (o ? o.error : 'missing') + ')'); continue; }
  const text = decoded(p);
  if (text === null) { noDecode++; if (edge) bad('edge case ' + path.basename(p) + ': not decodable'); continue; }
  const ours = PrueferCore.elementLineIndex(text);
  compared++;
  elements += o.lines.length;
  if (JSON.stringify(ours) !== JSON.stringify(o.lines)) {
    const k = ours.findIndex((v, i) => v !== o.lines[i]);
    bad(path.relative(root, p) + ': element ' + (k + 1) + ' line ' + ours[k] + ', expat ' + o.lines[k] + ' (' + ours.length + ' vs ' + o.lines.length + ' elements)');
    continue;
  }
  // the parsed document has as many elements, in the same order
  const parsed = env.parseXml(text);
  if (parsed.doc) { domChecked++; const n = PrueferCore.elementsInDocumentOrder(parsed.doc).length; if (n !== ours.length) bad(path.relative(root, p) + ': ' + n + ' DOM elements, ' + ours.length + ' start tags'); }
}

// ---- the findings of documents: the reference line of the element each finding refers to -------------------------
let findings = 0, withLine = 0;
(async () => {
  const sample = list.filter((p) => /[\\/](xr-ubl|xr-cii|extra-ubl|extra-cii)[\\/]/.test(p));
  for (const p of sample) {
    const o = ref.get(p);
    if (!o || o.error) continue;
    const res = await PrueferCore.analyzeBytes(env, new Uint8Array(fs.readFileSync(p)), path.basename(p));
    if (!res.doc || !res.allFindings.length) continue;
    const els = PrueferCore.elementsInDocumentOrder(res.doc);
    const index = new Map(els.map((e, i) => [e, i]));
    let byPath = null;
    for (const f of res.allFindings) {
      findings++;
      let node = f.node || null;
      if (!node && f.source === 'xsd' && f.location) {
        if (!byPath) { byPath = new Map(); for (const k of res.docIndex.keys()) if (k.nodeType === 1 || k.nodeType === 2) byPath.set(env.SchematronRunner.nodePath(k), k); }
        node = byPath.get(f.location) || null;
      }
      const el = !node ? null : node.nodeType === 1 ? node : node.nodeType === 2 ? node.ownerElement : node.parentNode;
      const want = el && index.has(el) ? o.lines[index.get(el)] : null;
      if (f.line !== want) bad(path.relative(root, p) + ': ' + f.id + ' line ' + f.line + ', reference ' + want);
      if (f.line) withLine++;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const m of failures) console.log('FAIL ' + m);
  console.log('reference: expat ' + expat + ' (Python ' + spawnSync(python, ['-I', '-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8' }).stdout.trim() + '); ' + noRef + ' files without reference (not well-formed or encoding unknown to expat), ' + noDecode + ' not decodable');
  console.log('line numbers vs expat: ' + compared + ' documents (' + (Object.keys(CASES).length + 1) + ' of them edge cases), ' + elements + ' elements, ' + domChecked + ' element counts vs DOM; ' + findings + ' findings (' + withLine + ' with a line); ' + fail + ' differences');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
