#!/usr/bin/env node
/*
 * compile-xsd.cjs — compiles a W3C XML Schema 1.0 root document (following xs:import and
 * xs:include) into one self-contained, compact JSON model that src/xsd-validator.js executes
 * at runtime (browser or Node, no dependencies).
 *
 * Usage: node tools/compile-xsd.cjs <root.xsd> [<root2.xsd> ...] <out.json>
 *
 * Several root documents may be given (e.g. UBL Invoice + CreditNote): the resulting model
 * contains the union of their schema components, exactly like one Xerces Schema built from
 * several sources.
 *
 * What is recorded:
 *   - every global element / attribute declaration and every named type of all loaded
 *     schema documents (a lax/strict wildcard or xsi:type may refer to any of them, so nothing
 *     is pruned — the model knows exactly what Xerces knows);
 *   - complex types with their own attribute declarations, their own content particle, the
 *     derivation (base + method); the effective attribute set / content model of derived types
 *     is composed by the runtime (keeps the JSON small: UBL has ~1 200 trivially derived types);
 *   - simple types as restriction chains down to the XSD built-in types (facets: enumeration,
 *     pattern, length, minLength, maxLength, totalDigits, fractionDigits, min/max(In|Ex)clusive,
 *     whiteSpace; varieties list and union);
 *   - particles: element (local or reference), model groups sequence/choice (xs:all is rejected),
 *     wildcards with their namespace constraint and processContents;
 *   - substitution groups (members per head), nillable/abstract/fixed/default flags;
 *   - the SHA-256 of every schema document that was read ("sources").
 *
 * Annotations/documentation are dropped. Constructs that are not needed by the invoice schemas
 * and not implemented are rejected loudly (xs:all, xs:redefine, xs:notation, identity
 * constraints xs:key/xs:unique/xs:keyref) instead of being silently ignored.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));

const XS = 'http://www.w3.org/2001/XMLSchema';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

// ---------------------------------------------------------------------------------------------
// XSD built-in datatypes (XML Schema Part 2). Every entry: base type and the facets the built-in
// adds on top of its base. The runtime (src/xsd-validator.js) owns the semantics; here the table
// is only needed to recognise built-in names and to validate facet applicability.
// ---------------------------------------------------------------------------------------------
const BUILTIN = {
  anySimpleType: null,
  string: 'anySimpleType', boolean: 'anySimpleType', decimal: 'anySimpleType', float: 'anySimpleType',
  double: 'anySimpleType', duration: 'anySimpleType', dateTime: 'anySimpleType', time: 'anySimpleType',
  date: 'anySimpleType', gYearMonth: 'anySimpleType', gYear: 'anySimpleType', gMonthDay: 'anySimpleType',
  gDay: 'anySimpleType', gMonth: 'anySimpleType', hexBinary: 'anySimpleType', base64Binary: 'anySimpleType',
  anyURI: 'anySimpleType', QName: 'anySimpleType', NOTATION: 'anySimpleType',
  normalizedString: 'string', token: 'normalizedString', language: 'token', NMTOKEN: 'token',
  NMTOKENS: 'NMTOKEN', Name: 'token', NCName: 'Name', ID: 'NCName', IDREF: 'NCName', IDREFS: 'IDREF',
  ENTITY: 'NCName', ENTITIES: 'ENTITY',
  integer: 'decimal', nonPositiveInteger: 'integer', negativeInteger: 'nonPositiveInteger',
  long: 'integer', int: 'long', short: 'int', byte: 'short', nonNegativeInteger: 'integer',
  unsignedLong: 'nonNegativeInteger', unsignedInt: 'unsignedLong', unsignedShort: 'unsignedInt',
  unsignedByte: 'unsignedShort', positiveInteger: 'nonNegativeInteger',
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function fail(msg, node) {
  let where = '';
  if (node && node.ownerDocument && node.ownerDocument.__file) where = ' [' + node.ownerDocument.__file + ']';
  throw new Error('compile-xsd: ' + msg + where);
}

function isXs(node, local) {
  return node && node.nodeType === 1 && node.namespaceURI === XS && (local === undefined || node.localName === local);
}

function children(el) {
  const out = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    if (!isXs(c)) fail('non-XSD element <' + c.nodeName + '> inside <' + el.nodeName + '>', el);
    if (c.localName === 'annotation') continue;
    out.push(c);
  }
  return out;
}

function attr(el, name) { return el.hasAttribute(name) ? el.getAttribute(name) : null; }

function occurs(el) {
  const minA = attr(el, 'minOccurs'), maxA = attr(el, 'maxOccurs');
  const min = minA === null ? 1 : parseInt(minA, 10);
  const max = maxA === null ? 1 : maxA === 'unbounded' ? -1 : parseInt(maxA, 10);
  if (!(min >= 0) || (max !== -1 && !(max >= min))) fail('invalid occurrence range on <' + el.nodeName + '>', el);
  return { min, max };
}

/** Resolves a QName written in the schema document against the in-scope namespaces of `el`. */
function resolveQName(qname, el) {
  const i = qname.indexOf(':');
  const prefix = i < 0 ? null : qname.slice(0, i);
  const local = i < 0 ? qname : qname.slice(i + 1);
  let ns;
  if (prefix === 'xml') ns = XML_NS;
  else {
    ns = el.lookupNamespaceURI(prefix);
    if (ns === null && prefix !== null) fail('undeclared prefix in QName ' + qname, el);
  }
  return { ns: ns || null, local };
}

