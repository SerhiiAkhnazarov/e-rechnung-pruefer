#!/usr/bin/env node
/*
 * build-xsd-mutations.cjs — generates the XSD mutation corpus build/corpus/xsd-mutations/:
 *
 *  (A) systematic DOM mutations of ~150 schema-valid corpus documents (UBL Invoice/CreditNote,
 *      CII), chosen deterministically (seeded PRNG per file name) and guided by the compiled
 *      schema models (which child is required, which particle has maxOccurs=1, which value is a
 *      decimal/date, which attribute is required/fixed ...):
 *        base                  the unmodified document (control)
 *        remove-required       a required child element is removed
 *        duplicate-max1        a maxOccurs=1 element is duplicated
 *        swap-siblings         two adjacent, differently named sibling elements are swapped
 *        insert-unknown-element / insert-unknown-attribute
 *        letters-in-decimal    "12,5O" (comma and letter O) in a decimal
 *        wrong-date-format     "01.02.2024" in a date/dateTime/time (CII DateTimeString: string -> valid)
 *        empty-mandatory       a required simple-content element is emptied
 *        wrong-enumeration     (only when an enumerated type occurs — none in UBL/CII invoices)
 *        xsi-nil               xsi:nil="true" on a non-nillable element
 *        remove-required-attribute (UBL currencyID; CII has no required attributes -> optional one)
 *        nsless-element / foreign-ns-element
 *        text-in-element-only  stray text inside an element-only element
 *        wrong-fixed-attribute (CII: listID of a qualified code)
 *        xsi-type-wrong / xsi-type-same
 *        unknown-root          root element namespace changed
 *        extension-*           UBL: UBLExtensions with foreign / empty / known-but-invalid content
 *  (B) hand-crafted datatype and structure probes on two minimal templates (UBL Invoice with a
 *      ds:Signature + XAdES block inside UBLExtensions, and CII): every XSD built-in type the
 *      invoice schemas use (decimal, integer, boolean, date, dateTime, time, normalizedString,
 *      token+length facets, language, base64Binary, anyURI, ID), wildcards (lax/strict/skip,
 *      ##other/##any), mixed/empty content, xsi:type/xsi:nil/xsi:schemaLocation, fixed attributes,
 *      ID uniqueness, surrogate pairs in length facets, comments/CDATA inside values ...
 *
 * Every generated file is listed in build/corpus/xsd-mutations/MANIFEST.json together with the
 * mutation kind and (for probes) the expected verdict. The expectations were corrected to the
 * verdicts Xerces actually gives (e.g. length facets count UTF-16 code units, "QUJ=" is not valid
 * base64, "foo://" is not a valid anyURI, whitespace inside an empty-content element is an error);
 * the Xerces oracle run remains the proof, the expectations only document the behaviour.
 *
 * Usage: node test/build-xsd-mutations.cjs [--bases 150] [--zugferd <ext-dir>/zugferd-corpus] [--max-base-bytes 400000]
 *   (default of --zugferd: $EXT_DIR/zugferd-corpus, else ext/zugferd-corpus; the corpus is required)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function opt(n, d) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }
const BASES = parseInt(opt('--bases', '150'), 10);
const ZUGFERD = opt('--zugferd', path.join(process.env.EXT_DIR || path.join(root, 'ext'), 'zugferd-corpus'));
if (!fs.existsSync(ZUGFERD)) { console.error('build-xsd-mutations: ZUGFeRD corpus not found: ' + ZUGFERD); process.exit(2); }
const OUT = path.join(root, 'build', 'corpus', 'xsd-mutations');
const MAX_BASE_BYTES = parseInt(opt('--max-base-bytes', '400000'), 10);

const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const NS_INV = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const NS_CN = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const NS_CII = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const NS_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
const NS_RAM = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';

const models = {};
function modelFor(ns) {
  const id = ns === NS_CN ? 'UBL-CreditNote-2.1' : ns === NS_CII ? 'CII-D16B' : 'UBL-Invoice-2.1';
  if (!models[id]) {
    const json = JSON.parse(fs.readFileSync(path.join(root, 'build', 'xsd', id + '.json'), 'utf8'));
    models[id] = { id, json, validator: XV.create(json), nav: navigator(json) };
  }
  return models[id];
}

// ---------------------------------------------------------------------------------------------
// A small navigator over the JSON model: type of a document element, its child particles ...
// ---------------------------------------------------------------------------------------------
function navigator(m) {
  const nsIndex = new Map(m.ns.map((ns, i) => [ns, i]));
  const key = (el) => (nsIndex.has(el.namespaceURI || null) ? nsIndex.get(el.namespaceURI || null) : '?') + ':' + el.localName;
  const rawType = (ref) => (typeof ref === 'number' ? m.types[ref] : { k: 's', builtin: ref });
  const childMapCache = new Map();
  /** key -> {ref, min, max, decl} for all element particles of a complex type (base chain included) */
  function childMap(ref) {
    if (typeof ref !== 'number') return new Map();
    if (childMapCache.has(ref)) return childMapCache.get(ref);
    const map = new Map();
    const t = m.types[ref];
    if (t.k === 'c' && t.der === 'e' && typeof t.b === 'number') for (const [k, v] of childMap(t.b)) map.set(k, v);
    const walk = (p, outerMin, outerMax) => {
      if (p[0] === 'r') { const d = m.elements[p[1]]; map.set(p[1], { ref: d.t, min: Math.min(p[2], outerMin), max: p[3] === -1 || outerMax === -1 ? -1 : p[3] * outerMax, decl: d }); }
      else if (p[0] === 'e') map.set(p[1], { ref: p[2], min: Math.min(p[3], outerMin), max: p[4] === -1 || outerMax === -1 ? -1 : p[4] * outerMax, decl: p[5] || {} });
      else if (p[0] === 's' || p[0] === 'c') for (const q of p[3]) walk(q, p[0] === 'c' ? 0 : Math.min(outerMin, p[1]), p[2] === -1 || outerMax === -1 ? -1 : p[2] * outerMax);
    };
    if (t.k === 'c' && t.p) walk(t.p, 1, 1);
    childMapCache.set(ref, map);
    return map;
  }
  /** attribute uses of a complex type: Map(key -> use) */
  function attrMap(ref) {
    if (typeof ref !== 'number') return new Map();
    const t = m.types[ref];
    const map = t.k === 'c' && typeof t.b === 'number' ? new Map(attrMap(t.b)) : new Map();
    if (t.k === 'c' && t.a) for (const a of t.a) { if (a.u === 'p') map.delete(a.n || a.r); else map.set(a.n || a.r, a); }
    return map;
  }
  /** primitive of a simple type / simple content (string name) */
  function primitiveOf(ref) {
    let r = ref;
    for (let guard = 0; guard < 50; guard++) {
      if (typeof r === 'string') return r.slice(3);
      const t = m.types[r];
      if (t.k === 's') { if (t.list !== undefined || t.union !== undefined) return 'list'; r = t.b; continue; }
      if (t.sc) { if (t.der === 'r' && t.st !== undefined) r = t.st; else r = t.b; continue; }
      return null;    // complex content
    }
    return null;
  }
  function hasEnumeration(ref) {
    let r = ref;
    for (let guard = 0; guard < 50; guard++) {
      if (typeof r === 'string') return false;
      const t = m.types[r];
      if (t.k === 's') { if (t.f && t.f.enumeration) return true; r = t.b; continue; }
      if (t.sc) { if (t.sf && t.sf.enumeration) return true; r = t.der === 'r' && t.st !== undefined ? t.st : t.b; continue; }
      return false;
    }
    return false;
  }
  function contentKind(ref) {
    if (typeof ref === 'string') return 'simple';
    const t = m.types[ref];
    if (t.k === 's' || t.sc) return 'simple';
    if (childMap(ref).size) return t.mixed ? 'mixed' : 'elementOnly';
    return t.mixed ? 'mixed' : 'empty';
  }
  /** type ref of a document element, walking down from the root (null when the path leaves the schema) */
  function typeRefOf(el) {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) chain.unshift(n);
    const rd = m.elements[key(chain[0])];
    if (!rd) return null;
    let ref = rd.t;
    for (let i = 1; i < chain.length; i++) {
      const c = childMap(ref).get(key(chain[i]));
      if (!c) return null;
      ref = c.ref;
    }
    return ref;
  }
  function typeName(ref) { if (typeof ref === 'string') return ref; const t = m.types[ref]; return t.n || null; }
  return { key, childMap, attrMap, primitiveOf, hasEnumeration, contentKind, typeRefOf, typeName, ns: m.ns, elements: m.elements };
}

// ---------------------------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(rnd, arr) { return arr.length ? arr[Math.floor(rnd() * arr.length)] : null; }
function allElements(doc) { const out = []; (function walk(n) { for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) { out.push(c); walk(c); } })(doc); return out; }
function elementChildren(el) { const out = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; }
function serialize(doc) { return slimdom.serializeToWellFormedString(doc); }
function prefixedName(parent, ns, local) {
  const p = parent.lookupPrefix(ns);
  return p ? p + ':' + local : local;
}