// ---------------------------------------------------------------------------------------------
// Schema document loading
// ---------------------------------------------------------------------------------------------
class SchemaSet {
  constructor() {
    this.docs = [];            // {file, abs, doc, tns, efd, afd, sha256, bytes}
    this.byPath = new Map();
    this.globals = {           // key "{ns}local" -> {el, doc}
      element: new Map(), attribute: new Map(), type: new Map(), group: new Map(), attributeGroup: new Map(),
    };
    this.sources = [];
  }

  load(file, expectedNs, chameleonNs) {
    const abs = path.resolve(file);
    const key = abs + '|' + (chameleonNs || '');
    if (this.byPath.has(key)) return this.byPath.get(key);
    if (!fs.existsSync(abs)) fail('schema document not found: ' + abs);
    const text = fs.readFileSync(abs);
    const doc = slimdom.parseXmlDocument(text.toString('utf8'));
    doc.__file = abs;
    const root = doc.documentElement;
    if (!isXs(root, 'schema')) fail('not an XML Schema document: ' + abs);
    let tns = attr(root, 'targetNamespace');
    if (tns === null && chameleonNs) tns = chameleonNs;            // chameleon include
    if (expectedNs !== undefined && (tns || null) !== (expectedNs || null)) {
      fail('targetNamespace ' + JSON.stringify(tns) + ' of ' + abs + ' differs from the importing namespace ' + JSON.stringify(expectedNs));
    }
    const entry = {
      file: abs, abs, doc, tns: tns || null,
      efd: attr(root, 'elementFormDefault') === 'qualified',
      afd: attr(root, 'attributeFormDefault') === 'qualified',
      blockDefault: attr(root, 'blockDefault') || '', finalDefault: attr(root, 'finalDefault') || '',
    };
    this.byPath.set(key, entry);
    this.docs.push(entry);
    this.sources.push({ path: abs, sha256: sha256(text), bytes: text.length, targetNamespace: entry.tns });
    for (const c of children(root)) {
      switch (c.localName) {
        case 'import': {
          const ns = attr(c, 'namespace') || null;
          const loc = attr(c, 'schemaLocation');
          if (loc === null) {
            // allowed by XSD: the namespace must then be provided otherwise. Check at the end.
            this.pendingImports = this.pendingImports || [];
            this.pendingImports.push({ ns, from: abs });
            break;
          }
          this.load(path.resolve(path.dirname(abs), loc), ns);
          break;
        }
        case 'include': {
          const loc = attr(c, 'schemaLocation');
          if (loc === null) fail('xs:include without schemaLocation', c);
          const target = path.resolve(path.dirname(abs), loc);
          this.load(target, entry.tns, entry.tns);
          break;
        }
        case 'redefine': fail('xs:redefine is not supported', c); break;
        case 'notation': fail('xs:notation is not supported', c); break;
        case 'element': case 'attribute': case 'complexType': case 'simpleType': case 'group': case 'attributeGroup': {
          const name = attr(c, 'name');
          if (name === null) fail('global <' + c.nodeName + '> without name', c);
          const kind = c.localName === 'complexType' || c.localName === 'simpleType' ? 'type' : c.localName;
          const k = '{' + (entry.tns || '') + '}' + name;
          const map = this.globals[kind];
          if (map.has(k)) {
            const prev = map.get(k);
            if (prev.doc.abs === abs) break;   // same document included twice via different routes
            fail('duplicate global ' + kind + ' ' + k + ' (' + prev.doc.abs + ' and ' + abs + ')', c);
          }
          map.set(k, { el: c, doc: entry });
          break;
        }
        default: fail('unexpected top-level <' + c.nodeName + '>', c);
      }
    }
    return entry;
  }

  checkPendingImports() {
    for (const p of this.pendingImports || []) {
      const have = this.docs.some((d) => (d.tns || null) === p.ns);
      if (!have) fail('xs:import of namespace ' + JSON.stringify(p.ns) + ' in ' + p.from + ' has no schemaLocation and the namespace is not provided by any loaded document');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------------------------
class Compiler {
  constructor(set) {
    this.set = set;
    this.nsTable = [null];                   // index 0 = absent namespace
    this.nsIndex = new Map([[null, 0]]);
    this.types = [];                         // output type entries
    this.typeIndex = new Map();              // "{ns}name" -> index (named types)
    this.anonIndex = new Map();              // structural hash -> index (anonymous types)
    this.elements = {};                      // "nsIdx:local" -> decl
    this.attributes = {};                    // "nsIdx:local" -> decl
    this.resolvingTypes = new Set();
    this.substitution = new Map();           // head key -> Set(member keys)
    this.stats = { complexTypes: 0, simpleTypes: 0, anonymousTypes: 0, elementParticles: 0, wildcards: 0, groups: 0 };
  }

  nsIdx(ns) {
    ns = ns || null;
    if (!this.nsIndex.has(ns)) { this.nsIndex.set(ns, this.nsTable.length); this.nsTable.push(ns); }
    return this.nsIndex.get(ns);
  }
  key(ns, local) { return this.nsIdx(ns) + ':' + local; }

  // ---- types -----------------------------------------------------------------------------
  /** Returns a type reference: number (index into this.types) or 'xs:<builtin>'. */
  typeRef(qname, ctx) {
    const { ns, local } = resolveQName(qname, ctx);
    if (ns === XS) {
      if (local === 'anyType') return 'xs:anyType';
      if (!(local in BUILTIN)) fail('unknown XSD built-in type xs:' + local, ctx);
      return 'xs:' + local;
    }
    const k = '{' + (ns || '') + '}' + local;
    if (this.typeIndex.has(k)) return this.typeIndex.get(k);
    const g = this.set.globals.type.get(k);
    if (!g) fail('cannot resolve type ' + qname + ' (' + k + ')', ctx);
    return this.compileNamedType(k, g.el, g.doc);
  }

  compileNamedType(k, el, doc) {
    if (this.typeIndex.has(k)) return this.typeIndex.get(k);
    if (this.resolvingTypes.has(k)) {
      // forward reference inside a cycle (e.g. a type whose content refers to itself through an
      // element): reserve the slot now, fill it when the outer call completes
      const idx = this.types.length;
      this.types.push(null);
      this.typeIndex.set(k, idx);
      return idx;
    }
    this.resolvingTypes.add(k);
    const entry = el.localName === 'complexType' ? this.compileComplexType(el, doc, k) : this.compileSimpleType(el, doc, k);
    this.resolvingTypes.delete(k);
    let idx;
    if (this.typeIndex.has(k)) { idx = this.typeIndex.get(k); this.types[idx] = entry; }
    else { idx = this.types.length; this.types.push(entry); this.typeIndex.set(k, idx); }
    return idx;
  }

  anonType(el, doc) {
    const entry = el.localName === 'complexType' ? this.compileComplexType(el, doc, null) : this.compileSimpleType(el, doc, null);
    const h = JSON.stringify(entry);
    if (this.anonIndex.has(h)) return this.anonIndex.get(h);
    const idx = this.types.length;
    this.types.push(entry);
    this.anonIndex.set(h, idx);
    this.stats.anonymousTypes++;
    return idx;
  }

  typeName(k) { // "{ns}local" -> "nsIdx:local"
    const m = /^\{(.*)\}(.*)$/.exec(k);
    return this.key(m[1] || null, m[2]);
  }

  compileSimpleType(el, doc, k) {
    this.stats.simpleTypes++;
    const out = { k: 's' };
    if (k) out.n = this.typeName(k);
    const final_ = attr(el, 'final'); if (final_) out.final = final_;
    const kids = children(el);
    if (kids.length !== 1) fail('xs:simpleType must have exactly one of restriction/list/union', el);
    const d = kids[0];
    if (d.localName === 'restriction') {
      const base = attr(d, 'base');
      const dk = children(d);
      let i = 0;
      if (base !== null) out.b = this.typeRef(base, d);
      else {
        if (!dk.length || dk[0].localName !== 'simpleType') fail('xs:restriction needs @base or a nested simpleType', d);
        out.b = this.anonType(dk[0], doc); i = 1;
      }
      const facets = {};
      for (; i < dk.length; i++) {
        const f = dk[i];
        const v = attr(f, 'value');
        if (v === null) fail('facet <' + f.nodeName + '> without value', f);
        switch (f.localName) {
          case 'enumeration': (facets.enumeration = facets.enumeration || []).push(v); break;
          case 'pattern': (facets.pattern = facets.pattern || []).push(v); break;
          case 'length': case 'minLength': case 'maxLength': case 'totalDigits': case 'fractionDigits':
            facets[f.localName] = parseInt(v, 10); break;
          case 'minInclusive': case 'maxInclusive': case 'minExclusive': case 'maxExclusive':
            facets[f.localName] = v; break;
          case 'whiteSpace': facets.whiteSpace = v; break;
          default: fail('unsupported facet <' + f.nodeName + '>', f);
        }
      }
      if (Object.keys(facets).length) out.f = facets;
    } else if (d.localName === 'list') {
      const it = attr(d, 'itemType');
      const dk = children(d);
      out.list = it !== null ? this.typeRef(it, d) : this.anonType(dk[0], doc);
    } else if (d.localName === 'union') {
      const mt = attr(d, 'memberTypes');
      const members = [];
      if (mt) for (const q of mt.trim().split(/\s+/)) members.push(this.typeRef(q, d));
      for (const c of children(d)) members.push(this.anonType(c, doc));
      out.union = members;
    } else fail('unexpected <' + d.nodeName + '> in simpleType', d);
    return out;
  }

  compileComplexType(el, doc, k) {
    this.stats.complexTypes++;
    const out = { k: 'c' };
    if (k) out.n = this.typeName(k);
    if (attr(el, 'abstract') === 'true') out.abs = 1;
    if (attr(el, 'mixed') === 'true') out.mixed = 1;
    const block = attr(el, 'block'); if (block) out.block = block;
    const final_ = attr(el, 'final'); if (final_) out.final = final_;
    const kids = children(el);
    let i = 0;
    if (kids.length && (kids[0].localName === 'simpleContent' || kids[0].localName === 'complexContent')) {
      const cc = kids[0];
      if (kids.length !== 1) fail('complexType with ' + cc.localName + ' must not have other children', el);
      const dk = children(cc);
      if (dk.length !== 1) fail(cc.localName + ' must have exactly one extension/restriction', cc);
      const d = dk[0];
      if (d.localName !== 'extension' && d.localName !== 'restriction') fail('unexpected <' + d.nodeName + '>', d);
      const base = attr(d, 'base');
      if (base === null) fail('<' + d.nodeName + '> without @base', d);
      out.b = this.typeRef(base, d);
      out.der = d.localName === 'extension' ? 'e' : 'r';
      if (cc.localName === 'simpleContent') {
        out.sc = 1;
        if (attr(cc, 'mixed') === 'true') fail('mixed simpleContent', cc);
        const parts = children(d);
        let j = 0;
        if (d.localName === 'restriction') {
          // optional nested simpleType + facets restrict the base's simple type
          let stRef = null;
          if (parts.length && parts[0].localName === 'simpleType') { stRef = this.anonType(parts[0], doc); j = 1; }
          const facets = {};
          for (; j < parts.length; j++) {
            const f = parts[j];
            if (f.localName === 'attribute' || f.localName === 'attributeGroup' || f.localName === 'anyAttribute') break;
            const v = attr(f, 'value');
            switch (f.localName) {
              case 'enumeration': (facets.enumeration = facets.enumeration || []).push(v); break;
              case 'pattern': (facets.pattern = facets.pattern || []).push(v); break;
              case 'length': case 'minLength': case 'maxLength': case 'totalDigits': case 'fractionDigits':
                facets[f.localName] = parseInt(v, 10); break;
              case 'minInclusive': case 'maxInclusive': case 'minExclusive': case 'maxExclusive': facets[f.localName] = v; break;
              case 'whiteSpace': facets.whiteSpace = v; break;
              default: fail('unsupported facet <' + f.nodeName + '> in simpleContent restriction', f);
            }
          }
          if (stRef !== null) out.st = stRef;
          if (Object.keys(facets).length) out.sf = facets;
        }
        this.compileAttributes(parts.slice(j), doc, out);
      } else {
        if (attr(cc, 'mixed') === 'true') out.mixed = 1;
        const parts = children(d);
        let j = 0;
        if (parts.length && /^(sequence|choice|all|group)$/.test(parts[0].localName)) {
          out.p = this.compileGroupParticle(parts[0], doc);
          j = 1;
        }
        this.compileAttributes(parts.slice(j), doc, out);
      }
      return out;
    }
    if (kids.length && /^(sequence|choice|all|group)$/.test(kids[0].localName)) {
      out.p = this.compileGroupParticle(kids[0], doc);
      i = 1;
    }
    this.compileAttributes(kids.slice(i), doc, out);
    return out;
  }

  compileAttributes(nodes, doc, out) {
    const attrs = [];
    let aw = null;
    for (const n of nodes) {
      if (n.localName === 'attribute') attrs.push(this.compileAttributeUse(n, doc));
      else if (n.localName === 'attributeGroup') {
        const ref = attr(n, 'ref');
        if (ref === null) fail('attributeGroup inside a type must have @ref', n);
        const { ns, local } = resolveQName(ref, n);
        const g = this.set.globals.attributeGroup.get('{' + (ns || '') + '}' + local);
        if (!g) fail('cannot resolve attributeGroup ' + ref, n);
        const sub = { };
        this.compileAttributes(children(g.el), g.doc, sub);
        if (sub.a) attrs.push(...sub.a);
        if (sub.aw) aw = sub.aw;      // simplification: last wildcard wins (none in the invoice schemas)
      } else if (n.localName === 'anyAttribute') {
        aw = { ns: this.nsConstraint(n, doc), pc: attr(n, 'processContents') || 'strict' };
      } else if (/^(key|unique|keyref)$/.test(n.localName)) fail('identity constraint <' + n.nodeName + '> is not supported', n);
      else fail('unexpected <' + n.nodeName + '> in attribute list', n);
    }
    if (attrs.length) out.a = attrs;
    if (aw) out.aw = aw;
  }

  compileAttributeUse(n, doc) {
    const ref = attr(n, 'ref');
    const use = attr(n, 'use') || 'optional';
    const out = {};
    if (ref !== null) {
      const { ns, local } = resolveQName(ref, n);
      const k = this.key(ns, local);
      this.ensureGlobalAttribute(ns, local, n);
      out.r = k;
    } else {
      const name = attr(n, 'name');
      if (name === null) fail('attribute without name/ref', n);
      const form = attr(n, 'form');
      const qualified = form ? form === 'qualified' : doc.afd;
      out.n = this.key(qualified ? doc.tns : null, name);
      const t = attr(n, 'type');
      const kids = children(n);
      if (t !== null) out.t = this.typeRef(t, n);
      else if (kids.length && kids[0].localName === 'simpleType') out.t = this.anonType(kids[0], doc);
      else out.t = 'xs:anySimpleType';
    }
    if (use === 'required') out.u = 'r';
    else if (use === 'prohibited') out.u = 'p';
    const fixed = attr(n, 'fixed'); if (fixed !== null) out.fixed = fixed;
    const def = attr(n, 'default'); if (def !== null) out.def = def;
    return out;
  }

  ensureGlobalAttribute(ns, local, ctx) {
    const k = this.key(ns, local);
    if (this.attributes[k]) return;
    const g = this.set.globals.attribute.get('{' + (ns || '') + '}' + local);
    if (!g) fail('cannot resolve global attribute {' + ns + '}' + local, ctx);
    const n = g.el;
    const d = {};
    this.attributes[k] = d;            // register before resolving the type (cycles)
    const t = attr(n, 'type');
    const kids = children(n);
    if (t !== null) d.t = this.typeRef(t, n);
    else if (kids.length && kids[0].localName === 'simpleType') d.t = this.anonType(kids[0], g.doc);
    else d.t = 'xs:anySimpleType';
    const fixed = attr(n, 'fixed'); if (fixed !== null) d.fixed = fixed;
    const def = attr(n, 'default'); if (def !== null) d.def = def;
  }

  nsConstraint(n, doc) {
    const v = attr(n, 'namespace') || '##any';
    if (v === '##any') return { k: 'any' };
    if (v === '##other') return { k: 'other', ns: this.nsIdx(doc.tns) };
    const list = [];
    for (const tok of v.trim().split(/\s+/)) {
      if (tok === '##targetNamespace') list.push(this.nsIdx(doc.tns));
      else if (tok === '##local') list.push(0);
      else list.push(this.nsIdx(tok));
    }
    return { k: 'list', ns: list };
  }

  // ---- particles ---------------------------------------------------------------------------
  /** sequence | choice | all | group(ref) element -> particle array */
  compileGroupParticle(n, doc) {
    const { min, max } = occurs(n);
    if (n.localName === 'group') {
      const ref = attr(n, 'ref');
      if (ref === null) fail('xs:group inside a content model must have @ref', n);
      const { ns, local } = resolveQName(ref, n);
      const g = this.set.globals.group.get('{' + (ns || '') + '}' + local);
      if (!g) fail('cannot resolve group ' + ref, n);
      const inner = children(g.el);
      if (inner.length !== 1) fail('xs:group must contain exactly one model group', g.el);
      const p = this.compileGroupParticle(inner[0], g.doc);
      // the reference carries the occurrence range; the group definition itself has none
      p[1] = min; p[2] = max;
      return p;
    }
    if (n.localName === 'all') fail('xs:all is not supported (not used by the invoice schemas)', n);
    this.stats.groups++;
    const kind = n.localName === 'sequence' ? 's' : 'c';
    const ps = [];
    for (const c of children(n)) {
      switch (c.localName) {
        case 'element': ps.push(this.compileElementParticle(c, doc)); break;
        case 'sequence': case 'choice': case 'group': case 'all': ps.push(this.compileGroupParticle(c, doc)); break;
        case 'any': {
          this.stats.wildcards++;
          const o = occurs(c);
          ps.push(['w', this.nsConstraint(c, doc), attr(c, 'processContents') || 'strict', o.min, o.max]);
          break;
        }
        default: fail('unexpected <' + c.nodeName + '> in model group', c);
      }
    }
    return [kind, min, max, ps];
  }

  compileElementParticle(n, doc) {
    this.stats.elementParticles++;
    const { min, max } = occurs(n);
    const ref = attr(n, 'ref');
    if (ref !== null) {
      const { ns, local } = resolveQName(ref, n);
      this.ensureGlobalElement(ns, local, n);
      return ['r', this.key(ns, local), min, max];
    }
    const name = attr(n, 'name');
    if (name === null) fail('element without name/ref', n);
    const form = attr(n, 'form');
    const qualified = form ? form === 'qualified' : doc.efd;
    const decl = this.elementDecl(n, doc, qualified ? doc.tns : null, name);
    const p = ['e', decl.key, decl.t, min, max];
    if (decl.flags) p.push(decl.flags);
    return p;
  }

  /** Common part of global and local element declarations. */
  elementDecl(n, doc, ns, name) {
    const key = this.key(ns, name);
    const t = attr(n, 'type');
    const kids = children(n);
    let tref;
    let i = 0;
    if (t !== null) tref = this.typeRef(t, n);
    else if (kids.length && (kids[0].localName === 'complexType' || kids[0].localName === 'simpleType')) { tref = this.anonType(kids[0], doc); i = 1; }
    else tref = 'xs:anyType';
    for (; i < kids.length; i++) {
      if (/^(key|unique|keyref)$/.test(kids[i].localName)) fail('identity constraint <' + kids[i].nodeName + '> is not supported', kids[i]);
      fail('unexpected <' + kids[i].nodeName + '> in element declaration', kids[i]);
    }
    const flags = {};
    if (attr(n, 'nillable') === 'true') flags.nil = 1;
    if (attr(n, 'abstract') === 'true') flags.abs = 1;
    const fixed = attr(n, 'fixed'); if (fixed !== null) flags.fixed = fixed;
    const def = attr(n, 'default'); if (def !== null) flags.def = def;
    const block = attr(n, 'block'); if (block) flags.block = block;
    return { key, t: tref, flags: Object.keys(flags).length ? flags : null };
  }

  ensureGlobalElement(ns, local, ctx) {
    const k = this.key(ns, local);
    if (this.elements[k]) return;
    const g = this.set.globals.element.get('{' + (ns || '') + '}' + local);
    if (!g) fail('cannot resolve global element {' + ns + '}' + local, ctx);
    const d = {};
    this.elements[k] = d;               // register before resolving the type (recursive types)
    const decl = this.elementDecl(g.el, g.doc, g.doc.tns, local);
    d.t = decl.t;
    if (decl.flags) Object.assign(d, decl.flags);
    const sg = attr(g.el, 'substitutionGroup');
    if (sg !== null) {
      const h = resolveQName(sg, g.el);
      this.ensureGlobalElement(h.ns, h.local, g.el);
      const hk = this.key(h.ns, h.local);
      d.sg = hk;
      if (!this.substitution.has(hk)) this.substitution.set(hk, new Set());
      this.substitution.get(hk).add(k);
    }
  }

  compileAll() {
    // all global elements, attributes and named types of every loaded document
    for (const [k, g] of this.set.globals.element) {
      const m = /^\{(.*)\}(.*)$/.exec(k);
      this.ensureGlobalElement(m[1] || null, m[2], g.el);
    }
    for (const [k, g] of this.set.globals.attribute) {
      const m = /^\{(.*)\}(.*)$/.exec(k);
      this.ensureGlobalAttribute(m[1] || null, m[2], g.el);
    }
    for (const [k, g] of this.set.globals.type) this.compileNamedType(k, g.el, g.doc);
    // substitution group members (transitive) attached to each head
    const members = {};
    for (const [head, set] of this.substitution) {
      const all = new Set();
      const stack = [...set];
      while (stack.length) {
        const m = stack.pop();
        if (all.has(m)) continue;
        all.add(m);
        for (const mm of this.substitution.get(m) || []) stack.push(mm);
      }
      members[head] = [...all].sort();
    }
    for (let i = 0; i < this.types.length; i++) if (this.types[i] === null) fail('internal: unresolved type slot ' + i);
    return members;
  }
}

function main(argv) {
  if (argv.length < 2) {
    console.error('usage: node tools/compile-xsd.cjs <root.xsd> [<root2.xsd> ...] <out.json>');
    process.exit(2);
  }
  const outFile = argv[argv.length - 1];
  const roots = argv.slice(0, -1);
  const set = new SchemaSet();
  for (const r of roots) set.load(r);
  set.checkPendingImports();
  const comp = new Compiler(set);
  const sg = comp.compileAll();
  const rootDir = path.dirname(path.resolve(roots[0]));
  /** '<repository>/<path inside the git working tree>' (machine independent; 'os-UBL-2.1/...' for the OASIS package) */
  function repoRelative(abs) {
    const real = fs.realpathSync(abs);
    for (let d = path.dirname(real); d !== path.dirname(d); d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.git')) || path.basename(d) === 'os-UBL-2.1') return path.basename(d) + '/' + path.relative(d, real).split(path.sep).join('/');
    }
    return path.basename(real);
  }
  function noticesFor(paths) {
    const legal = (f) => fs.readFileSync(path.join(__dirname, '..', 'legal', f), 'utf8');
    const out = [];
    const text = paths.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    if (/OASIS/.test(text) && /urn:oasis:names:specification:ubl/.test(text)) out.push({ holder: 'OASIS Open', text: legal('OASIS-NOTICE.txt') });
    if (/urn:un:unece:uncefact/.test(text)) out.push({ holder: 'UN/CEFACT', text: legal('UNCEFACT-NOTICE.txt') });
    if (paths.some((p) => /ZF_250|FACTUR-X/i.test(p))) out.push({ holder: 'FNFE-MPE / FeRD', text: legal('FERD-FACTURX-NOTICE.txt') });
    return out;
  }
  const model = {
    format: 'erechnung-pruefer-xsd/1',
    generator: 'tools/compile-xsd.cjs',
    roots: roots.map((r) => path.basename(r)),
    sources: set.sources.map((s) => ({
      file: path.relative(rootDir, s.path).split(path.sep).join('/'),
      path: repoRelative(s.path), sha256: s.sha256, bytes: s.bytes, targetNamespace: s.targetNamespace,
    })),
    // copyright notices that must accompany the schemas and derivative works (legal/*.txt)
    notices: noticesFor(set.sources.map((s) => s.path)),
    ns: comp.nsTable,
    elements: comp.elements,
    attributes: comp.attributes,
    substitutionGroups: sg,
    types: comp.types,
  };
  const json = JSON.stringify(model);
  // Verification with the runtime: every content model is compiled into its automaton now (a
  // Unique Particle Attribution violation would throw), every simple type incl. pattern facets is
  // resolved, so a model that cannot be executed is never written.
  const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));
  const rt = XV.create(JSON.parse(json));
  const stats = rt.compileAllContentModels();
  for (let i = 0; i < model.types.length; i++) rt.typeOf(i);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, json);
  const named = comp.types.filter((t) => t.n).length;
  console.log('compile-xsd: ' + roots.map((r) => path.basename(r)).join(' + ') + ' -> ' + outFile);
  console.log('  documents: ' + set.docs.length + ', namespaces: ' + (comp.nsTable.length - 1)
    + ', global elements: ' + Object.keys(comp.elements).length + ', global attributes: ' + Object.keys(comp.attributes).length
    + ', types: ' + comp.types.length + ' (named ' + named + ', anonymous ' + (comp.types.length - named) + ' after de-duplication)');
  console.log('  particles: elements ' + comp.stats.elementParticles + ', groups ' + comp.stats.groups + ', wildcards ' + comp.stats.wildcards
    + ', substitution groups: ' + Object.keys(sg).length + ', bytes: ' + Buffer.byteLength(json));
  console.log('  verified: ' + stats.automata + ' content models compiled to deterministic automata (' + stats.states + ' states, ' + stats.transitions + ' transitions), all types resolved');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main, BUILTIN };