// ---------------------------------------------------------------------------------------------
// (A) generic mutations
// ---------------------------------------------------------------------------------------------
function mutate(text, baseName, rnd) {
  const results = [];     // {kind, note, xml}
  const parse = () => slimdom.parseXmlDocument(text);
  const doc0 = parse();
  const ns0 = doc0.documentElement.namespaceURI;
  const M = modelFor(ns0);
  const nav = M.nav;
  const isUbl = ns0 !== NS_CII;

  function withDoc(kind, note, fn) {
    const doc = parse();
    const r = fn(doc);
    if (r === false) return;
    results.push({ kind, note: note || '', xml: serialize(doc) });
  }

  results.push({ kind: 'base', note: 'unmodified control copy', xml: text });

  // candidates computed once on doc0; the mutations re-find the element by index in document order
  const els = allElements(doc0);
  const indexOf = new Map(els.map((e, i) => [e, i]));
  const byIndex = (doc, i) => allElements(doc)[i];

  // 1. remove a required child
  {
    const cands = [];
    for (const e of els) {
      const ref = nav.typeRefOf(e); if (ref === null) continue;
      const cm = nav.childMap(ref);
      for (const c of elementChildren(e)) {
        const pc = cm.get(nav.key(c));
        if (pc && pc.min >= 1 && elementChildren(e).filter((x) => x.nodeName === c.nodeName).length <= pc.min) cands.push(c);
      }
    }
    const target = pick(rnd, cands);
    if (target) withDoc('remove-required', 'removed ' + target.nodeName, (doc) => { const t = byIndex(doc, indexOf.get(target)); t.parentNode.removeChild(t); });
  }
  // 2. duplicate a maxOccurs=1 element
  {
    const cands = [];
    for (const e of els) {
      const ref = nav.typeRefOf(e); if (ref === null) continue;
      const cm = nav.childMap(ref);
      for (const c of elementChildren(e)) { const pc = cm.get(nav.key(c)); if (pc && pc.max === 1) cands.push(c); }
    }
    const target = pick(rnd, cands);
    if (target) withDoc('duplicate-max1', 'duplicated ' + target.nodeName, (doc) => { const t = byIndex(doc, indexOf.get(target)); t.parentNode.insertBefore(t.cloneNode(true), t.nextSibling); });
  }
  // 3. swap two adjacent siblings with different names
  {
    const cands = [];
    for (const e of els) {
      const ch = elementChildren(e);
      for (let i = 0; i + 1 < ch.length; i++) if (ch[i].nodeName !== ch[i + 1].nodeName) cands.push(ch[i]);
    }
    const target = pick(rnd, cands);
    if (target) withDoc('swap-siblings', 'swapped ' + target.nodeName + ' with its next sibling', (doc) => {
      const t = byIndex(doc, indexOf.get(target));
      let nx = t.nextSibling; while (nx && nx.nodeType !== 1) nx = nx.nextSibling;
      t.parentNode.insertBefore(nx, t);
    });
  }
  // 4. unknown element (target namespace of the parent, unknown name)
  {
    const target = pick(rnd, els.filter((e) => nav.contentKind(nav.typeRefOf(e) === null ? 'xs:string' : nav.typeRefOf(e)) === 'elementOnly'));
    if (target) withDoc('insert-unknown-element', 'inserted <ZZUnknownElement> into ' + target.nodeName, (doc) => {
      const t = byIndex(doc, indexOf.get(target));
      const ns = isUbl ? NS_CBC : NS_RAM;
      const n = doc.createElementNS(ns, prefixedName(t, ns, 'ZZUnknownElement'));
      t.insertBefore(n, t.firstChild);
    });
  }
  // 5. unknown attribute
  {
    const target = pick(rnd, els);
    if (target) withDoc('insert-unknown-attribute', 'added zzUnknown="1" to ' + target.nodeName, (doc) => { byIndex(doc, indexOf.get(target)).setAttribute('zzUnknown', '1'); });
  }
  // 6. letters in a decimal
  {
    const cands = els.filter((e) => { const r = nav.typeRefOf(e); return r !== null && nav.primitiveOf(r) === 'decimal'; });
    const target = pick(rnd, cands);
    if (target) withDoc('letters-in-decimal', target.nodeName + ' := "12,5O"', (doc) => { byIndex(doc, indexOf.get(target)).textContent = '12,5O'; });
  }
  // 7. wrong date format
  {
    const cands = els.filter((e) => { const r = nav.typeRefOf(e); const p = r !== null && nav.primitiveOf(r); return p === 'date' || p === 'dateTime' || p === 'time' || (!isUbl && e.localName === 'DateTimeString'); });
    const target = pick(rnd, cands);
    if (target) withDoc('wrong-date-format', target.nodeName + ' := "01.02.2024"' + (target.localName === 'DateTimeString' ? ' (xs:string with @format: schema-valid)' : ''), (doc) => { byIndex(doc, indexOf.get(target)).textContent = '01.02.2024'; });
  }
  // 8. empty a mandatory simple-content element
  {
    const cands = [];
    for (const e of els) {
      const ref = nav.typeRefOf(e); if (ref === null) continue;
      const cm = nav.childMap(ref);
      for (const c of elementChildren(e)) { const pc = cm.get(nav.key(c)); if (pc && pc.min >= 1 && nav.contentKind(pc.ref) === 'simple') cands.push(c); }
    }
    const target = pick(rnd, cands);
    if (target) withDoc('empty-mandatory', target.nodeName + ' emptied (' + nav.primitiveOf(nav.typeRefOf(target)) + ')', (doc) => { byIndex(doc, indexOf.get(target)).textContent = ''; });
  }
  // 9. wrong enumeration value
  {
    const cands = els.filter((e) => { const r = nav.typeRefOf(e); return r !== null && nav.hasEnumeration(r); });
    const target = pick(rnd, cands);
    if (target) withDoc('wrong-enumeration', target.nodeName + ' := "ZZ"', (doc) => { byIndex(doc, indexOf.get(target)).textContent = 'ZZ'; });
  }
  // 10. xsi:nil
  {
    const target = pick(rnd, els.filter((e) => e !== doc0.documentElement));
    if (target) withDoc('xsi-nil', 'xsi:nil="true" on ' + target.nodeName, (doc) => { byIndex(doc, indexOf.get(target)).setAttributeNS(XSI, 'xsi:nil', 'true'); });
  }
  // 11. remove a required attribute (or, when the syntax has none, an optional one)
  {
    const req = [], optional = [];
    for (const e of els) {
      const ref = nav.typeRefOf(e); if (ref === null) continue;
      const am = nav.attrMap(ref);
      for (const a of Array.from(e.attributes)) {
        if (a.namespaceURI) continue;
        const use = am.get('0:' + a.localName);
        if (!use) continue;
        (use.u === 'r' ? req : optional).push({ e, a: a.localName });
      }
    }
    const target = pick(rnd, req) || pick(rnd, optional);
    if (target) withDoc('remove-required-attribute', 'removed @' + target.a + ' from ' + target.e.nodeName + (req.length ? '' : ' (optional attribute: syntax has no required ones)'), (doc) => { byIndex(doc, indexOf.get(target.e)).removeAttribute(target.a); });
  }
  // 12. namespace-less element
  {
    const target = pick(rnd, els.filter((e) => elementChildren(e).length));
    if (target) withDoc('nsless-element', 'inserted <ZZUnknown/> (no namespace) into ' + target.nodeName, (doc) => { const t = byIndex(doc, indexOf.get(target)); const n = doc.createElementNS(null, 'ZZUnknown'); t.insertBefore(n, elementChildren(t)[0]); });
  }
  // 13. element from another namespace
  {
    const target = pick(rnd, els.filter((e) => elementChildren(e).length));
    if (target) withDoc('foreign-ns-element', 'inserted <zz:Foo xmlns:zz="urn:example:zz"/> into ' + target.nodeName, (doc) => { const t = byIndex(doc, indexOf.get(target)); const n = doc.createElementNS('urn:example:zz', 'zz:Foo'); t.appendChild(n); });
  }
  // 14. stray text in element-only content
  {
    const target = pick(rnd, els.filter((e) => { const r = nav.typeRefOf(e); return r !== null && nav.contentKind(r) === 'elementOnly'; }));
    if (target) withDoc('text-in-element-only', 'text node inside ' + target.nodeName, (doc) => { const t = byIndex(doc, indexOf.get(target)); t.insertBefore(doc.createTextNode('stray text'), t.firstChild); });
  }
  // 15. wrong fixed attribute value
  {
    const cands = [];
    for (const e of els) {
      const ref = nav.typeRefOf(e); if (ref === null) continue;
      for (const [k, use] of nav.attrMap(ref)) if (use.fixed !== undefined && !k.includes('?')) cands.push({ e, a: k.slice(k.indexOf(':') + 1), fixed: use.fixed });
    }
    const target = pick(rnd, cands);
    if (target) withDoc('wrong-fixed-attribute', target.e.nodeName + '/@' + target.a + ' := "ZZ" (fixed "' + target.fixed + '")', (doc) => { byIndex(doc, indexOf.get(target.e)).setAttribute(target.a, 'ZZ'); });
    const target2 = pick(rnd, cands);
    if (target2) withDoc('fixed-attribute-ok', target2.e.nodeName + '/@' + target2.a + ' := " ' + target2.fixed + ' " (fixed value with surrounding whitespace, token)', (doc) => { byIndex(doc, indexOf.get(target2.e)).setAttribute(target2.a, ' ' + target2.fixed + ' '); });
  }
  // 16. xsi:type
  {
    const cands = els.filter((e) => { const r = nav.typeRefOf(e); return typeof r === 'number' && nav.typeName(r); });
    const target = pick(rnd, cands);
    if (target) {
      withDoc('xsi-type-wrong', 'xsi:type="' + (isUbl ? 'cac:PartyType' : 'ram:TradePartyType') + '" on ' + target.nodeName, (doc) => {
        const t = byIndex(doc, indexOf.get(target));
        const ns = isUbl ? NS_CAC : NS_RAM;
        let p = t.lookupPrefix(ns);
        if (!p) { p = isUbl ? 'cac' : 'ram'; doc.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:' + p, ns); }
        t.setAttributeNS(XSI, 'xsi:type', p + ':' + (isUbl ? 'PartyType' : 'TradePartyType'));
      });
      withDoc('xsi-type-same', 'xsi:type = declared type on ' + target.nodeName, (doc) => {
        const t = byIndex(doc, indexOf.get(target));
        const tn = nav.typeName(nav.typeRefOf(target));
        const nsIdx = +tn.slice(0, tn.indexOf(':')), local = tn.slice(tn.indexOf(':') + 1);
        const ns = nav.ns[nsIdx];
        let p = t.lookupPrefix(ns);
        if (!p) { p = 'zzt'; doc.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:zzt', ns); }
        t.setAttributeNS(XSI, 'xsi:type', p + ':' + local);
      });
    }
  }
  // 17. unknown root namespace
  withDoc('unknown-root', 'root namespace replaced by urn:example:unknown', (doc) => {
    const old = doc.documentElement;
    const n = doc.createElementNS('urn:example:unknown', old.nodeName);
    for (const a of Array.from(old.attributes)) if (!(a.name === 'xmlns' || (a.prefix === 'xmlns' && a.value === old.namespaceURI))) n.setAttributeNS(a.namespaceURI, a.name, a.value);
    while (old.firstChild) n.appendChild(old.firstChild);
    doc.replaceChild(n, old);
  });
  // 18. UBL extensions
  if (isUbl) {
    const addExt = (doc, inner) => {
      const r = doc.documentElement;
      const ext = doc.createElementNS(NS_EXT, 'ext:UBLExtensions');
      const e1 = doc.createElementNS(NS_EXT, 'ext:UBLExtension');
      const c = doc.createElementNS(NS_EXT, 'ext:ExtensionContent');
      ext.appendChild(e1); e1.appendChild(c);
      for (const n of inner(doc)) c.appendChild(n);
      // remove an existing UBLExtensions first
      for (const ch of elementChildren(r)) if (ch.localName === 'UBLExtensions') r.removeChild(ch);
      r.insertBefore(ext, r.firstChild);
    };
    withDoc('extension-foreign-lax', 'UBLExtensions with <zz:Anything> (##other lax, unknown -> not assessed)', (doc) => addExt(doc, (d) => { const n = d.createElementNS('urn:example:zz', 'zz:Anything'); n.setAttribute('whatever', '1'); n.appendChild(d.createElementNS('urn:example:zz', 'zz:Child')); return [n]; }));
    withDoc('extension-empty', 'UBLExtensions with empty ExtensionContent (wildcard minOccurs=1)', (doc) => addExt(doc, () => []));
    withDoc('extension-known-invalid', 'UBLExtensions with <cbc:ID currencyID="x"> (known global element, invalid attribute)', (doc) => addExt(doc, (d) => { const n = d.createElementNS(NS_CBC, 'cbc:ID'); n.setAttribute('currencyID', 'x'); n.textContent = '1'; return [n]; }));
    withDoc('extension-known-valid', 'UBLExtensions with <cac:Party><cbc:EndpointID>…</…> (known global elements, valid)', (doc) => addExt(doc, (d) => { const p = d.createElementNS(NS_CAC, 'cac:Party'); const n = d.createElementNS(NS_CBC, 'cbc:EndpointID'); n.setAttribute('schemeID', 'x'); n.textContent = '1'; p.appendChild(n); return [p]; }));
    withDoc('extension-nsless', 'UBLExtensions with a namespace-less element (##other excludes absent namespace)', (doc) => addExt(doc, (d) => [d.createElementNS(null, 'Anything')]));
    withDoc('extension-own-ns', 'UBLExtensions with <ext:Foo> (##other excludes the target namespace)', (doc) => addExt(doc, (d) => [d.createElementNS(NS_EXT, 'ext:Foo')]));
    withDoc('extension-two-children', 'UBLExtensions with two foreign elements (wildcard maxOccurs=1)', (doc) => addExt(doc, (d) => [d.createElementNS('urn:example:zz', 'zz:A'), d.createElementNS('urn:example:zz', 'zz:B')]));
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// (B) probes
// ---------------------------------------------------------------------------------------------
const UBL_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"{{ROOT_ATTRS}}>
{{EXTENSIONS}}  <cbc:ID{{ID_ATTRS}}>{{ID}}</cbc:ID>
{{COPY_INDICATOR}}  <cbc:IssueDate>{{ISSUE_DATE}}</cbc:IssueDate>
{{ISSUE_TIME}}{{NOTE}}{{ADR}}  <cac:AccountingSupplierParty{{ASP_ATTRS}}>{{ASP_CONTENT}}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty/>
  <cac:LegalMonetaryTotal><cbc:PayableAmount{{AMOUNT_ATTRS}}>{{AMOUNT}}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID>{{QUANTITY}}<cbc:LineExtensionAmount currencyID="EUR">1</cbc:LineExtensionAmount><cac:Item/></cac:InvoiceLine>
</Invoice>
`;
const SIG_TEMPLATE = `  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent>{{BEFORE_SIG}}<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="{{SIG_ID}}"{{SIG_ATTRS}}>
    <ds:SignedInfo>
      <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">{{CANON_CONTENT}}</ds:CanonicalizationMethod>
      <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
      <ds:Reference URI="{{REF_URI}}">
        <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">{{DIGEST_CONTENT}}</ds:DigestMethod>
        <ds:DigestValue>{{DIGEST}}</ds:DigestValue>
      </ds:Reference>
    </ds:SignedInfo>
    <ds:SignatureValue>QUJD</ds:SignatureValue>
    <ds:KeyInfo{{KEYINFO_ATTRS}}>{{KEYINFO_TEXT}}<ds:X509Data><ds:X509IssuerSerial><ds:X509IssuerName>CN=x</ds:X509IssuerName><ds:X509SerialNumber>{{SERIAL}}</ds:X509SerialNumber></ds:X509IssuerSerial></ds:X509Data>{{KEYINFO_EXTRA}}</ds:KeyInfo>
    <ds:Object Id="{{OBJ_ID}}">{{OBJECT_CONTENT}}</ds:Object>
  </ds:Signature>{{AFTER_SIG}}</ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
`;
const XADES_TEMPLATE = `<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#sig1"{{QP_ATTRS}}><xades:SignedProperties><xades:SignedDataObjectProperties><xades:AllDataObjectsTimeStamp><xades:Include URI="#x"{{INCLUDE_ATTRS}}>{{INCLUDE_CONTENT}}</xades:Include><xades:EncapsulatedTimeStamp>QUJD</xades:EncapsulatedTimeStamp></xades:AllDataObjectsTimeStamp></xades:SignedDataObjectProperties>{{UNSIGNED}}</xades:SignedProperties></xades:QualifyingProperties>`;

const CII_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <rsm:ExchangedDocumentContext/>
  <rsm:ExchangedDocument>
    <ram:ID>1</ram:ID>
    {{TYPECODE}}
    <ram:IssueDateTime>{{ISSUE_DT}}</ram:IssueDateTime>
    {{AFTER_ISSUE}}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    {{LINE}}
    <ram:ApplicableHeaderTradeAgreement/>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>{{SETTLEMENT}}</ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : ''));
}
const UBL_DEFAULTS = { ID: '123', ISSUE_DATE: '2024-01-31', AMOUNT: '100.00', AMOUNT_ATTRS: ' currencyID="EUR"' };
const SIG_DEFAULTS = { SIG_ID: 'sig1', OBJ_ID: 'obj1', SERIAL: '1', DIGEST: 'QUJD', REF_URI: '', OBJECT_CONTENT: fill(XADES_TEMPLATE, {}) };
const CII_DEFAULTS = { ISSUE_DT: '<udt:DateTimeString format="102">20240131</udt:DateTimeString>' };

function ubl(vars) { return fill(UBL_TEMPLATE, Object.assign({}, UBL_DEFAULTS, vars)); }
function ublSig(sigVars, vars) {
  const sig = fill(SIG_TEMPLATE, Object.assign({}, SIG_DEFAULTS, sigVars));
  return ubl(Object.assign({ EXTENSIONS: sig }, vars));
}
function xades(v) { return fill(XADES_TEMPLATE, v || {}); }
function cii(vars) { return fill(CII_TEMPLATE, Object.assign({}, CII_DEFAULTS, vars)); }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function probes() {
  const P = [];
  const add = (id, expect, xml, note) => P.push({ id, expect, xml, note: note || '' });
  // --- templates themselves
  add('ubl-template', true, ubl({}), 'minimal UBL invoice');
  add('ubl-template-sig', true, ublSig({}), 'minimal UBL invoice with ds:Signature + XAdES in UBLExtensions');
  add('cii-template', true, cii({}), 'minimal CII invoice');
  // --- decimal (cbc:PayableAmount: udt:AmountType -> xs:decimal)
  const dec = { '1.': true, '.5': true, '+1': true, '-0': true, '00': true, '1e5': false, '1.2.3': false, '': false, ' 1 ': true, '１': false, '1 000': false, '-': false, '+': false, '.': false, '0x10': false, '1_000': false, '1,5': false, '1.50': true, '-.5': true, '\n1\n': true, '1.5\t': true, '١': false, 'NaN': false, 'INF': false, '1.5 ': true, '0.': true, '00.00': true, '1.0e0': false };
  let n = 0;
  for (const [v, ok] of Object.entries(dec)) add('decimal-' + (n++), ok, ubl({ AMOUNT: esc(v) }), 'PayableAmount = ' + JSON.stringify(v));
  // --- integer (ds:X509SerialNumber: xs:integer)
  const ints = { '1.0': false, '+5': true, '-0': true, '01': true, '1.': false, '': false, ' 7 ': true, '1e2': false, '123456789012345678901234567890': true, '٣': false, '1 2': false };
  n = 0;
  for (const [v, ok] of Object.entries(ints)) add('integer-' + (n++), ok, ublSig({ SERIAL: esc(v) }), 'X509SerialNumber = ' + JSON.stringify(v));
  // --- boolean (cbc:CopyIndicator)
  const bools = { true: true, TRUE: false, '1': true, '0': true, yes: false, '': false, ' true ': true, True: false, 'true false': false, '01': false };
  n = 0;
  for (const [v, ok] of Object.entries(bools)) add('boolean-' + (n++), ok, ubl({ COPY_INDICATOR: '  <cbc:CopyIndicator>' + esc(v) + '</cbc:CopyIndicator>\n' }), 'CopyIndicator = ' + JSON.stringify(v));
  // --- date (cbc:IssueDate)
  const dates = { '2024-02-30': false, '2024-1-1': false, '2024-01-01Z': true, '2024-01-01+01:00': true, '2024-01-01+14:00': true, '2024-01-01+14:30': false, '2024-01-01+15:00': false, '2024-01-01-14:00': true, '0000-01-01': false, '-0001-01-01': true, '02024-01-01': false, '12024-01-01': true, '2024-01-01T00:00:00': false, '2024-01-01 ': true, '2024-02-29': true, '2023-02-29': false, '2024-01-01+1:00': false, '2024-01-01+01': false, '2024-01-01z': false, '20240101': false, '': false, ' ': false, '2024-01-01+01:60': false, '2024-00-10': false, '2024-13-01': false, '2024-04-31': false, '1900-02-29': false, '2000-02-29': true, '2024-01-01+00:00': true, '2024-01-01-00:00': true, '2024-01-01Z ': true, '2024-01-0１': false, '2024-01-01+13:59': true, '999-01-01': false, '-2024-01-01Z': true };
  n = 0;
  for (const [v, ok] of Object.entries(dates)) add('date-' + (n++), ok, ubl({ ISSUE_DATE: esc(v) }), 'IssueDate = ' + JSON.stringify(v));
  // --- dateTime (CII udt:DateTime: xs:dateTime)
  const dts = { '2024-01-01T10:00:00': true, '2024-01-01T24:00:00': true, '2024-01-01T24:00:01': false, '2024-01-01T10:00:60': false, '2024-01-01T10:00:59': true, '2024-01-01T10:00:00.5': true, '2024-01-01T10:00:00.': false, '2024-01-01T10:00': false, '2024-01-01t10:00:00': false, '2024-01-01T10:00:00Z': true, '2024-01-01T10:00:00+01:00': true, '2024-01-01T10:00:00+01': false, '2024-01-01T10:00:00 Z': false, '2024-01-01T10:00:00.123456789Z': true, '2024-01-01T1:00:00': false, '2024-01-01': false, '2024-01-01T10:60:00': false, '2024-01-01T25:00:00': false, '2024-01-01T24:01:00': false, '2024-01-01TT10:00:00': false, '2024-01-01T10:00:00.5.5': false, '2024-01-01T10:00:00-01:00': true, '2024-01-01T10:00:00+14:01': false, '2024-12-31T24:00:00Z': true, '2024-01-01T10:00:00+0100': false, '2024-01-01x T10:00:00': false, '2024-01-011T10:00:00': false, '2024-01-01T10:00:00+01:00:00': false };
  n = 0;
  for (const [v, ok] of Object.entries(dts)) add('dateTime-' + (n++), ok, cii({ ISSUE_DT: '<udt:DateTime>' + esc(v) + '</udt:DateTime>' }), 'udt:DateTime = ' + JSON.stringify(v));
  // --- time (cbc:IssueTime)
  const times = { '10:00:00': true, '24:00:00': true, '10:00': false, '10:00:00.5Z': true, '24:00:00.5': false, '10:00:00+01:00': true, '10:00:00Z': true, '1:00:00': false, '10:00:00.': false, '': false };
  n = 0;
  for (const [v, ok] of Object.entries(times)) add('time-' + (n++), ok, ubl({ ISSUE_TIME: '  <cbc:IssueTime>' + esc(v) + '</cbc:IssueTime>\n' }), 'IssueTime = ' + JSON.stringify(v));
  // --- normalizedString (cbc:ID)
  add('normalizedString-empty', true, ubl({ ID: '' }), 'cbc:ID empty');
  add('normalizedString-ws', true, ubl({ ID: ' a ' }), 'cbc:ID " a "');
  add('normalizedString-newline', true, ubl({ ID: 'a\nb' }), 'cbc:ID with newline (replaced)');
  add('normalizedString-tab', true, ubl({ ID: 'a\tb' }), 'cbc:ID with tab');
  add('normalizedString-comment', true, ubl({ ID: '1<!-- c -->2' }), 'cbc:ID with a comment inside');
  add('normalizedString-cdata', true, ubl({ ID: '<![CDATA[<x>]]>' }), 'cbc:ID with CDATA');
  add('normalizedString-child', false, ubl({ ID: '1<cbc:Foo/>' }), 'cbc:ID with a child element (simple content)');
  add('decimal-comment-split', true, ubl({ AMOUNT: '1<!--x-->.5' }), 'PayableAmount "1<!--x-->.5" (text runs around a comment are concatenated)');
  add('decimal-pi-split', true, ubl({ AMOUNT: '1<?pi x?>.5' }), 'PayableAmount "1<?pi?>.5"');
  // --- token with minLength 1 / maxLength 3 (CII qdt:LinearUnitMeasureUnitCodeContentType? -> use ram:... with LinearUnitMeasureType)
  // The unitCode attribute of qdt:LinearUnitMeasureType is used by ram:GrossWeightMeasure? No — by ram:...LinearSpatialDimension (ram:WidthMeasure etc.) — verified in build.
  const lengthVals = { '': false, A: true, ABC: true, ABCD: false, '  AB  ': true, '😀😀😀': false, '😀😀😀😀': false, 'A B': true, 'A  B': true, '😀😀': false }; // Xerces counts UTF-16 code units: '😀😀' has length 4
  n = 0;
  for (const [v, ok] of Object.entries(lengthVals)) {
    const line = '<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument/><ram:SpecifiedTradeProduct><ram:LinearSpatialDimension><ram:DiameterMeasure unitCode="' + esc(v) + '">1</ram:DiameterMeasure></ram:LinearSpatialDimension></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeSettlement/></ram:IncludedSupplyChainTradeLineItem>';
    add('token-length-' + (n++), ok, cii({ LINE: line }), 'ram:DiameterMeasure/@unitCode (qdt:LinearUnitMeasureUnitCodeContentType: token, minLength 1, maxLength 3) = ' + JSON.stringify(v));
    const wline = '<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument/><ram:SpecifiedLineTradeDelivery><ram:NetWeightMeasure unitCode="' + esc(v) + '">1</ram:NetWeightMeasure></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement/></ram:IncludedSupplyChainTradeLineItem>';
    add('token-length-w' + n, ok, cii({ LINE: wline }), 'ram:NetWeightMeasure/@unitCode (qdt:WeightUnitMeasureUnitCodeContentType) = ' + JSON.stringify(v));
  }
  // --- language (cbc:Note/@languageID)
  const langs = { de: true, 'de-DE': true, 'x-klingon': true, deutsch123: false, de_DE: false, '': false, 'a-b-c-d': true, '1de': false, 'de-': false, 'abcdefgh': true, 'abcdefghi': false, 'de-12345678': true, 'de-123456789': false, ' de ': true, 'i-klingon': true, 'de-Latn-DE': true };
  n = 0;
  for (const [v, ok] of Object.entries(langs)) add('language-' + (n++), ok, ubl({ NOTE: '  <cbc:Note languageID="' + esc(v) + '">x</cbc:Note>\n' }), 'Note/@languageID = ' + JSON.stringify(v));
  // --- base64Binary (cbc:EmbeddedDocumentBinaryObject, mimeCode required)
  const adr = (b64, attrs) => '  <cac:AdditionalDocumentReference><cbc:ID>d</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject' + (attrs === undefined ? ' mimeCode="text/plain"' : attrs) + '>' + b64 + '</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>\n';
  const b64s = { '': true, QUJD: true, 'QUJ=': false, 'QQ==': true, 'QR==': false, QUJDRA: false, 'Q UJD': true, 'QUJD====': false, 'QUJD\nRA==': true, 'QUJ=RA==': false, '****': false, 'QUJDRA==': true, 'QUJD RA==': true, 'QUJDR===': false, '=': false, 'Q===': false, 'QUJD RA= =': false, 'QUJDQUJD': true, 'QUJ A': false, 'QUJD\r\n': true };
  n = 0;
  for (const [v, ok] of Object.entries(b64s)) add('base64-' + (n++), ok, ubl({ ADR: adr(esc(v)) }), 'EmbeddedDocumentBinaryObject = ' + JSON.stringify(v));
  add('base64-no-mimecode', false, ubl({ ADR: adr('QUJD', '') }), 'EmbeddedDocumentBinaryObject without required @mimeCode');
  add('base64-filename', true, ubl({ ADR: adr('QUJD', ' mimeCode="text/plain" filename="a.txt" encodingCode="x" characterSetCode="y" uri="http://x" format="f"') }), 'all BinaryObject attributes');
  // --- anyURI (cbc:ID/@schemeURI)
  const uris = { 'http://a.b/c': true, 'a b': true, ':x': false, '1x:y': false, 'x:': false, 'x:#f': false, '#f': true, '%zz': false, 'a[b]': false, 'http://[::1]/': true, 'http://[::1': false, 'http://host:abc/': true, 'mailto:a@b': true, 'ü': true, 'http://a/{': true, 'a?b?c': true, 'a#b#c': false, 'http://a b.c/': true, '../x': true, '//host/path': true, 'a:b': true, 'urn:x': true, 'x:/y': true, '': true, '   ': true, 'http://a/b%2': false, 'foo://': false, '?x': true, 'x y:z': false, 'a/b:c': true, 'http://a/b|c': true, 'tel:+49': true, 'x:[a]': true, 'x:/[a]': false, 'http://a/b#': true, 'http://a/#f%41': true, 'http://a/#f%4': false, 'http://user:pw@host:80/p?q=1#f': true, 'http://a/b<c>': true, 'http://a/b"c': true, 'http://a/b\\c': true, 'http://a/b^c': true, 'http://a/b`c': true, 'http://a/b\u007f': true, 'a:b:c': true, 'http://a/b;c=d': true, 'http://a/b]c': false, 'http://a/b[c': false, 'http://a/?[': true, 'http://a/#[': true, 'http://[::1]:80/': true, 'http://[::1]x/': false, 'http://[1:2:3:4:5:6:7:8]/': true, 'http://[1:2:3:4:5:6:7:8:9]/': false, 'http://[::1.2.3.4]/': true, 'http://[::1.2.3.400]/': false, 'http://1.2.3.999/': true, 'http://-a.b/': true, 'http://a_b/': true, 'http://a.b./': true, 'http://a..b/': true, 'http://:80/': true, 'http://@/': true, 'http:///path': true, 'http://a:/': true, 'http://a:99999/': true, 'a:%zz': false, 'a:b%2': false, 'http://a/b%zz': false, 'x:y z': true, 'http://a/b c': true, 'HTTP://A/B': true, 'h-t.t+p://a/': true, 'h_ttp://a/': false, 'h ttp://a/': false, '/abs/path': true, '//': false, '///': true, '#': true, '?': true, 'a:/b?c#d': true, 'a:b#c#d': false, 'a%20b': true, '%41': true, '%4': false, 'http://a/b%C3%BC': true };
  n = 0;
  for (const [v, ok] of Object.entries(uris)) add('anyURI-' + (n++), ok, ubl({ ID_ATTRS: ' schemeURI="' + esc(v) + '"' }), 'cbc:ID/@schemeURI = ' + JSON.stringify(v));
  // --- ID (ds:Signature/@Id, ds:Object/@Id)
  add('id-dup', false, ublSig({ OBJ_ID: 'sig1' }), 'duplicate ID value');
  add('id-invalid-start', false, ublSig({ SIG_ID: '1a' }), 'ID starting with a digit');
  add('id-space', false, ublSig({ SIG_ID: 'a b' }), 'ID with space');
  add('id-nonascii', true, ublSig({ SIG_ID: 'ü' }), 'ID "ü" (letter)');
  add('id-colon', false, ublSig({ SIG_ID: 'a:b' }), 'ID with colon (NCName)');
  add('id-ws', true, ublSig({ SIG_ID: ' a ' }), 'ID " a " (collapsed)');
  add('id-empty', false, ublSig({ SIG_ID: '' }), 'empty ID');
  add('id-dot', true, ublSig({ SIG_ID: 'a.b-c_d' }), 'ID "a.b-c_d"');
  add('id-middledot', true, ublSig({ SIG_ID: 'a\u00b7b' }), 'ID with U+00B7');
  add('id-astral', false, ublSig({ SIG_ID: 'a😀' }), 'ID with astral char');
  add('id-combining-start', false, ublSig({ SIG_ID: '\u0301a' }), 'ID starting with a combining mark');
  // --- xsi:nil / xsi:type / xsi:schemaLocation / xsi:other
  add('xsi-nil-true', false, ubl({ ID_ATTRS: ' xsi:nil="true"', ID: '' }), 'xsi:nil="true" on non-nillable cbc:ID');
  add('xsi-nil-false', false, ubl({ ID_ATTRS: ' xsi:nil="false"' }), 'xsi:nil="false" on non-nillable element');
  add('xsi-nil-lax-unknown', true, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:nil="true"><zz:Y/></zz:X></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'xsi:nil="true" with content on an unknown element matched by a lax wildcard (not assessed)');
  add('xsi-type-same', true, ubl({ ID_ATTRS: ' xsi:type="cbc:IDType"' }), 'xsi:type = declared type');
  add('xsi-type-base', false, ubl({ ID_ATTRS: ' xsi:type="udt:IdentifierType" xmlns:udt="urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2"' }), 'xsi:type = base type of the declared type (not derived from it)');
  add('xsi-type-unrelated', false, ubl({ ID_ATTRS: ' xsi:type="cac:PartyType"' }), 'xsi:type = unrelated complex type');
  add('xsi-type-builtin', false, ubl({ ID_ATTRS: ' xsi:type="xsd:string" xmlns:xsd="http://www.w3.org/2001/XMLSchema"' }), 'xsi:type = xsd:string on cbc:ID');
  add('xsi-type-unknown', false, ubl({ ID_ATTRS: ' xsi:type="cbc:NoSuchType"' }), 'xsi:type = unknown type');
  add('xsi-type-undeclared-prefix', false, ubl({ ID_ATTRS: ' xsi:type="zz:IDType"' }), 'xsi:type with undeclared prefix');
  add('xsi-type-derived-ok', true, ubl({ ID_ATTRS: ' xsi:type="cbc:IDType"' }), 'xsi:type = same type again');
  add('xsi-type-on-root-same', true, ubl({ ROOT_ATTRS: ' xsi:type="InvoiceType"' }), 'xsi:type on the root (default namespace)');
  add('xsi-type-on-root-other', false, ubl({ ROOT_ATTRS: ' xsi:type="cac:PartyType"' }), 'xsi:type on the root = PartyType');
  add('xsi-type-lax-unknown', false, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:type="cac:PartyType"><cbc:Foo/></zz:X></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'unknown lax element with xsi:type=cac:PartyType and invalid content (assessed through xsi:type)');
  add('xsi-type-lax-unknown-ok', true, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:type="cac:PartyType"><cbc:EndpointID>1</cbc:EndpointID></zz:X></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'unknown lax element with xsi:type=cac:PartyType and valid content');
  add('xsi-type-abstract', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:AllDataObjectsTimeStamp>', '<xades:AllDataObjectsTimeStamp xsi:type="xades:GenericTimeStampType">') }), 'xsi:type = abstract type');
  add('xsi-type-restriction-sibling', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:AllDataObjectsTimeStamp>', '<xades:AllDataObjectsTimeStamp xsi:type="xades:OtherTimeStampType">') }), 'xsi:type = sibling restriction (not derived from the declared type)');
  add('xsi-schemaLocation', true, ubl({ ROOT_ATTRS: ' xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 http://example.com/UBL-Invoice-2.1.xsd"' }), 'xsi:schemaLocation on the root (hint ignored)');
  add('xsi-schemaLocation-odd', true, ubl({ ROOT_ATTRS: ' xsi:schemaLocation="only-one-item"' }), 'xsi:schemaLocation with a single item');
  add('xsi-schemaLocation-bad-uri', false, ubl({ ROOT_ATTRS: ' xsi:schemaLocation="urn:x %zz"' }), 'xsi:schemaLocation with an invalid URI');
  add('xsi-noNamespaceSchemaLocation', true, ubl({ ROOT_ATTRS: ' xsi:noNamespaceSchemaLocation="x.xsd"' }), 'xsi:noNamespaceSchemaLocation');
  add('xsi-other-attr', false, ubl({ ROOT_ATTRS: ' xsi:foo="1"' }), 'xsi:foo (not one of the four xsi attributes)');
  // --- attributes
  add('attr-unknown', false, ubl({ ID_ATTRS: ' foo="1"' }), 'unknown attribute on cbc:ID');
  add('attr-xml-lang', false, ubl({ NOTE: '  <cbc:Note xml:lang="de">x</cbc:Note>\n' }), 'xml:lang on cbc:Note (not declared, no wildcard)');
  add('attr-prefixed-cbc', false, ubl({ ID_ATTRS: ' cbc:schemeID="1"' }), 'cbc:schemeID (namespaced attribute, declaration is unqualified)');
  add('attr-ws-value', true, ubl({ AMOUNT_ATTRS: ' currencyID=" EUR "' }), 'currencyID " EUR " (normalizedString)');
  add('attr-missing-currency', false, ubl({ AMOUNT_ATTRS: '' }), 'missing required currencyID');
  add('attr-empty-currency', true, ubl({ AMOUNT_ATTRS: ' currencyID=""' }), 'currencyID="" (normalizedString accepts empty)');
  add('attr-dup-ns-decl', true, ubl({ ID_ATTRS: ' xmlns:zz="urn:zz"' }), 'unused namespace declaration on cbc:ID');
  add('attr-all-identifier', true, ubl({ ID_ATTRS: ' schemeID="a" schemeName="b" schemeAgencyID="c" schemeAgencyName="d" schemeVersionID="e" schemeDataURI="f" schemeURI="g"' }), 'all IdentifierType attributes');
  add('attr-on-elementonly', false, ubl({ ASP_ATTRS: ' foo="1"' }), 'attribute on cac:AccountingSupplierParty');
  add('attr-xsi-type-prefix-redeclared', true, ubl({ ID_ATTRS: ' xmlns:zz="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xsi:type="zz:IDType"' }), 'xsi:type via a locally declared prefix');
  // --- content
  add('content-empty-root', false, '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>', 'empty root');
  add('content-ws-in-elementonly', true, ubl({ ASP_CONTENT: '\n   \t\n' }), 'whitespace inside element-only content');
  add('content-comment-in-elementonly', true, ubl({ ASP_CONTENT: '<!-- c -->' }), 'comment inside element-only content');
  add('content-pi-in-elementonly', true, ubl({ ASP_CONTENT: '<?pi x?>' }), 'PI inside element-only content');
  add('content-cdata-ws-in-elementonly', true, ubl({ ASP_CONTENT: '<![CDATA[  ]]>' }), 'whitespace CDATA inside element-only content');
  add('content-cdata-text-in-elementonly', false, ubl({ ASP_CONTENT: '<![CDATA[x]]>' }), 'CDATA text inside element-only content');
  add('content-nbsp-in-elementonly', false, ubl({ ASP_CONTENT: '\u00a0' }), 'NBSP inside element-only content');
  add('content-text-in-elementonly', false, ubl({ ASP_CONTENT: 'text' }), 'text inside element-only content');
  add('content-entity-ws', true, ubl({ ASP_CONTENT: '&#x20;&#xA;' }), 'character references to whitespace');
  add('content-entity-text', false, ubl({ ASP_CONTENT: '&#x41;' }), 'character reference to a letter');
  add('content-mixed-text', true, ublSig({ KEYINFO_TEXT: 'some text' }), 'text inside mixed content (ds:KeyInfo)');
  add('content-mixed-foreign', true, ublSig({ KEYINFO_EXTRA: '<zz:X xmlns:zz="urn:zz"/>' }), 'foreign element inside KeyInfo (##other lax)');
  add('content-mixed-ds-unknown', false, ublSig({ KEYINFO_EXTRA: '<ds:NoSuch xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>' }), 'ds:NoSuch inside KeyInfo (##other excludes ds)');
  add('content-empty-type-ws', false, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_CONTENT: '  \n ' }) }), 'whitespace inside an empty-content element (xades:Include)');
  add('content-empty-type-text', false, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_CONTENT: 'x' }) }), 'text inside an empty-content element');
  add('content-empty-type-comment', true, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_CONTENT: '<!--c-->' }) }), 'comment inside an empty-content element');
  add('content-empty-type-element', false, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_CONTENT: '<xades:Foo/>' }) }), 'element inside an empty-content element');
  add('content-empty-type-attr', false, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_ATTRS: ' foo="1"' }) }), 'unknown attribute on xades:Include');
  add('content-empty-type-optional-attr', true, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_ATTRS: ' referencedData="true"' }) }), 'optional boolean attribute');
  add('content-empty-type-bad-bool', false, ublSig({ OBJECT_CONTENT: xades({ INCLUDE_ATTRS: ' referencedData="yes"' }) }), 'invalid boolean attribute');
  // --- wildcards
  add('wild-strict-unknown', false, ublSig({ CANON_CONTENT: '<zz:X xmlns:zz="urn:zz"/>' }), 'CanonicalizationMethod: any ##any (strict, default) with unknown element');
  add('wild-strict-known', true, ublSig({ CANON_CONTENT: '<cbc:ID>1</cbc:ID>' }), 'CanonicalizationMethod: strict wildcard with a known global element');
  add('wild-strict-known-invalid', false, ublSig({ CANON_CONTENT: '<cbc:ID foo="1">1</cbc:ID>' }), 'strict wildcard with a known element that is invalid');
  add('wild-strict-known-local-only', false, ublSig({ CANON_CONTENT: '<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">x</ds:X509IssuerName>' }), 'strict wildcard with an element that is only declared locally (no global declaration)');
  add('wild-strict-text', true, ublSig({ CANON_CONTENT: 'mixed text' }), 'CanonicalizationMethod is mixed: text allowed');
  add('wild-lax-unknown', true, ublSig({ DIGEST_CONTENT: '<zz:X xmlns:zz="urn:zz"><zz:Y bad="1">t</zz:Y></zz:X>' }), 'DigestMethod: ##other lax with unknown element (not assessed)');
  add('wild-lax-ds', false, ublSig({ DIGEST_CONTENT: '<ds:Object xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>' }), 'DigestMethod: ##other excludes ds namespace');
  add('wild-lax-nsless', false, ublSig({ DIGEST_CONTENT: '<X xmlns=""/>' }), 'DigestMethod: ##other excludes absent namespace');
  add('wild-lax-default-ns', true, ublSig({ DIGEST_CONTENT: '<X/>' }), 'DigestMethod: <X/> inherits the Invoice default namespace -> other namespace, no declaration, lax -> not assessed');
  add('wild-lax-known-invalid', false, ublSig({ DIGEST_CONTENT: '<cbc:IssueDate>x</cbc:IssueDate>' }), 'lax wildcard with known element and invalid value');
  add('wild-lax-known-valid', true, ublSig({ DIGEST_CONTENT: '<cbc:IssueDate>2024-01-01</cbc:IssueDate>' }), 'lax wildcard with known element and valid value');
  add('wild-object-nested-invoice-valid', true, ublSig({ OBJECT_CONTENT: ubl({}).replace(/^<\?xml[^>]*>\s*/, '') }), 'ds:Object (##any lax) containing a valid nested Invoice');
  add('wild-object-nested-invoice-invalid', false, ublSig({ OBJECT_CONTENT: ubl({ ISSUE_DATE: 'x' }).replace(/^<\?xml[^>]*>\s*/, '') }), 'ds:Object containing an invalid nested Invoice');
  add('wild-xades-unsigned-strict', false, ublSig({ OBJECT_CONTENT: xades({ UNSIGNED: '' }).replace('</xades:SignedProperties></xades:QualifyingProperties>', '</xades:SignedProperties><xades:UnsignedProperties><xades:UnsignedSignatureProperties><zz:X xmlns:zz="urn:zz"/></xades:UnsignedSignatureProperties></xades:UnsignedProperties></xades:QualifyingProperties>') }), 'UnsignedSignatureProperties: any ##other strict with unknown element');
  add('wild-xades-unsigned-strict-known', true, ublSig({ OBJECT_CONTENT: xades().replace('</xades:SignedProperties></xades:QualifyingProperties>', '</xades:SignedProperties><xades:UnsignedProperties><xades:UnsignedSignatureProperties><cbc:ID>1</cbc:ID></xades:UnsignedSignatureProperties></xades:UnsignedProperties></xades:QualifyingProperties>') }), 'UnsignedSignatureProperties strict with known element');
const cti = (idAttrs, rest) => '<xades:CommitmentTypeIndication><xades:CommitmentTypeId><xades:Identifier' + (idAttrs || '') + '>urn:x</xades:Identifier></xades:CommitmentTypeId>' + rest + '</xades:CommitmentTypeIndication>';
  add('wild-anyattr-strict', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects/><xades:CommitmentTypeQualifiers><xades:CommitmentTypeQualifier foo="1">x</xades:CommitmentTypeQualifier></xades:CommitmentTypeQualifiers>')) }), 'xades:AnyType anyAttribute ##any (strict) with an undeclared attribute');
  add('wild-anyattr-strict-xmllang', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects/><xades:CommitmentTypeQualifiers><xades:CommitmentTypeQualifier xml:lang="de">x</xades:CommitmentTypeQualifier></xades:CommitmentTypeQualifiers>')) }), 'xades:AnyType anyAttribute strict with xml:lang');
  add('wild-anytype-ok', true, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects/><xades:CommitmentTypeQualifiers><xades:CommitmentTypeQualifier>x<zz:A xmlns:zz="urn:zz"/>y</xades:CommitmentTypeQualifier></xades:CommitmentTypeQualifiers>')) }), 'xades:AnyType with mixed content and foreign element');
  add('wild-xsanytype-element', true, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects foo="1">text<zz:A xmlns:zz="urn:zz"/></xades:AllSignedDataObjects>')) }), 'element declared without type (xs:anyType): any attributes and content');
  add('wild-xsanytype-known-invalid', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects><cbc:IssueDate>x</cbc:IssueDate></xades:AllSignedDataObjects>')) }), 'xs:anyType element containing a known element with an invalid value (anyType content is lax)');
  add('enum-ok-1', true, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti(' Qualifier="OIDAsURI"', '<xades:AllSignedDataObjects/>')) }), 'enumeration: Qualifier="OIDAsURI"');
  add('enum-ok-2', true, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti(' Qualifier="OIDAsURN"', '<xades:AllSignedDataObjects/>')) }), 'enumeration: Qualifier="OIDAsURN"');
  add('enum-ws', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti(' Qualifier="  OIDAsURN  "', '<xades:AllSignedDataObjects/>')) }), 'enumeration with surrounding whitespace (xs:string restriction, whiteSpace preserve: compared literally)');
  add('enum-wrong', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti(' Qualifier="OIDAsUrn"', '<xades:AllSignedDataObjects/>')) }), 'enumeration: wrong case');
  add('enum-empty', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti(' Qualifier=""', '<xades:AllSignedDataObjects/>')) }), 'enumeration: empty');
  add('anyURI-element-bad', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:ObjectReference>%zz</xades:ObjectReference>')) }), 'xs:anyURI element with invalid value');
  add('anyURI-element-ok', true, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:ObjectReference>#a</xades:ObjectReference><xades:ObjectReference> #b </xades:ObjectReference>')) }), 'xs:anyURI elements (repeated choice branch)');
  add('choice-both-branches', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:ObjectReference>#a</xades:ObjectReference><xades:AllSignedDataObjects/>')) }), 'both branches of a choice');
  add('choice-none', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '')) }), 'no branch of a required choice');
  // --- structure
  add('struct-dup-id', false, ubl({ COPY_INDICATOR: '  <cbc:ID>2</cbc:ID>\n' }), 'duplicate cbc:ID (maxOccurs 1)');
  add('struct-order', false, ubl({ COPY_INDICATOR: '  <cbc:IssueDate>2024-01-01</cbc:IssueDate>\n', ISSUE_DATE: '' }).replace('<cbc:IssueDate></cbc:IssueDate>', '<cbc:UUID>u</cbc:UUID>'), 'IssueDate before UUID (wrong order)');
  add('struct-missing-required', false, ubl({}).replace(/<cac:LegalMonetaryTotal>.*<\/cac:LegalMonetaryTotal>/s, ''), 'missing LegalMonetaryTotal');
  add('struct-missing-line', false, ubl({}).replace(/<cac:InvoiceLine>.*<\/cac:InvoiceLine>/s, ''), 'missing InvoiceLine (minOccurs 1)');
  add('struct-two-lines', true, ubl({}).replace('</cac:InvoiceLine>', '</cac:InvoiceLine><cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:LineExtensionAmount currencyID="EUR">1</cbc:LineExtensionAmount><cac:Item/></cac:InvoiceLine>'), 'two InvoiceLines');
  add('struct-root-wrong-local', false, ubl({}).replace(/Invoice xmlns=/, 'Invoic xmlns=').replace('</Invoice>', '</Invoic>'), 'root local name Invoic');
  add('struct-root-creditnote-ns-invoice-el', false, ubl({}).replace('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'), 'Invoice element in the CreditNote namespace');
  add('struct-quantity-ok', true, ubl({ QUANTITY: '<cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>' }), 'InvoicedQuantity with unitCode');
  add('struct-quantity-no-unit', true, ubl({ QUANTITY: '<cbc:InvoicedQuantity>1</cbc:InvoicedQuantity>' }), 'InvoicedQuantity without unitCode (optional in UBL 2.1)');
  add('struct-quantity-bad', false, ubl({ QUANTITY: '<cbc:InvoicedQuantity>1 Stk</cbc:InvoicedQuantity>' }), 'InvoicedQuantity "1 Stk"');
  add('struct-sig-no-reference', false, ublSig({}).replace(/<ds:Reference URI="">.*?<\/ds:Reference>/s, ''), 'SignedInfo without Reference (minOccurs 1 unbounded)');
  add('struct-sig-two-refs', true, ublSig({}).replace('</ds:Reference>', '</ds:Reference><ds:Reference><ds:DigestMethod Algorithm="x"/><ds:DigestValue></ds:DigestValue></ds:Reference>'), 'two References, empty DigestValue (base64 empty ok), Algorithm "x" (anyURI relative)');
  add('struct-sig-missing-algorithm', false, ublSig({}).replace('<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>', '<ds:SignatureMethod/>'), 'SignatureMethod without required Algorithm');
  add('struct-sig-hmac', false, ublSig({}).replace('<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>', '<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#hmac-sha1"><ds:HMACOutputLength>128</ds:HMACOutputLength>t<zz:X xmlns:zz="urn:zz"/></ds:SignatureMethod>'), 'SignatureMethod with HMACOutputLength, text and ##other (strict, no processContents) foreign element');
  add('struct-sig-hmac-ok', true, ublSig({}).replace('<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>', '<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#hmac-sha1"><ds:HMACOutputLength>128</ds:HMACOutputLength>t</ds:SignatureMethod>'), 'SignatureMethod with HMACOutputLength and text');
  add('struct-sig-hmac-bad', false, ublSig({}).replace('<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>', '<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#hmac-sha1"><ds:HMACOutputLength>12.8</ds:HMACOutputLength></ds:SignatureMethod>'), 'HMACOutputLength 12.8 (integer)');
  add('struct-x509-choice-repeat', true, ublSig({}).replace('</ds:X509IssuerSerial>', '</ds:X509IssuerSerial><ds:X509SKI>QUJD</ds:X509SKI><ds:X509Certificate>QUJD</ds:X509Certificate><zz:X xmlns:zz="urn:zz"/>'), 'X509Data: repeated choice incl. ##other lax');
  add('struct-pgp-choice-a', true, ublSig({ KEYINFO_EXTRA: '<ds:PGPData><ds:PGPKeyID>QUJD</ds:PGPKeyID><ds:PGPKeyPacket>QUJD</ds:PGPKeyPacket><zz:X xmlns:zz="urn:zz"/></ds:PGPData>' }), 'PGPData first branch');
  add('struct-pgp-choice-b', true, ublSig({ KEYINFO_EXTRA: '<ds:PGPData><ds:PGPKeyPacket>QUJD</ds:PGPKeyPacket></ds:PGPData>' }), 'PGPData second branch');
  add('struct-pgp-choice-bad', false, ublSig({ KEYINFO_EXTRA: '<ds:PGPData><ds:PGPKeyPacket>QUJD</ds:PGPKeyPacket><ds:PGPKeyID>QUJD</ds:PGPKeyID></ds:PGPData>' }), 'PGPData: KeyID after KeyPacket');
  add('struct-dsa', true, ublSig({ KEYINFO_EXTRA: '<ds:KeyValue><ds:DSAKeyValue><ds:P>QUJD</ds:P><ds:Q>QUJD</ds:Q><ds:G>QUJD</ds:G><ds:Y>QUJD</ds:Y><ds:Seed>QUJD</ds:Seed><ds:PgenCounter>QUJD</ds:PgenCounter></ds:DSAKeyValue></ds:KeyValue>' }), 'DSAKeyValue with nested optional sequences');
  add('struct-dsa-partial', false, ublSig({ KEYINFO_EXTRA: '<ds:KeyValue><ds:DSAKeyValue><ds:P>QUJD</ds:P><ds:Y>QUJD</ds:Y></ds:DSAKeyValue></ds:KeyValue>' }), 'DSAKeyValue: P without Q');
  add('struct-dsa-min', true, ublSig({ KEYINFO_EXTRA: '<ds:KeyValue><ds:DSAKeyValue><ds:Y>QUJD</ds:Y></ds:DSAKeyValue></ds:KeyValue>' }), 'DSAKeyValue minimal');
  add('struct-simpletype-attr', false, ublSig({}).replace('<ds:X509IssuerName>', '<ds:X509IssuerName foo="1">'), 'attribute on a simple-type element (xs:string)');
  add('struct-simpletype-child', false, ublSig({}).replace('<ds:X509IssuerName>CN=x', '<ds:X509IssuerName><zz:X xmlns:zz="urn:zz"/>CN=x'), 'child element inside a simple-type element');
  add('struct-simpletype-xsi', true, ublSig({}).replace('<ds:X509IssuerName>', '<ds:X509IssuerName xsi:type="xsd:string" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'), 'xsi:type=xsd:string on an xs:string element');
  add('struct-simpletype-xsi-token', true, ublSig({}).replace('<ds:X509IssuerName>', '<ds:X509IssuerName xsi:type="xsd:token" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'), 'xsi:type=xsd:token on an xs:string element (derived)');
  add('struct-simpletype-xsi-int', false, ublSig({}).replace('<ds:X509IssuerName>', '<ds:X509IssuerName xsi:type="xsd:int" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'), 'xsi:type=xsd:int on an xs:string element');
  // --- root without declaration but with xsi:type (Xerces assesses against the xsi:type type)
  add('root-unknown-xsitype-valid', true, ubl({}).replace('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"', '<Foo xmlns="urn:example:zz" xmlns:inv="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xsi:type="inv:InvoiceType"').replace('</Invoice>', '</Foo>'), 'unknown root element with xsi:type=InvoiceType and valid content');
  add('root-unknown-xsitype-invalid', false, ubl({ ISSUE_DATE: 'x' }).replace('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"', '<Foo xmlns="urn:example:zz" xmlns:inv="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xsi:type="inv:InvoiceType"').replace('</Invoice>', '</Foo>'), 'unknown root element with xsi:type=InvoiceType and invalid content');
  add('root-unknown-xsitype-unknown', false, ubl({}).replace('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"', '<Foo xmlns="urn:example:zz" xsi:type="zz:NoType" xmlns:zz="urn:example:zz"').replace('</Invoice>', '</Foo>'), 'unknown root element with unknown xsi:type');
  add('lax-unknown-xsitype-unknown', false, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:type="zz:NoType"/></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'lax unknown element with an unknown xsi:type');
  add('lax-unknown-xsitype-builtin', true, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:type="xsd:decimal" xmlns:xsd="http://www.w3.org/2001/XMLSchema">1.5</zz:X></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'lax unknown element with xsi:type=xsd:decimal and a valid value');
  add('lax-unknown-xsitype-builtin-bad', false, ubl({ EXTENSIONS: '  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><zz:X xmlns:zz="urn:zz" xsi:type="xsd:decimal" xmlns:xsd="http://www.w3.org/2001/XMLSchema">abc</zz:X></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>\n' }), 'lax unknown element with xsi:type=xsd:decimal and an invalid value');
  add('attr-xml-space', false, ubl({ NOTE: '  <cbc:Note xml:space="preserve">x</cbc:Note>\n' }), 'xml:space on cbc:Note');
  add('child-in-xsi-ns', false, ubl({ ASP_CONTENT: '<xsi:foo/>' }), 'child element in the xsi namespace');
  add('xsi-nil-on-anytype-element', false, ublSig({ OBJECT_CONTENT: xades().replace('<xades:SignedDataObjectProperties>', '<xades:SignedDataObjectProperties>' + cti('', '<xades:AllSignedDataObjects xsi:nil="true"/>')) }), 'xsi:nil on an (xs:anyType) element declared without nillable');
  add('cii-datetime-empty', false, cii({ ISSUE_DT: '<udt:DateTime></udt:DateTime>' }), 'empty xs:dateTime');
  add('cii-datetime-ws', false, cii({ ISSUE_DT: '<udt:DateTime>  </udt:DateTime>' }), 'whitespace-only xs:dateTime');
  add('cii-id-attrs', true, cii({ TYPECODE: '<ram:Name languageID="de" languageLocaleID="DE">n</ram:Name>' }), 'TextType attributes');
  add('cii-id-attr-bad-uri', false, cii({}).replace('<ram:ID>1</ram:ID>', '<ram:ID schemeURI="a[b]">1</ram:ID>'), 'IDType schemeURI invalid');
  // --- CII specifics
  add('cii-fixed-ok', true, cii({ TYPECODE: '<ram:TypeCode listID="1001" listAgencyID="6">380</ram:TypeCode>' }), 'fixed attributes with the fixed values');
  add('cii-fixed-ws', true, cii({ TYPECODE: '<ram:TypeCode listID=" 1001 ">380</ram:TypeCode>' }), 'fixed token attribute with surrounding whitespace');
  add('cii-fixed-wrong', false, cii({ TYPECODE: '<ram:TypeCode listID="1002">380</ram:TypeCode>' }), 'fixed attribute with another value');
  add('cii-fixed-wrong-agency', false, cii({ TYPECODE: '<ram:TypeCode listAgencyID="5">380</ram:TypeCode>' }), 'fixed listAgencyID with another value');
  add('cii-typecode-empty', true, cii({ TYPECODE: '<ram:TypeCode></ram:TypeCode>' }), 'empty TypeCode (token)');
  add('cii-typecode-ws', true, cii({ TYPECODE: '<ram:TypeCode> 380 </ram:TypeCode>' }), 'TypeCode with whitespace');
  add('cii-datetime-both', false, cii({ ISSUE_DT: '<udt:DateTimeString format="102">20240131</udt:DateTimeString><udt:DateTime>2024-01-31T00:00:00</udt:DateTime>' }), 'both choice branches');
  add('cii-datetime-none', false, cii({ ISSUE_DT: '' }), 'empty choice (minOccurs 1)');
  add('cii-datetime-string-any', true, cii({ ISSUE_DT: '<udt:DateTimeString format="102">not a date</udt:DateTimeString>' }), 'DateTimeString is xs:string');
  add('cii-datetime-string-noformat', true, cii({ ISSUE_DT: '<udt:DateTimeString>20240131</udt:DateTimeString>' }), 'DateTimeString without format (optional)');
  add('cii-datetime-string-attr', false, cii({ ISSUE_DT: '<udt:DateTimeString format="102" foo="1">20240131</udt:DateTimeString>' }), 'DateTimeString with unknown attribute');
  add('cii-amount-no-currency', true, cii({ SETTLEMENT: '<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:GrandTotalAmount>1</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>' }), 'CII amount without currencyID (optional)');
  add('cii-amount-bad', false, cii({ SETTLEMENT: '<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:GrandTotalAmount>1,00</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>' }), 'CII amount "1,00"');
  add('cii-amount-curr-ws', true, cii({ SETTLEMENT: '<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:GrandTotalAmount currencyID=" EUR ">1</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>' }), 'currencyID " EUR " (token)');
  add('cii-indicator-ok', true, cii({ AFTER_ISSUE: '<ram:CopyIndicator><udt:Indicator>true</udt:Indicator></ram:CopyIndicator>' }), 'udt:Indicator true');
  add('cii-indicator-bad', false, cii({ AFTER_ISSUE: '<ram:CopyIndicator><udt:Indicator>ja</udt:Indicator></ram:CopyIndicator>' }), 'udt:Indicator "ja"');
  add('cii-indicator-string', true, cii({ AFTER_ISSUE: '<ram:CopyIndicator><udt:IndicatorString format="x">ja</udt:IndicatorString></ram:CopyIndicator>' }), 'udt:IndicatorString (xs:string)');
  add('cii-foreign-element', false, cii({ TYPECODE: '<zz:X xmlns:zz="urn:zz"/>' }), 'foreign element inside ExchangedDocument (no wildcard in CII)');
  add('cii-root-wrong', false, cii({}).replace('urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100', 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:101'), 'wrong root namespace');
  add('cii-text-in-elementonly', false, cii({ SETTLEMENT: 'text' }), 'text in element-only content');
  add('cii-xsi-type-same', true, cii({ TYPECODE: '<ram:TypeCode xsi:type="qdt:DocumentCodeType">380</ram:TypeCode>' }), 'xsi:type = declared type (qdt)');
  add('cii-xsi-type-udt', false, cii({ TYPECODE: '<ram:TypeCode xsi:type="udt:CodeType">380</ram:TypeCode>' }), 'xsi:type = udt:CodeType (not derived from qdt:DocumentCodeType)');
  return P;
}

// ---------------------------------------------------------------------------------------------
function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  // (A) base documents: originals (no KoSIT mutation) from the corpora, round-robin, only schema-valid ones
  const pools = [];
  const corpus = path.join(root, 'build', 'corpus');
  const listXml = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort().map((f) => path.join(dir, f)) : []);
  pools.push(listXml(path.join(corpus, 'xr-ubl')).filter((f) => !/__m\d+/.test(f)));
  pools.push(listXml(path.join(corpus, 'xr-cii')).filter((f) => !/__m\d+/.test(f)));
  pools.push(listXml(path.join(corpus, 'extra-ubl')));
  pools.push(listXml(path.join(corpus, 'extra-cii')));
  const zf = [];
  if (fs.existsSync(ZUGFERD)) (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.xml$/i.test(e.name)) zf.push(p); } })(ZUGFERD);
  // paths compared with '/' as separator: the same base documents on every platform
  const posix = (p) => p.split(path.sep).join('/');
  pools.push(zf.sort((a, b) => (posix(a) < posix(b) ? -1 : posix(a) > posix(b) ? 1 : 0)));
  const bases = [];
  const idx = pools.map(() => 0);
  let guard = 0;
  while (bases.length < BASES && guard++ < 100000) {
    let progressed = false;
    for (let p = 0; p < pools.length && bases.length < BASES; p++) {
      while (idx[p] < pools[p].length) {
        const f = pools[p][idx[p]++];
        progressed = true;
        if (fs.statSync(f).size > MAX_BASE_BYTES) continue;     // the 25/61 MB PEPPOL samples: x25 mutations each would dominate the run
        let doc;
        try { doc = slimdom.parseXmlDocument(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
        const ns = doc.documentElement.namespaceURI;
        if (ns !== NS_INV && ns !== NS_CN && ns !== NS_CII) continue;
        if (!modelFor(ns).validator.validate(doc).valid) continue;
        bases.push(f);
        break;
      }
    }
    if (!progressed) break;
  }
  let nFiles = 0;
  const kinds = {};
  for (const f of bases) {
    const text = fs.readFileSync(f, 'utf8');
    const baseName = path.basename(f, '.xml');
    const rnd = mulberry32(hash(baseName));
    let results;
    try { results = mutate(text, baseName, rnd); } catch (e) { console.error('mutation failed for ' + f + ': ' + e.message); continue; }
    results.forEach((r, i) => {
      const name = baseName + '__x' + String(i).padStart(2, '0') + '_' + r.kind + '.xml';
      fs.writeFileSync(path.join(OUT, name), r.xml);
      manifest.push({ file: name, base: path.relative(root, f).split(path.sep).join('/'), kind: r.kind, note: r.note });
      kinds[r.kind] = (kinds[r.kind] || 0) + 1;
      nFiles++;
    });
  }
  // (B) probes
  const P = probes();
  for (const p of P) {
    const name = 'probe__' + p.id + '.xml';
    fs.writeFileSync(path.join(OUT, name), p.xml);
    manifest.push({ file: name, kind: 'probe', expect: p.expect, note: p.note });
    kinds.probe = (kinds.probe || 0) + 1;
    nFiles++;
  }
  fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify({ generated: new Date().toISOString(), bases: bases.map((f) => path.relative(root, f).split(path.sep).join('/')), kinds, entries: manifest }, null, 1));
  console.log('build-xsd-mutations: ' + bases.length + ' base documents -> ' + nFiles + ' files in ' + path.relative(root, OUT));
  console.log('  kinds: ' + Object.entries(kinds).map(([k, v]) => k + ' ' + v).join(', '));
}

if (require.main === module) main();
