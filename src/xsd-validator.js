/*
 * xsd-validator.js — W3C XML Schema 1.0 validation of a DOM document against the JSON model
 * produced by tools/compile-xsd.cjs. No dependencies; runs in the browser (DOMParser documents)
 * and in Node (slimdom documents).
 *
 * The verdict (valid / invalid) is engineered to be identical to the JDK's built-in Xerces
 * (javax.xml.validation, the engine KoSIT's validator uses for its <validateWithXmlSchema> step);
 * the proof is test/run-xsd-tests.cjs against test/xsd-oracle/XsdOracle.java on the corpora and
 * the generated mutations (report: build/reports/xsd-vs-xerces.txt).
 *
 * Implemented (everything the UBL 2.1 / CII D16B / xmldsig / XAdES schema set uses, and a bit more):
 *  - element declarations (global, local, ref, substitution groups), nillable/abstract/fixed/default,
 *    xsi:type (with derivation check and block), xsi:nil, xsi:schemaLocation /
 *    xsi:noNamespaceSchemaLocation (accepted, hints are not followed — exactly like a Schema built
 *    from explicit sources);
 *  - complex types: sequence / choice (nested, with occurrence ranges), simpleContent
 *    extension/restriction, complexContent extension/restriction, mixed, empty, abstract,
 *    attribute uses (required/optional/prohibited, fixed, default), attribute groups, anyAttribute,
 *    xs:any with namespace constraints ##any/##other/##local/##targetNamespace/list and
 *    processContents strict/lax/skip (lax: validated when a global declaration exists, otherwise
 *    skipped; strict: error when none exists);
 *  - content models are compiled lazily into deterministic Glushkov automata (the Unique Particle
 *    Attribution rule guarantees determinism; a violation is reported when the automaton is built),
 *    matching is a single linear pass over the child elements;
 *  - simple types: restriction chains with the facets enumeration, pattern (XSD regex translated
 *    to JavaScript), length, minLength, maxLength, totalDigits, fractionDigits,
 *    min/maxInclusive, min/maxExclusive, whiteSpace; list and union varieties; all XSD built-in
 *    datatypes with Xerces' lexical rules (decimal, integer family with ranges, boolean, float,
 *    double, date, dateTime, time, gYear, gYearMonth, gMonth, gMonthDay, gDay, duration,
 *    base64Binary, hexBinary, anyURI (Xerces' RFC 2396/2732 parser incl. the XLink escaping),
 *    QName, NOTATION, string, normalizedString, token, language, Name, NCName, NMTOKEN(S), ID,
 *    IDREF(S), ENTITY/ENTITIES);
 *  - ID uniqueness and IDREF resolution over the whole document.
 *
 * Not implemented (not used by these schemas; the compiler rejects them): xs:all, identity
 * constraints (xs:key / xs:unique / xs:keyref), xs:redefine, xs:notation.
 *
 * Error objects: { code, message (German), location (XPath such as /ubl:Invoice[1]/cac:X[2]/@a),
 * line: null }. `code` is the XML Schema clause identifier Xerces uses for the same situation
 * (cvc-complex-type.2.4.a, cvc-datatype-valid.1.2.1, ...).
 *
 * Licence: EUPL-1.2.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XsdValidator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
  const XMLNS = 'http://www.w3.org/2000/xmlns/';
  const XS = 'http://www.w3.org/2001/XMLSchema';

  const KNOWN_PREFIXES = {
    'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2': 'ubl',
    'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2': 'cn',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2': 'cac',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2': 'cbc',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2': 'ext',
    'urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2': 'udt',
    'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDataTypes-2': 'qdt',
    'urn:un:unece:uncefact:data:specification:CoreComponentTypeSchemaModule:2': 'ccts-cct',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2': 'sig',
    'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2': 'sac',
    'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2': 'sbc',
    'http://www.w3.org/2000/09/xmldsig#': 'ds',
    'http://uri.etsi.org/01903/v1.3.2#': 'xades',
    'http://uri.etsi.org/01903/v1.4.1#': 'xades141',
    'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100': 'rsm',
    'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100': 'ram',
    'urn:un:unece:uncefact:data:standard:QualifiedDataType:100': 'qdt',
    'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100': 'udt',
  };

  // =============================================================================================
  // XML character classes (XML 1.0 4th edition, identical to Xerces' XMLChar which the JDK uses):
  // NCNameStartChar / NCNameChar as [start.length] ranges in base 36; Name adds ':' to both.
  // Supplementary characters (> U+FFFF) are never name characters in these tables.
  // =============================================================================================
  const NCNAME_START_RANGES = '1t.p,2n.0,2p.p,5c.m,60.u,6w.1l,8k.a,8x.7,96.1g,ao.1v,ct.z,dw.1,e2.t,gg.2g,jf.6,p2.0,p4.2,p8.0,pa.j,pv.17,r4.6,re.0,rg.0,ri.0,rk.0,rm.h,sh.b,su.1t,up.b,v2.z,wg.1g,xz.1,y3.1,y8.r,z2.7,zc.1,10x.11,121.0,129.11,15c.q,168.2,17l.p,18h.9,19t.1y,1bu.4,1c0.e,1cg.3,1cl.0,1d1.1,1d4.0,1d6.0,1d8.0,1da.0,1dc.2,1dg.1,1dj.0,1dl.0,1dn.0,1dp.0,1dr.0,1dt.0,1dv.0,1dx.0,1dz.0,1e1.0,1e3.0,1e5.0,1e7.0,1e9.0,1eb.0,1ed.4,1ej.5,1eq.b,1f2.0,1f4.0,1fa.6,1fi.b,1fv.5,1g3.1,1g6.9,1gi.1,1gm.6,1gv.2,1h0.0,1h2.0,1h4.3,1h9.0,1hb.0,1hd.2,1hi.1,1hm.1,1hq.4,1hw.0,1hy.1,1i2.0,1i4.0,1i6.6,1ii.1,1im.6,1iv.3,1j1.0,1j4.0,1j6.3,1jc.1,1jg.1,1jj.2,1jr.5,1k2.0,1k4.6,1kc.1,1kg.2,1kk.3,1kp.1,1ks.0,1ku.0,1kw.1,1kz.1,1l3.0,1l6.1,1l9.2,1le.0,1lg.0,1li.0,1lw.0,1ly.1,1m1.0,1m8.5,1mf.0,1mh.1,1ml.1,1mp.4,1mv.2,1mz.0,1n2.1,1n5.1,1n9.7,1ni.2,1nm.2,1nq.1,1nt.2,1nx.0,1o0.1,1o3.6,1ob.1,1oe.0,1og.0,1oi.3,1ot.g,1pb.1,1pg.1,1pj.0,1pl.3,1pq.3,1pv.c,1q9.0,1qc.2,1qg.1,1qj.0,1qq.7,1r4.3,1ra.0,1rc.4,1rk.0,1rm.3,1rr.3,1ry.6,1s8.3,1sd.0,1sg.b,1st.z,1u1.0,1u9.1,1uc.0,1ue.1,1uh.2,1v4.3,1v9.4,1vg.y,1w8.r,1x7.5,1xl.c,1xz.1v,1zu.1v,21p.1l,23r.1d,25a.3,25f.f,25w.1,25z.5,266.5,26d.c,26r.9,273.d,27j.2,27n.3,27s.9,286.3,28b.3,28g.a,28t.0,28v.6,293.0,29f.0,29w.0,2a1.1,2a4.2,2a8.1,2af.1,2ai.1,2al.0,2ao.1,2as.2,2b2.0,2b6.0,2b8.0,2bi.1f,2d3.0,2do.1n,2fd.3,2fj.1,2fm.3,2fr.3,2fw.3,2g1.2,2lc.7iv,n8h.0,ngg.1cc';
  const NCNAME_RANGES = '19.1,1c.9,1t.p,2n.0,2p.p,53.0,5c.m,60.u,6w.1l,8k.a,8x.7,96.1g,ao.1v,ct.z,dw.1,e2.t,gg.2g,jf.6,m0.1,nc.1h,oo.1,p2.4,p8.0,pa.j,pv.17,r4.6,re.0,rg.0,ri.0,rk.0,rm.h,sh.b,su.1t,up.b,v2.z,vf.3,wg.1g,xz.1,y3.1,y8.r,z2.7,zc.1,10x.11,121.0,129.11,13d.0,13n.3,15c.q,168.2,16g.4,16n.8,16y.0,172.0,177.0,17b.0,17l.p,18h.9,18s.3,18y.8,19a.0,19d.0,19f.2,19j.3,19o.9,19z.2,1a3.0,1a5.0,1a7.0,1ac.1,1af.5,1am.2,1bu.4,1c0.e,1cg.3,1cl.0,1cp.1,1cw.1,1d1.1,1d4.0,1d6.0,1d8.0,1da.0,1dc.2,1dg.1,1dj.0,1dl.0,1dn.0,1dp.0,1dr.0,1dt.0,1dv.0,1dx.0,1dz.0,1e1.0,1e3.0,1e5.0,1e7.0,1e9.0,1eb.0,1ed.4,1ej.5,1eq.b,1f2.0,1f4.0,1f6.9,1fi.b,1fv.5,1g3.1,1g6.9,1gi.1,1gm.6,1gv.2,1h0.0,1h2.0,1h4.3,1h9.0,1hb.0,1hd.2,1hi.1,1hm.1,1hq.4,1hw.0,1hy.1,1i2.0,1i4.0,1i6.6,1ii.1,1im.6,1iv.3,1j1.0,1j4.0,1j6.3,1jc.1,1jg.1,1jj.2,1jr.5,1k2.0,1k4.6,1kc.1,1kg.2,1kk.3,1kp.1,1ks.0,1ku.0,1kw.1,1kz.1,1l3.0,1l6.1,1l9.2,1le.0,1lg.0,1li.0,1lw.0,1ly.1,1m1.0,1m8.5,1mf.0,1mh.1,1ml.1,1mp.4,1mv.2,1mz.0,1n2.1,1n5.1,1n9.7,1ni.2,1nm.2,1nq.1,1nt.2,1nx.0,1o0.1,1o3.6,1ob.1,1oe.0,1og.0,1oi.3,1ot.g,1pb.1,1pg.1,1pj.0,1pl.3,1pq.3,1pv.c,1q9.0,1qc.2,1qg.1,1qj.0,1qq.7,1r4.3,1ra.0,1rc.4,1rk.0,1rm.3,1rr.3,1ry.6,1s8.3,1sd.0,1sg.b,1st.z,1u1.0,1u9.1,1uc.0,1ue.1,1uh.2,1v4.3,1v9.4,1vg.y,1w8.r,1x7.5,1xl.c,1xz.1v,1zu.1v,21p.1l,23r.1d,25a.3,25f.f,25w.1,25z.5,266.5,26d.c,26r.9,273.d,27j.2,27n.3,27s.9,286.3,28b.3,28g.a,28t.0,28v.6,293.0,29f.0,29w.0,2a1.1,2a4.2,2a8.1,2af.1,2ai.1,2al.0,2ao.1,2as.2,2b2.0,2b6.0,2b8.0,2bi.1f,2d3.0,2do.1n,2fd.3,2fj.1,2fm.3,2fr.3,2fw.3,2g1.2,2lc.7iv,n8h.0,ngg.1cc';

  function decodeRanges(s) {
    const starts = [], ends = [];
    for (const part of s.split(',')) {
      const i = part.indexOf('.');
      const a = parseInt(part.slice(0, i), 36);
      starts.push(a);
      ends.push(a + parseInt(part.slice(i + 1), 36));
    }
    return { starts, ends };
  }
  const NCNAME_START = decodeRanges(NCNAME_START_RANGES);
  const NCNAME_CHAR = decodeRanges(NCNAME_RANGES);
  function inRanges(t, c) {
    let lo = 0, hi = t.starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c < t.starts[mid]) hi = mid - 1;
      else if (c > t.ends[mid]) lo = mid + 1;
      else return true;
    }
    return false;
  }
  function isNCNameStart(c) { return c < 0x10000 && inRanges(NCNAME_START, c); }
  function isNCNameChar(c) { return c < 0x10000 && inRanges(NCNAME_CHAR, c); }
  function isValidNCName(s) {
    if (!s.length) return false;
    if (!isNCNameStart(s.charCodeAt(0))) return false;
    for (let i = 1; i < s.length; i++) if (!isNCNameChar(s.charCodeAt(i))) return false;
    return true;
  }
  function isValidName(s) {
    if (!s.length) return false;
    const c0 = s.charCodeAt(0);
    if (!(c0 === 0x3a || isNCNameStart(c0))) return false;
    for (let i = 1; i < s.length; i++) { const c = s.charCodeAt(i); if (!(c === 0x3a || isNCNameChar(c))) return false; }
    return true;
  }
  function isValidNmtoken(s) {
    if (!s.length) return false;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (!(c === 0x3a || isNCNameChar(c))) return false; }
    return true;
  }
  function rangesToClass(t, extra) {
    let out = '';
    for (let i = 0; i < t.starts.length; i++) {
      out += '\\u{' + t.starts[i].toString(16) + '}';
      if (t.ends[i] > t.starts[i]) out += '-\\u{' + t.ends[i].toString(16) + '}';
    }
    return out + (extra || '');
  }

  // =============================================================================================
  // Whitespace handling
  // =============================================================================================
  function isXmlSpace(c) { return c === 0x20 || c === 0x9 || c === 0xa || c === 0xd; }
  function isWhitespaceOnly(s) {
    for (let i = 0; i < s.length; i++) if (!isXmlSpace(s.charCodeAt(i))) return false;
    return true;
  }
  function wsReplace(s) {
    let out = null;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x9 || c === 0xa || c === 0xd) { if (out === null) out = s.slice(0, i); out += ' '; }
      else if (out !== null) out += s[i];
    }
    return out === null ? s : out;
  }
  function wsCollapse(s) {
    let out = '', pendingSpace = false, started = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (isXmlSpace(c)) { pendingSpace = true; continue; }
      if (pendingSpace && started) out += ' ';
      pendingSpace = false; started = true;
      out += s[i];
    }
    return out;
  }
  function normalize(s, ws) { return ws === 'collapse' ? wsCollapse(s) : ws === 'replace' ? wsReplace(s) : s; }

  // =============================================================================================
  // Built-in datatype lexical checks (port of the Xerces *DV classes' acceptance behaviour).
  // Each check returns null when valid, otherwise a German reason. Values are already
  // whitespace-normalised according to the type.
  // =============================================================================================
  function isDigit(c) { return c >= 0x30 && c <= 0x39; }

  /** Xerces DecimalDV.XDecimal: sign, digits, optional '.', digits; at least one digit. */
  function parseDecimal(s) {
    const len = s.length;
    if (!len) return null;
    let i = 0, sign = 1;
    if (s[0] === '+') i = 1; else if (s[0] === '-') { i = 1; sign = -1; }
    const intStart = i;
    while (i < len && s.charCodeAt(i) === 0x30) i++;
    const actualIntStart = i;
    while (i < len && isDigit(s.charCodeAt(i))) i++;
    const intEnd = i;
    let fracStart = 0, fracEnd = 0;
    if (intEnd < len) {
      if (s[intEnd] !== '.') return null;
      fracStart = intEnd + 1; fracEnd = len;
    }
    if (intStart === intEnd && fracStart === fracEnd) return null;
    let fe = fracEnd;
    while (fe > fracStart && s.charCodeAt(fe - 1) === 0x30) fe--;
    for (let j = fracStart; j < fe; j++) if (!isDigit(s.charCodeAt(j))) return null;
    const intDigits = s.slice(actualIntStart, intEnd);
    const fracDigits = s.slice(fracStart, fe);
    return { sign, int: intDigits, frac: fracDigits, totalDigits: intDigits.length + fracDigits.length, fractionDigits: fracDigits.length,
      canonical: (sign < 0 && (intDigits.length || fracDigits.length) ? '-' : '') + (intDigits || '0') + (fracDigits ? '.' + fracDigits : '') };
  }
  function parseInteger(s) {
    const len = s.length;
    if (!len) return null;
    let i = 0, sign = 1;
    if (s[0] === '+') i = 1; else if (s[0] === '-') { i = 1; sign = -1; }
    if (i === len) return null;
    for (let j = i; j < len; j++) if (!isDigit(s.charCodeAt(j))) return null;
    let k = i;
    while (k < len - 1 && s.charCodeAt(k) === 0x30) k++;
    const digits = s.slice(k);
    return { sign, int: digits === '0' ? '' : digits, frac: '', totalDigits: digits === '0' ? 0 : digits.length, fractionDigits: 0,
      canonical: (sign < 0 && digits !== '0' ? '-' : '') + digits };
  }
  /** compares two parsed decimals numerically: -1, 0, 1 */
  function compareDecimal(a, b) {
    const az = !a.int && !a.frac, bz = !b.int && !b.frac;
    if (az && bz) return 0;
    const sa = az ? 0 : a.sign, sb = bz ? 0 : b.sign;
    if (sa !== sb) return sa < sb ? -1 : 1;
    let c;
    if (a.int.length !== b.int.length) c = a.int.length < b.int.length ? -1 : 1;
    else if (a.int !== b.int) c = a.int < b.int ? -1 : 1;
    else {
      const la = Math.max(a.frac.length, b.frac.length);
      const fa = a.frac.padEnd(la, '0'), fb = b.frac.padEnd(la, '0');
      c = fa === fb ? 0 : fa < fb ? -1 : 1;
    }
    return sa < 0 ? -c : c;
  }

  const FLOAT_RE = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|-?INF|NaN)$/;

  /** Xerces AbstractDateTimeDV: shared pieces */
  function dtParseInt(s, start, end) {
    if (end > s.length || start >= end) throw new Error('bad int');
    let v = 0;
    for (let i = start; i < end; i++) { const c = s.charCodeAt(i); if (!isDigit(c)) throw new Error('bad int'); v = v * 10 + (c - 48); }
    return v;
  }
  function dtYearMonth(s, start, end, d) {
    if (s[0] === '-') start++;
    let i = s.indexOf('-', start);
    if (i === -1 || i >= end) throw new Error('year separator');
    const length = i - start;
    if (length < 4) throw new Error('year CCYY');
    if (length > 4 && s[start] === '0') throw new Error('leading zero year');
    d.year = dtParseInt(s, start, i) * (s[0] === '-' ? -1 : 1);
    start = ++i;
    i = start + 2;
    d.month = dtParseInt(s, start, i);
    if (s[i] !== '-') throw new Error('MM-');
    return ++i;
  }
  function dtTimeZone(s, start, end, d) {
    d.utc = s[start];
    if (s[start] === 'Z') { if (end > start + 1) throw new Error('tz'); return; }
    if (start <= end - 6) {
      const negate = s[start] === '-' ? -1 : 1;
      let stop = ++start + 2;
      d.tzHr = negate * dtParseInt(s, start, stop);
      if (s[stop++] !== ':') throw new Error('tz');
      d.tzMin = negate * dtParseInt(s, stop, stop + 2);
      if (stop + 2 !== end) throw new Error('tz');
    } else throw new Error('tz');
  }
  function dtFindUTCSign(s, start, end) {
    for (let i = start; i < end; i++) { const c = s[i]; if (c === 'Z' || c === '+' || c === '-') return i; }
    return -1;
  }
  function dtParseSecond(s, start, end) {
    let dot = -1;
    for (let i = start; i < end; i++) { const c = s[i]; if (c === '.') dot = i; else if (c > '9' || c < '0') throw new Error('sec'); }
    if (dot === -1) { if (start + 2 !== end) throw new Error('sec'); }
    else if (start + 2 !== dot || dot + 1 === end) throw new Error('sec');
    return parseFloat(s.slice(start, end));
  }
  function dtTime(s, start, end, d) {
    let stop = start + 2;
    d.hour = dtParseInt(s, start, stop);
    if (s[stop++] !== ':') throw new Error('time');
    start = stop; stop += 2;
    d.minute = dtParseInt(s, start, stop);
    if (s[stop++] !== ':') throw new Error('time');
    const sign = dtFindUTCSign(s, start, end);
    start = stop; stop = sign < 0 ? end : sign;
    d.second = dtParseSecond(s, start, stop);
    if (sign > 0) dtTimeZone(s, sign, end, d);
  }
  function maxDayInMonth(year, month) {
    if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
    if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    return 31;
  }
  function dtValidate(d, hasDate, hasTime) {
    if (hasDate) {
      if (d.year === 0) throw new Error('year 0000');
      if (d.month < 1 || d.month > 12) throw new Error('month');
      if (d.day > maxDayInMonth(d.year, d.month) || d.day < 1) throw new Error('day');
    }
    if (hasTime) {
      if (d.hour > 23 || d.hour < 0) { if (!(d.hour === 24 && d.minute === 0 && d.second === 0)) throw new Error('hour'); }
      if (d.minute > 59 || d.minute < 0) throw new Error('minute');
      if (d.second >= 60 || d.second < 0) throw new Error('second');
    }
    if (d.tzHr > 14 || d.tzHr < -14) throw new Error('tz range');
    if ((d.tzHr === 14 || d.tzHr === -14) && d.tzMin !== 0) throw new Error('tz range');
    if (d.tzMin > 59 || d.tzMin < -59) throw new Error('tz min');
  }
  function newDT() { return { year: 1, month: 1, day: 1, hour: 0, minute: 0, second: 0, utc: 0, tzHr: 0, tzMin: 0 }; }
  function dtKey(d) {
    return [d.year, d.month, d.day, d.hour, d.minute, d.second, d.utc ? d.tzHr * 60 + d.tzMin : 'local'].join('|');
  }
  function parseDate(s) {
    try {
      const d = newDT(), end = s.length;
      let i = dtYearMonth(s, 0, end, d);
      d.day = dtParseInt(s, i, i + 2); i += 2;
      if (i < end) { const c = s[i]; if (!(c === 'Z' || c === '+' || c === '-')) throw new Error('after day'); dtTimeZone(s, i, end, d); }
      dtValidate(d, true, false);
      return d;
    } catch (e) { return null; }
  }
  function parseDateTime(s) {
    try {
      const d = newDT(), len = s.length;
      const t = s.indexOf('T');
      if (t < 0) throw new Error('no T');
      let i = dtYearMonth(s, 0, t, d);
      d.day = dtParseInt(s, i, i + 2); i += 2;
      if (i !== t) throw new Error('date part');
      dtTime(s, t + 1, len, d);
      dtValidate(d, true, true);
      return d;
    } catch (e) { return null; }
  }
  function parseTime(s) {
    try {
      const d = newDT();
      dtTime(s, 0, s.length, d);
      dtValidate(d, false, true);
      return d;
    } catch (e) { return null; }
  }
  /** gYear, gYearMonth, gMonth, gMonthDay, gDay (Xerces YearDV, YearMonthDV, MonthDV, MonthDayDV, DayDV) */
  function parseGregorian(kind, s) {
    try {
      const d = newDT(), end = s.length;
      let i = 0;
      if (kind === 'gYear' || kind === 'gYearMonth') {
        if (s[0] === '-') i++;
        let j = kind === 'gYear' ? dtFindUTCSign(s, i, end) : s.indexOf('-', i);
        if (j === -1) j = end;
        const length = j - i;
        if (length < 4) throw new Error('year');
        if (length > 4 && s[i] === '0') throw new Error('leading zero');
        d.year = dtParseInt(s, i, j) * (s[0] === '-' ? -1 : 1);
        i = j;
        if (kind === 'gYearMonth') {
          if (s[i] !== '-') throw new Error('-');
          d.month = dtParseInt(s, i + 1, i + 3); i += 3;
        }
      } else {
        if (s[0] !== '-' || s[1] !== '-') throw new Error('--');
        if (kind === 'gMonth') { d.month = dtParseInt(s, 2, 4); i = 4; if (s[i] === '-' && s[i + 1] === '-') i += 2; }
        else if (kind === 'gMonthDay') { d.month = dtParseInt(s, 2, 4); if (s[4] !== '-') throw new Error('-'); d.day = dtParseInt(s, 5, 7); i = 7; }
        else { if (s[2] !== '-') throw new Error('---'); d.day = dtParseInt(s, 3, 5); i = 5; }
      }
      if (i < end) { const c = s[i]; if (!(c === 'Z' || c === '+' || c === '-')) throw new Error('tail'); dtTimeZone(s, i, end, d); }
      if (kind === 'gYear' || kind === 'gYearMonth') { if (d.year === 0) throw new Error('year 0000'); }
      if (kind !== 'gYear' && kind !== 'gDay' && (d.month < 1 || d.month > 12)) throw new Error('month');
      if (kind === 'gMonthDay' && (d.day < 1 || d.day > maxDayInMonth(2000, d.month))) throw new Error('day');
      if (kind === 'gDay' && (d.day < 1 || d.day > 31)) throw new Error('day');
      if (d.tzHr > 14 || d.tzHr < -14 || ((d.tzHr === 14 || d.tzHr === -14) && d.tzMin !== 0) || d.tzMin > 59 || d.tzMin < -59) throw new Error('tz');
      return d;
    } catch (e) { return null; }
  }
  const DURATION_RE = /^-?P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=[\d.])(\d+H)?(\d+M)?((\d+(\.\d+)?|\.\d+)S)?)?$/;
  function parseDuration(s) {
    const m = DURATION_RE.exec(s);
    if (!m) return null;
    if (m[4] !== undefined && m[5] === undefined && m[6] === undefined && m[7] === undefined) return null;
    return s;
  }

  const B64 = new Int16Array(128).fill(-1);
  (function () {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < a.length; i++) B64[a.charCodeAt(i)] = i;
  })();
  /** Xerces Base64.decode: returns the number of decoded bytes or -1 */
  function base64Length(s) {
    let data = '';
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (!isXmlSpace(c)) data += s[i]; }
    const len = data.length;
    if (len % 4 !== 0) return -1;
    const quads = len / 4;
    if (quads === 0) return 0;
    const isData = (ch) => ch < 128 && B64[ch] !== -1;
    for (let q = 0; q < quads - 1; q++) {
      const o = q * 4;
      if (!isData(data.charCodeAt(o)) || !isData(data.charCodeAt(o + 1)) || !isData(data.charCodeAt(o + 2)) || !isData(data.charCodeAt(o + 3))) return -1;
    }
    const o = (quads - 1) * 4;
    const d1 = data.charCodeAt(o), d2 = data.charCodeAt(o + 1), d3 = data.charCodeAt(o + 2), d4 = data.charCodeAt(o + 3);
    if (!isData(d1) || !isData(d2)) return -1;
    const b2 = B64[d2];
    if (!isData(d3) || !isData(d4)) {
      const isPad = (ch) => ch === 0x3d;
      if (isPad(d3) && isPad(d4)) { if ((b2 & 0xf) !== 0) return -1; return quads * 3 - 2; }
      if (!isPad(d3) && isPad(d4)) { if (!isData(d3)) return -1; const b3 = B64[d3]; if ((b3 & 0x3) !== 0) return -1; return quads * 3 - 1; }
      return -1;
    }
    return quads * 3;
  }
  const HEX_RE = /^([0-9a-fA-F]{2})*$/;

  // ---- anyURI: port of Xerces AnyURIDV.encode + org.apache.xerces.util.URI ------------------
  const URI_ESC = new Uint8Array(128);
  (function () {
    for (let i = 0; i <= 0x1f; i++) URI_ESC[i] = 1;
    URI_ESC[0x7f] = 1;
    for (const ch of ' <>"{}|\\^~`') URI_ESC[ch.charCodeAt(0)] = 1;
  })();
  function uriEncode(s) {
    let out = '', i = 0;
    const hex = (b) => '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 128) break;
      out += URI_ESC[c] ? hex(c) : s[i];
    }
    if (i < s.length) {
      const bytes = utf8Bytes(s.slice(i));
      for (const b of bytes) out += (b >= 128 || URI_ESC[b]) ? hex(b) : String.fromCharCode(b);
    }
    return out;
  }
  function utf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  const isAlpha = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  const isAlphanum = (c) => isAlpha(c) || isDigit(c);
  const isHex = (c) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
  const MARK = "-_.!~*'()", RESERVED = ';/?:@&=+$,[]', USERINFO = ';:&=+$,', REG_NAME = '$,;:@&=+', PATH = ';/:@&=+$,', SCHEME = '+-.';
  const isUnreserved = (c) => isAlphanum(c) || MARK.indexOf(String.fromCharCode(c)) >= 0;
  const isURIChar = (c) => c < 128 && (isUnreserved(c) || RESERVED.indexOf(String.fromCharCode(c)) >= 0);
  const isPathChar = (c) => c < 128 && (isUnreserved(c) || PATH.indexOf(String.fromCharCode(c)) >= 0);
  const isUserinfoChar = (c) => c < 128 && (isUnreserved(c) || USERINFO.indexOf(String.fromCharCode(c)) >= 0);
  const isRegNameChar = (c) => c < 128 && (isUnreserved(c) || REG_NAME.indexOf(String.fromCharCode(c)) >= 0);
  const isSchemeChar = (c) => isAlphanum(c) || SCHEME.indexOf(String.fromCharCode(c)) >= 0;
  function escapedOk(s, i) { return i + 2 < s.length && isHex(s.charCodeAt(i + 1)) && isHex(s.charCodeAt(i + 2)); }
  function isWellFormedIPv4(address) {
    let addrLength = address.length, numDots = 0, numDigits = 0;
    for (let i = 0; i < addrLength; i++) {
      const c = address.charCodeAt(i);
      if (c === 0x2e) { if ((i > 0 && !isDigit(address.charCodeAt(i - 1))) || (i + 1 < addrLength && !isDigit(address.charCodeAt(i + 1)))) return false; numDigits = 0; if (++numDots > 3) return false; }
      else if (!isDigit(c)) return false;
      else if (++numDigits > 3) return false;
      else if (numDigits === 3) { const first = address.charCodeAt(i - 2), second = address.charCodeAt(i - 1); if (!(first < 0x32 && (first === 0x31 ? true : second < 0x36 && (second === 0x35 ? c <= 0x35 : true)))) return false; }
    }
    return numDots === 3;
  }
  function scanHexSeq(address, index, end) {
    let numDigits = 0, counter = 0;
    while (index < end) {
      const c = address.charCodeAt(index);
      if (c === 0x3a) { if (numDigits > 0 && ++counter > 7) return -1; numDigits = 0; }
      else if (!isHex(c)) { if (c === 0x2e && numDigits < 4 && numDigits > 0 && counter <= 6) { const back = index - numDigits - 1; return back >= 0 ? back : -1; } return -1; }
      else if (++numDigits > 4) return -1;
      index++;
    }
    return numDigits > 0 && ++counter > 8 ? -1 : counter;
  }
  function isWellFormedIPv6Reference(address) {
    const addrLength = address.length;
    const end = addrLength - 1;
    if (!(addrLength > 2 && address[0] === '[' && address[end] === ']')) return false;
    const counter = [0];
    let index = scanHexSeq2(address, 1, end, counter);
    if (index === -1) return false;
    if (index === end) return counter[0] === 8;
    if (index + 1 < end && address[index] === ':') {
      if (address[index + 1] === ':') {
        if (++counter[0] > 8) return false;
        index += 2;
        if (index === end) return true;
      } else {
        return counter[0] === 6 && isWellFormedIPv4(address.slice(index + 1, end));
      }
    } else return false;
    const prevCount = counter[0];
    index = scanHexSeq2(address, index, end, counter);
    return index === end || (index !== -1 && isWellFormedIPv4(address.slice((counter[0] > prevCount) ? index + 1 : index, end)));
  }
  function scanHexSeq2(address, index, end, counter) {
    let numDigits = 0, start = index;
    while (index < end) {
      const c = address.charCodeAt(index);
      if (c === 0x3a) {
        if (numDigits > 0 && ++counter[0] > 8) return -1;
        if (numDigits === 0 || ((index + 1 < end) && address.charCodeAt(index + 1) === 0x3a)) return index;
        numDigits = 0;
      } else if (!isHex(c)) {
        if (c === 0x2e && numDigits < 4 && numDigits > 0 && counter[0] <= 6) {
          const back = index - numDigits - 1;
          return (back >= start) ? back : (back + 1);
        }
        return -1;
      } else if (++numDigits > 4) return -1;
      index++;
    }
    return (numDigits > 0 && ++counter[0] > 8) ? -1 : end;
  }
  function isWellFormedAddress(address) {
    if (!address) return false;
    const addrLength = address.length;
    if (address[0] === '[') return isWellFormedIPv6Reference(address);
    if (address[0] === '.' || address[0] === '-' || address[addrLength - 1] === '-') return false;
    let index = address.lastIndexOf('.');
    if (address[addrLength - 1] === '.') index = address.slice(0, index).lastIndexOf('.');
    if (index + 1 < addrLength && isDigit(address.charCodeAt(index + 1))) return isWellFormedIPv4(address);
    if (addrLength > 255) return false;
    let labelCharCount = 0;
    for (let i = 0; i < addrLength; i++) {
      const c = address.charCodeAt(i);
      if (c === 0x2e) {
        if (!isAlphanum(address.charCodeAt(i - 1))) return false;
        if (i + 1 < addrLength && !isAlphanum(address.charCodeAt(i + 1))) return false;
        labelCharCount = 0;
      } else if (!isAlphanum(c) && c !== 0x2d) return false;
      else if (++labelCharCount > 63) return false;
    }
    return true;
  }
  function isValidServerBasedAuthority(host, port, userinfo) {
    if (!isWellFormedAddress(host)) return false;
    if (port < -1 || port > 65535) return false;
    if (userinfo !== null) {
      let i = 0; const end = userinfo.length;
      while (i < end) {
        const c = userinfo.charCodeAt(i);
        if (c === 0x25) { if (!escapedOk(userinfo, i)) return false; i += 2; }
        else if (!isUserinfoChar(c)) return false;
        i++;
      }
    }
    return true;
  }
  function isValidRegistryBasedAuthority(authority) {
    let i = 0; const end = authority.length;
    while (i < end) {
      const c = authority.charCodeAt(i);
      if (c === 0x25) { if (!escapedOk(authority, i)) return false; i += 2; }
      else if (!isRegNameChar(c)) return false;
      i++;
    }
    return true;
  }
  function uriAuthority(spec) {
    let index = 0, start = 0; const end = spec.length;
    let userinfo = null;
    if (spec.indexOf('@') !== -1) {
      while (index < end) { if (spec[index] === '@') break; index++; }
      userinfo = spec.slice(start, index);
      index++;
    }
    start = index;
    let hasPort = false;
    if (index < end) {
      if (spec[start] === '[') {
        const bracketIndex = spec.indexOf(']', start);
        index = bracketIndex !== -1 ? bracketIndex : end;
        if (index + 1 < end && spec[index + 1] === ':') { ++index; hasPort = true; } else index = end;
      } else {
        const colonIndex = spec.lastIndexOf(':');
        index = colonIndex !== -1 ? colonIndex : end;
        hasPort = colonIndex !== -1;
      }
    }
    const host = spec.slice(start, index);
    let port = -1;
    if (host.length > 0 && hasPort) {
      const portStr = spec.slice(index + 1);
      if (portStr.length > 0) {
        port = /^[+-]?\d+$/.test(portStr) ? parseInt(portStr, 10) : -2;
        if (port === -1) port = -2;
        if (port > 2147483647 || port < -2147483648) port = -2;
      }
    }
    if (isValidServerBasedAuthority(host, port, userinfo)) return true;
    return isValidRegistryBasedAuthority(spec);
  }
  /** returns null when `spec` is a URI Xerces' URI class accepts (relative to abc://def.ghi.jkl), else a reason */
  function checkURI(raw) {
    if (!raw.length) return null;
    const spec = uriEncode(raw);
    const len = spec.length;
    let index = 0, scheme = null;
    const colonIdx = spec.indexOf(':');
    if (colonIdx !== -1) {
      const searchFrom = colonIdx - 1;
      const slashIdx = spec.lastIndexOf('/', searchFrom), queryIdx = spec.lastIndexOf('?', searchFrom), fragmentIdx = spec.lastIndexOf('#', searchFrom);
      if (colonIdx === 0 || slashIdx !== -1 || queryIdx !== -1 || fragmentIdx !== -1) {
        if (colonIdx === 0) return 'kein Schema vor dem Doppelpunkt';
      } else {
        let i = 0;
        while (i < len) { const c = spec[i]; if (c === ':' || c === '/' || c === '?' || c === '#') break; i++; }
        scheme = spec.slice(0, i);
        if (!scheme.length) return 'leeres URI-Schema';
        if (!isAlpha(scheme.charCodeAt(0))) return 'ungültiges URI-Schema';
        for (let j = 1; j < scheme.length; j++) if (!isSchemeChar(scheme.charCodeAt(j))) return 'ungültiges URI-Schema';
        index = scheme.length + 1;
        if (colonIdx === len - 1 || spec[colonIdx + 1] === '#') return 'leerer schema-spezifischer Teil';
      }
    }
    if (index + 1 < len && spec[index] === '/' && spec[index + 1] === '/') {
      index += 2;
      const startPos = index;
      while (index < len) { const c = spec[index]; if (c === '/' || c === '?' || c === '#') break; index++; }
      if (index > startPos) { if (!uriAuthority(spec.slice(startPos, index))) index = startPos - 2; }
      else if (index >= len) return 'Authority erwartet ("//" am Ende)';   // Xerces URI: empty authority is only allowed before a non-empty path, query or fragment
    }
    // path
    let testChar = '';
    const start = index;
    if (start < len) {
      if (scheme === null || spec[start] === '/') {
        while (index < len) {
          testChar = spec[index];
          const c = spec.charCodeAt(index);
          if (testChar === '%') { if (!escapedOk(spec, index)) return 'ungültige %-Sequenz im Pfad'; index += 2; }
          else if (!isPathChar(c)) { if (testChar === '?' || testChar === '#') break; return "ungültiges Zeichen '" + testChar + "' im Pfad"; }
          ++index;
        }
      } else {
        while (index < len) {
          testChar = spec[index];
          const c = spec.charCodeAt(index);
          if (testChar === '?' || testChar === '#') break;
          if (testChar === '%') { if (!escapedOk(spec, index)) return 'ungültige %-Sequenz'; index += 2; }
          else if (!isURIChar(c)) return "ungültiges Zeichen '" + testChar + "'";
          ++index;
        }
      }
    }
    if (index >= len) testChar = '';
    if (testChar === '?') {
      index++;
      while (index < len) {
        testChar = spec[index];
        const c = spec.charCodeAt(index);
        if (testChar === '#') break;
        if (testChar === '%') { if (!escapedOk(spec, index)) return 'ungültige %-Sequenz in der Query'; index += 2; }
        else if (!isURIChar(c)) return "ungültiges Zeichen '" + testChar + "' in der Query";
        index++;
      }
      if (index >= len) testChar = '';
    }
    if (testChar === '#') {
      index++;
      while (index < len) {
        testChar = spec[index];
        const c = spec.charCodeAt(index);
        if (testChar === '%') { if (!escapedOk(spec, index)) return 'ungültige %-Sequenz im Fragment'; index += 2; }
        else if (!isURIChar(c)) return "ungültiges Zeichen '" + testChar + "' im Fragment";
        index++;
      }
    }
    return null;
  }

  // =============================================================================================
  // XSD regular expressions -> JavaScript (only needed for xs:pattern facets)
  // =============================================================================================
  const UNICODE_CATEGORIES = new Set(['L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'Mn', 'Mc', 'Me', 'N', 'Nd', 'Nl', 'No', 'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Z', 'Zs', 'Zl', 'Zp', 'S', 'Sm', 'Sc', 'Sk', 'So', 'C', 'Cc', 'Cf', 'Co', 'Cn']);
  const UNICODE_BLOCKS = {
    BasicLatin: [0x0, 0x7f], 'Latin-1Supplement': [0x80, 0xff], 'LatinExtended-A': [0x100, 0x17f], 'LatinExtended-B': [0x180, 0x24f],
    IPAExtensions: [0x250, 0x2af], SpacingModifierLetters: [0x2b0, 0x2ff], CombiningDiacriticalMarks: [0x300, 0x36f], Greek: [0x370, 0x3ff],
    Cyrillic: [0x400, 0x4ff], Armenian: [0x530, 0x58f], Hebrew: [0x590, 0x5ff], Arabic: [0x600, 0x6ff], Syriac: [0x700, 0x74f], Thaana: [0x780, 0x7bf],
    Devanagari: [0x900, 0x97f], Bengali: [0x980, 0x9ff], Gurmukhi: [0xa00, 0xa7f], Gujarati: [0xa80, 0xaff], Oriya: [0xb00, 0xb7f], Tamil: [0xb80, 0xbff],
    Telugu: [0xc00, 0xc7f], Kannada: [0xc80, 0xcff], Malayalam: [0xd00, 0xd7f], Sinhala: [0xd80, 0xdff], Thai: [0xe00, 0xe7f], Lao: [0xe80, 0xeff],
    Tibetan: [0xf00, 0xfff], Myanmar: [0x1000, 0x109f], Georgian: [0x10a0, 0x10ff], HangulJamo: [0x1100, 0x11ff], Ethiopic: [0x1200, 0x137f],
    Cherokee: [0x13a0, 0x13ff], UnifiedCanadianAboriginalSyllabics: [0x1400, 0x167f], Ogham: [0x1680, 0x169f], Runic: [0x16a0, 0x16ff], Khmer: [0x1780, 0x17ff],
    Mongolian: [0x1800, 0x18af], LatinExtendedAdditional: [0x1e00, 0x1eff], GreekExtended: [0x1f00, 0x1fff], GeneralPunctuation: [0x2000, 0x206f],
    SuperscriptsandSubscripts: [0x2070, 0x209f], CurrencySymbols: [0x20a0, 0x20cf], CombiningMarksforSymbols: [0x20d0, 0x20ff], LetterlikeSymbols: [0x2100, 0x214f],
    NumberForms: [0x2150, 0x218f], Arrows: [0x2190, 0x21ff], MathematicalOperators: [0x2200, 0x22ff], MiscellaneousTechnical: [0x2300, 0x23ff], ControlPictures: [0x2400, 0x243f],
    OpticalCharacterRecognition: [0x2440, 0x245f], EnclosedAlphanumerics: [0x2460, 0x24ff], BoxDrawing: [0x2500, 0x257f], BlockElements: [0x2580, 0x259f],
    GeometricShapes: [0x25a0, 0x25ff], MiscellaneousSymbols: [0x2600, 0x26ff], Dingbats: [0x2700, 0x27bf], BraillePatterns: [0x2800, 0x28ff],
    CJKRadicalsSupplement: [0x2e80, 0x2eff], KangxiRadicals: [0x2f00, 0x2fdf], IdeographicDescriptionCharacters: [0x2ff0, 0x2fff], CJKSymbolsandPunctuation: [0x3000, 0x303f],
    Hiragana: [0x3040, 0x309f], Katakana: [0x30a0, 0x30ff], Bopomofo: [0x3100, 0x312f], HangulCompatibilityJamo: [0x3130, 0x318f], Kanbun: [0x3190, 0x319f],
    BopomofoExtended: [0x31a0, 0x31bf], EnclosedCJKLettersandMonths: [0x3200, 0x32ff], CJKCompatibility: [0x3300, 0x33ff], CJKUnifiedIdeographsExtensionA: [0x3400, 0x4db5],
    CJKUnifiedIdeographs: [0x4e00, 0x9fff], YiSyllables: [0xa000, 0xa48f], YiRadicals: [0xa490, 0xa4cf], HangulSyllables: [0xac00, 0xd7a3], PrivateUse: [0xe000, 0xf8ff],
    CJKCompatibilityIdeographs: [0xf900, 0xfaff], AlphabeticPresentationForms: [0xfb00, 0xfb4f], ArabicPresentationForms_A: [0xfb50, 0xfdff], CombiningHalfMarks: [0xfe20, 0xfe2f],
    CJKCompatibilityForms: [0xfe30, 0xfe4f], SmallFormVariants: [0xfe50, 0xfe6f], ArabicPresentationForms_B: [0xfe70, 0xfefe], Specials: [0xfeff, 0xfeff],
    HalfwidthandFullwidthForms: [0xff00, 0xffef], OldItalic: [0x10300, 0x1032f], Gothic: [0x10330, 0x1034f], Deseret: [0x10400, 0x1044f], ByzantineMusicalSymbols: [0x1d000, 0x1d0ff],
    MusicalSymbols: [0x1d100, 0x1d1ff], MathematicalAlphanumericSymbols: [0x1d400, 0x1d7ff], CJKUnifiedIdeographsExtensionB: [0x20000, 0x2a6d6],
    CJKCompatibilityIdeographsSupplement: [0x2f800, 0x2fa1f], Tags: [0xe0000, 0xe007f],
  };
  const XSD_SPACE_CLASS = ' \\t\\n\\r';
  const XSD_WORD_CLASS_NEG = '\\p{P}\\p{Z}\\p{C}';
  function ncNameClass(withColon, start) {
    const t = start ? NCNAME_START : NCNAME_CHAR;
    return rangesToClass(t, withColon ? ':' : '');
  }
  /** Translates an XSD 1.0 regular expression into an anchored JavaScript RegExp (flag u or v). */
  function translateXsdRegex(src) {
    let out = '', i = 0, needV = false;
    const JS_SPECIAL = '^$/';
    function escapeSeq(inClass) {
      // src[i] === '\\'
      const c = src[i + 1];
      if (c === undefined) throw new Error('XSD-Regex: unvollständige Escape-Sequenz');
      i += 2;
      switch (c) {
        case 'n': return '\\n';
        case 'r': return '\\r';
        case 't': return '\\t';
        case '\\': case '|': case '.': case '-': case '^': case '?': case '*': case '+': case '{': case '}': case '(': case ')': case '[': case ']':
          return '\\' + c;
        case 's': return inClass ? XSD_SPACE_CLASS : '[' + XSD_SPACE_CLASS + ']';
        case 'S': return inClass ? '\\P{Cc}' : '[^' + XSD_SPACE_CLASS + ']';
        case 'i': return inClass ? ncNameClass(true, true) : '[' + ncNameClass(true, true) + ']';
        case 'I': if (inClass) throw new Error('XSD-Regex: \\I in Zeichenklasse nicht unterstützt'); return '[^' + ncNameClass(true, true) + ']';
        case 'c': return inClass ? ncNameClass(true, false) : '[' + ncNameClass(true, false) + ']';
        case 'C': if (inClass) throw new Error('XSD-Regex: \\C in Zeichenklasse nicht unterstützt'); return '[^' + ncNameClass(true, false) + ']';
        case 'd': return '\\p{Nd}';
        case 'D': return '\\P{Nd}';
        case 'w': return inClass ? '\\P{P}\\P{Z}\\P{C}' : '[^' + XSD_WORD_CLASS_NEG + ']';
        case 'W': return inClass ? XSD_WORD_CLASS_NEG : '[' + XSD_WORD_CLASS_NEG + ']';
        case 'p': case 'P': {
          if (src[i] !== '{') throw new Error('XSD-Regex: \\p ohne {');
          const close = src.indexOf('}', i);
          if (close < 0) throw new Error('XSD-Regex: \\p{ ohne }');
          const name = src.slice(i + 1, close);
          i = close + 1;
          if (UNICODE_CATEGORIES.has(name)) return '\\' + c + '{' + name + '}';
          if (name.startsWith('Is')) {
            const b = UNICODE_BLOCKS[name.slice(2)];
            if (!b) throw new Error('XSD-Regex: unbekannter Unicode-Block ' + name);
            const cls = '\\u{' + b[0].toString(16) + '}-\\u{' + b[1].toString(16) + '}';
            if (c === 'p') return inClass ? cls : '[' + cls + ']';
            if (inClass) throw new Error('XSD-Regex: \\P{Is...} in Zeichenklasse nicht unterstützt');
            return '[^' + cls + ']';
          }
          throw new Error('XSD-Regex: unbekannte Kategorie ' + name);
        }
        default:
          throw new Error('XSD-Regex: unbekannte Escape-Sequenz \\' + c);
      }
    }
    function charClass() {
      // src[i] === '['
      i++;
      let body = '';
      let negated = false;
      if (src[i] === '^') { negated = true; i++; }
      let first = true;
      while (i < src.length) {
        const c = src[i];
        if (c === ']') { i++; break; }
        if (c === '-' && src[i + 1] === '[') {
          // character class subtraction
          i++;
          const sub = charClass();
          needV = true;
          return '[' + (negated ? '^' : '') + body + ']' .replace(/^\[/, '[') + '--' + sub;
        }
        if (c === '\\') { body += escapeSeq(true); first = false; continue; }
        if (c === '-' && !first && src[i + 1] !== ']' && src[i + 1] !== undefined) {
          // range a-b
          body += '-'; i++; continue;
        }
        if (c === '[') throw new Error('XSD-Regex: [ in Zeichenklasse');
        body += (c === '-' ? '\\-' : /[\^\]\\\/]/.test(c) ? '\\' + c : c);
        i++; first = false;
      }
      if (negated) return '[^' + body + ']';
      return '[' + body + ']';
    }
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { out += escapeSeq(false); continue; }
      if (c === '[') { out += charClass(); continue; }
      if (c === '.') { out += '[^\\n\\r]'; i++; continue; }
      if (JS_SPECIAL.indexOf(c) >= 0) { out += '\\' + c; i++; continue; }
      if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (!m) throw new Error('XSD-Regex: ungültiger Quantor');
        out += m[0]; i += m[0].length; continue;
      }
      out += c; i++;
    }
    if (needV) {
      // subtraction classes need the v flag: wrap simple classes as [..] already are; nested is [a--[b]]
      return new RegExp('^(?:' + out.replace(/\[([^\]]*)\]--\[/g, '[[$1]--[') + ')$', 'v');
    }
    return new RegExp('^(?:' + out + ')$', 'u');
  }

  // =============================================================================================
  // Simple types
  // =============================================================================================
  const PRIMITIVES = {
    string: 'preserve', boolean: 'collapse', decimal: 'collapse', float: 'collapse', double: 'collapse', duration: 'collapse',
    dateTime: 'collapse', time: 'collapse', date: 'collapse', gYearMonth: 'collapse', gYear: 'collapse', gMonthDay: 'collapse',
    gDay: 'collapse', gMonth: 'collapse', hexBinary: 'collapse', base64Binary: 'collapse', anyURI: 'collapse', QName: 'collapse',
    NOTATION: 'collapse', anySimpleType: 'preserve',
  };
  // built-in derived types: [base, whiteSpace override, extra lexical check name, facets]
  const DERIVED = {
    normalizedString: ['string', 'replace'], token: ['normalizedString', 'collapse'], language: ['token', null, 'language'],
    NMTOKEN: ['token', null, 'NMTOKEN'], Name: ['token', null, 'Name'], NCName: ['Name', null, 'NCName'], ID: ['NCName', null, 'ID'],
    IDREF: ['NCName', null, 'IDREF'], ENTITY: ['NCName', null, 'ENTITY'],
    integer: ['decimal', null, 'integer'],
    nonPositiveInteger: ['integer', null, null, { maxInclusive: '0' }], negativeInteger: ['nonPositiveInteger', null, null, { maxInclusive: '-1' }],
    long: ['integer', null, null, { minInclusive: '-9223372036854775808', maxInclusive: '9223372036854775807' }],
    int: ['long', null, null, { minInclusive: '-2147483648', maxInclusive: '2147483647' }],
    short: ['int', null, null, { minInclusive: '-32768', maxInclusive: '32767' }], byte: ['short', null, null, { minInclusive: '-128', maxInclusive: '127' }],
    nonNegativeInteger: ['integer', null, null, { minInclusive: '0' }],
    unsignedLong: ['nonNegativeInteger', null, null, { maxInclusive: '18446744073709551615' }], unsignedInt: ['unsignedLong', null, null, { maxInclusive: '4294967295' }],
    unsignedShort: ['unsignedInt', null, null, { maxInclusive: '65535' }], unsignedByte: ['unsignedShort', null, null, { maxInclusive: '255' }],
    positiveInteger: ['nonNegativeInteger', null, null, { minInclusive: '1' }],
  };
  const LISTS = { NMTOKENS: 'NMTOKEN', IDREFS: 'IDREF', ENTITIES: 'ENTITY' };

  const TYPE_LABELS = {
    decimal: 'Dezimalzahl', integer: 'ganze Zahl', boolean: 'Wahrheitswert (true/false/1/0)', date: 'Datum (JJJJ-MM-TT)',
    dateTime: 'Zeitstempel (JJJJ-MM-TTThh:mm:ss)', time: 'Uhrzeit (hh:mm:ss)', anyURI: 'URI', base64Binary: 'Base64-Daten',
    hexBinary: 'Hex-Daten', language: 'Sprachcode', float: 'Gleitkommazahl', double: 'Gleitkommazahl', duration: 'Zeitdauer',
    QName: 'qualifizierter Name', NOTATION: 'Notation', gYear: 'Jahr', gYearMonth: 'Jahr-Monat', gMonth: 'Monat', gMonthDay: 'Monat-Tag', gDay: 'Tag',
    ID: 'ID (NCName)', IDREF: 'IDREF (NCName)', NCName: 'NCName', Name: 'Name', NMTOKEN: 'NMTOKEN', ENTITY: 'ENTITY',
  };

  // =============================================================================================
  // create(model)
  // =============================================================================================
  function create(model) {
    if (!model || model.format !== 'erechnung-pruefer-xsd/1') throw new Error('xsd-validator: unsupported model format');
    const nsTable = model.ns;
    const nsIndex = new Map();
    nsTable.forEach((ns, i) => nsIndex.set(ns, i));
    const prefixes = nsTable.map((ns, i) => (ns === null ? '' : KNOWN_PREFIXES[ns] || 'ns' + i));
    const typeByName = new Map();
    model.types.forEach((t, i) => { if (t.n) typeByName.set(t.n, i); });
    const globalElements = model.elements;
    const globalAttributes = model.attributes || {};
    const substitution = model.substitutionGroups || {};
    const resolved = new Array(model.types.length).fill(null);
    const builtinCache = new Map();

    function keyOfNode(ns, local) {
      const i = nsIndex.get(ns || null);
      return (i === undefined ? '?' : i) + ':' + local;
    }
    function displayKey(key) {
      const i = key.indexOf(':');
      const p = prefixes[+key.slice(0, i)];
      return (p ? p + ':' : '') + key.slice(i + 1);
    }
    function displayNsc(nsc) {
      if (nsc.k === 'any') return '*:* (beliebiges Element)';
      if (nsc.k === 'other') return '*:* (Element aus einem anderen Namensraum als ' + (nsTable[nsc.ns] || '(kein)') + ')';
      return '*:* (Element aus Namensraum ' + nsc.ns.map((i) => nsTable[i] || '(kein Namensraum)').join(' | ') + ')';
    }

    // ---- simple types ------------------------------------------------------------------------
    function builtin(name) {
      if (builtinCache.has(name)) return builtinCache.get(name);
      let t;
      if (name === 'anyType') t = ANY_TYPE;
      else if (name in PRIMITIVES) {
        t = { kind: 'simple', name: 'xs:' + name, variety: 'atomic', primitive: name, builtin: name, ws: PRIMITIVES[name], facets: {}, base: name === 'anySimpleType' ? null : builtin('anySimpleType'), check: null };
      } else if (name in DERIVED) {
        const [baseName, ws, check, facets] = DERIVED[name];
        const base = builtin(baseName);
        t = { kind: 'simple', name: 'xs:' + name, variety: 'atomic', primitive: base.primitive, builtin: name, ws: ws || base.ws,
          facets: mergeFacets(base.facets, facets || {}, base), base, check: check || base.check };
      } else if (name in LISTS) {
        const item = builtin(LISTS[name]);
        t = { kind: 'simple', name: 'xs:' + name, variety: 'list', primitive: null, builtin: name, ws: 'collapse', facets: { minLength: 1 }, base: builtin('anySimpleType'), itemType: item, check: null };
      } else throw new Error('xsd-validator: unknown built-in type xs:' + name);
      builtinCache.set(name, t);
      return t;
    }
    function mergeFacets(baseFacets, own, baseType) {
      const f = Object.assign({}, baseFacets);
      for (const k of Object.keys(own)) {
        if (k === 'pattern') { f.pattern = (baseFacets.pattern || []).concat([own.pattern.map((p) => translateXsdRegex(p))]); }
        else if (k === 'enumeration') f.enumeration = own.enumeration;
        else f[k] = own[k];
      }
      return f;
    }

    const ANY_TYPE = {
      kind: 'complex', name: 'xs:anyType', abstract: false, mixed: true, contentType: 'mixed', simpleType: null,
      particle: ['s', 1, 1, [['w', { k: 'any' }, 'lax', 0, -1]]], attrUses: new Map(), attrWildcard: { ns: { k: 'any' }, pc: 'lax' },
      base: null, derivation: null, block: '', cm: null,
    };

    function typeOf(ref) {
      if (typeof ref === 'string') return builtin(ref.slice(3));
      if (resolved[ref]) return resolved[ref];
      const raw = model.types[ref];
      const t = raw.k === 's' ? resolveSimple(raw, ref) : resolveComplex(raw, ref);
      resolved[ref] = t;
      return t;
    }
    function resolveSimple(raw, ref) {
      const name = raw.n ? displayKey(raw.n) : '(anonymer Typ)';
      if (raw.list !== undefined) {
        const item = typeOf(raw.list);
        return { kind: 'simple', name, variety: 'list', primitive: null, builtin: null, ws: 'collapse', facets: {}, base: builtin('anySimpleType'), itemType: item, check: null, final: raw.final || '' };
      }
      if (raw.union !== undefined) {
        const members = raw.union.map(typeOf);
        return { kind: 'simple', name, variety: 'union', primitive: null, builtin: null, ws: 'collapse', facets: {}, base: builtin('anySimpleType'), members, check: null, final: raw.final || '' };
      }
      const base = typeOf(raw.b);
      return deriveSimple(name, base, raw.f || {}, raw.final || '');
    }
    function deriveSimple(name, base, facets, final_) {
      const t = { kind: 'simple', name, variety: base.variety, primitive: base.primitive, builtin: base.builtin, ws: facets.whiteSpace || base.ws,
        facets: mergeFacets(base.facets, facets, base), base, check: base.check, itemType: base.itemType, members: base.members, final: final_ || '' };
      if (t.facets.enumeration && !t.enumSet) {
        // normalise enumeration values the way instance values are normalised for comparison
        t.enumSet = new Set(t.facets.enumeration.map((v) => canonical(t, normalize(v, t.ws))));
      }
      return t;
    }

    /** canonical comparison key of a (normalised) lexical value, or null when not valid */
    function canonical(t, v) {
      if (t.variety === 'list') return v.split(' ').map((x) => canonical(t.itemType, x)).join(' ');
      if (t.variety === 'union') { for (const m of t.members) { const c = canonical(m, normalize(v, m.ws)); if (c !== null) return c; } return null; }
      switch (t.primitive) {
        case 'decimal': { const d = t.check === 'integer' ? parseInteger(v) : parseDecimal(v); return d ? d.canonical : null; }
        case 'boolean': return v === 'true' || v === '1' ? 'true' : v === 'false' || v === '0' ? 'false' : null;
        case 'float': case 'double': return FLOAT_RE.test(v) ? String(parseFloat(v.replace(/^\+/, '').replace('INF', 'Infinity'))) : null;
        case 'date': { const d = parseDate(v); return d ? dtKey(d) : null; }
        case 'dateTime': { const d = parseDateTime(v); return d ? dtKey(d) : null; }
        case 'time': { const d = parseTime(v); return d ? dtKey(d) : null; }
        case 'gYear': case 'gYearMonth': case 'gMonth': case 'gMonthDay': case 'gDay': { const d = parseGregorian(t.primitive, v); return d ? dtKey(d) : null; }
        case 'hexBinary': return HEX_RE.test(v) ? v.toUpperCase() : null;
        case 'base64Binary': return base64Length(v) >= 0 ? v.replace(/[ \t\n\r]/g, '') : null;
        default: return v;
      }
    }

    /**
     * Validates a lexical value (not yet normalised) against a simple type.
     * Returns { ok, value (normalised), reason } — reason is German.
     */
    function validateSimple(t, raw, ctx) {
      const value = normalize(raw, t.ws);
      if (t.variety === 'list') {
        const items = value.length ? value.split(' ') : [];
        for (const it of items) { const r = validateSimple(t.itemType, it, ctx); if (!r.ok) return { ok: false, value, code: r.code || 'cvc-datatype-valid.1.2.1' /* Xerces reports the item's own violation */, reason: 'Listeneintrag \'' + it + '\': ' + r.reason }; }
        const fr = checkFacets(t, value, items.length, null);
        return fr ? { ok: false, value, code: fr.code, reason: fr.reason } : { ok: true, value };
      }
      if (t.variety === 'union') {
        for (const m of t.members) { const r = validateSimple(m, raw, ctx); if (r.ok) { const fr = checkFacets(t, r.value, null, null); return fr ? { ok: false, value: r.value, code: fr.code, reason: fr.reason } : { ok: true, value: r.value }; } }
        return { ok: false, value, code: 'cvc-datatype-valid.1.2.3', reason: 'entspricht keinem der Union-Mitgliedstypen' };
      }
      let parsed = null;
      const label = TYPE_LABELS[t.builtin] || TYPE_LABELS[t.primitive] || t.primitive;
      switch (t.primitive) {
        case 'string': case 'anySimpleType': break;
        case 'decimal':
          parsed = t.check === 'integer' ? parseInteger(value) : parseDecimal(value);
          if (!parsed) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültige ' + label };
          break;
        case 'boolean': if (!(value === 'true' || value === 'false' || value === '1' || value === '0')) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger ' + label }; break;
        case 'float': case 'double': if (!FLOAT_RE.test(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültige ' + label }; break;
        case 'date': if (!parseDate(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiges ' + label }; break;
        case 'dateTime': if (!parseDateTime(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger ' + label }; break;
        case 'time': if (!parseTime(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültige ' + label }; break;
        case 'gYear': case 'gYearMonth': case 'gMonth': case 'gMonthDay': case 'gDay':
          if (!parseGregorian(t.primitive, value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger Wert des Typs xs:' + t.primitive }; break;
        case 'duration': if (!parseDuration(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültige ' + label }; break;
        case 'hexBinary': if (!HEX_RE.test(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültigen ' + label }; break;
        case 'base64Binary': if (base64Length(value) < 0) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültigen ' + label }; break;
        case 'anyURI': { const r = checkURI(value); if (r) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'keine gültige URI (' + r + ')' }; break; }
        case 'QName': case 'NOTATION': {
          const i = value.indexOf(':');
          const prefix = i < 0 ? null : value.slice(0, i), local = i < 0 ? value : value.slice(i + 1);
          if (!isValidNCName(local) || (prefix !== null && !isValidNCName(prefix))) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger ' + label };
          if (prefix !== null && ctx && ctx.node && ctx.node.lookupNamespaceURI(prefix) === null) return { ok: false, value, code: 'UndeclaredPrefix', reason: 'das Präfix \'' + prefix + '\' ist nicht deklariert' };
          break;
        }
        default: break;
      }
      switch (t.check) {
        case 'language': if (!/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/.test(value)) return { ok: false, value, code: 'cvc-pattern-valid', reason: 'kein gültiger Sprachcode (xs:language)' } /* Xerces: xs:language is a pattern facet of xs:token */; break;
        case 'NMTOKEN': if (!isValidNmtoken(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiges NMTOKEN' }; break;
        case 'Name': if (!isValidName(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger XML-Name' }; break;
        case 'NCName': case 'ID': case 'IDREF': case 'ENTITY': if (!isValidNCName(value)) return { ok: false, value, code: 'cvc-datatype-valid.1.2.1', reason: 'kein gültiger NCName (' + t.check + ')' }; break;
        default: break;
      }
      const fr = checkFacets(t, value, null, parsed);
      if (fr) return { ok: false, value, code: fr.code, reason: fr.reason };
      return { ok: true, value, parsed };
    }

    function stringLength(t, value) {
      if (t.primitive === 'hexBinary') return value.length / 2;
      if (t.primitive === 'base64Binary') return base64Length(value);
      // Xerces (JDK) measures string length facets in UTF-16 code units (String.length()):
      // '😀😀' has length 4 — verified against the oracle (probe token-length-9)
      return value.length;
    }
    function checkFacets(t, value, listLength, parsed) {
      const f = t.facets;
      if (f.pattern) {
        for (const group of f.pattern) if (!group.some((re) => re.test(value))) return { code: 'cvc-pattern-valid', reason: 'entspricht nicht dem Muster (pattern) des Typs ' + t.name };
      }
      if (f.length !== undefined || f.minLength !== undefined || f.maxLength !== undefined) {
        const len = listLength !== null ? listLength : stringLength(t, value);
        if (f.length !== undefined && len !== f.length) return { code: 'cvc-length-valid', reason: 'Länge ' + len + ' statt ' + f.length };
        if (f.minLength !== undefined && len < f.minLength) return { code: 'cvc-minLength-valid', reason: 'Länge ' + len + ' ist kleiner als minLength ' + f.minLength };
        if (f.maxLength !== undefined && len > f.maxLength) return { code: 'cvc-maxLength-valid', reason: 'Länge ' + len + ' ist größer als maxLength ' + f.maxLength };
      }
      if (t.enumSet) {
        const c = canonical(t, value);
        if (c === null || !t.enumSet.has(c)) return { code: 'cvc-enumeration-valid', reason: 'nicht in der Aufzählung (' + f.enumeration.join(', ') + ')' };
      }
      if (parsed) {
        if (f.totalDigits !== undefined && parsed.totalDigits > f.totalDigits) return { code: 'cvc-totalDigits-valid', reason: 'mehr als ' + f.totalDigits + ' Ziffern (totalDigits)' };
        if (f.fractionDigits !== undefined && parsed.fractionDigits > f.fractionDigits) return { code: 'cvc-fractionDigits-valid', reason: 'mehr als ' + f.fractionDigits + ' Nachkommastellen (fractionDigits)' };
        for (const k of ['minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive']) {
          if (f[k] === undefined) continue;
          const bound = parseDecimal(f[k]);
          if (!bound) continue;
          const c = compareDecimal(parsed, bound);
          if ((k === 'minInclusive' && c < 0) || (k === 'maxInclusive' && c > 0) || (k === 'minExclusive' && c <= 0) || (k === 'maxExclusive' && c >= 0)) return { code: 'cvc-' + k + '-valid', reason: 'außerhalb des Wertebereichs (' + k + ' ' + f[k] + ')' };
        }
      } else if (t.primitive !== 'decimal' && (f.minInclusive !== undefined || f.maxInclusive !== undefined || f.minExclusive !== undefined || f.maxExclusive !== undefined)) {
        // ordered non-decimal types (dates, floats): compare canonical keys lexically where possible
        const c = canonical(t, value);
        for (const k of ['minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive']) {
          if (f[k] === undefined) continue;
          const b = canonical(t, normalize(f[k], t.ws));
          if (b === null || c === null) continue;
          const cmp = t.primitive === 'float' || t.primitive === 'double' ? Math.sign(parseFloat(c) - parseFloat(b)) : compareKeys(c, b);
          if ((k === 'minInclusive' && cmp < 0) || (k === 'maxInclusive' && cmp > 0) || (k === 'minExclusive' && cmp <= 0) || (k === 'maxExclusive' && cmp >= 0)) return { code: 'cvc-' + k + '-valid', reason: 'außerhalb des Wertebereichs (' + k + ' ' + f[k] + ')' };
        }
      }
      return null;
    }
    function compareKeys(a, b) {
      const pa = a.split('|'), pb = b.split('|');
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        const x = parseFloat(pa[i]), y = parseFloat(pb[i]);
        if (isNaN(x) || isNaN(y)) continue;
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    }

    // ---- complex types -----------------------------------------------------------------------
    function resolveComplex(raw, ref) {
      const name = raw.n ? displayKey(raw.n) : '(anonymer Typ)';
      const t = { kind: 'complex', name, abstract: !!raw.abs, mixed: !!raw.mixed, contentType: 'empty', simpleType: null, particle: null,
        attrUses: new Map(), attrWildcard: null, base: null, derivation: raw.der || null, block: raw.block || '', final: raw.final || '', cm: null, anyPos: null };
      resolved[ref] = t;      // allow recursive references while resolving
      let base = null;
      if (raw.b !== undefined) base = typeOf(raw.b);
      t.base = base;
      // attributes
      if (base && base.kind === 'complex') {
        for (const [k, u] of base.attrUses) t.attrUses.set(k, u);
        t.attrWildcard = base.attrWildcard;
      }
      if (raw.a) {
        for (const a of raw.a) {
          const key = a.r || a.n;
          if (a.u === 'p') { t.attrUses.delete(key); continue; }
          const decl = a.r ? globalAttributes[a.r] : null;
          t.attrUses.set(key, { key, type: typeOf(a.r ? decl.t : a.t), required: a.u === 'r', fixed: a.fixed !== undefined ? a.fixed : (decl && decl.fixed !== undefined ? decl.fixed : undefined), fixedUse: a.fixed, fixedDecl: a.r && decl ? decl.fixed : undefined, def: a.def !== undefined ? a.def : (decl ? decl.def : undefined) });
        }
      }
      if (raw.aw) {
        if (raw.der === 'e' && base && base.kind === 'complex' && base.attrWildcard) t.attrWildcard = { ns: unionNsc(raw.aw.ns, base.attrWildcard.ns), pc: raw.aw.pc };
        else t.attrWildcard = raw.aw;
      } else if (raw.der === 'r') t.attrWildcard = null;
      // content
      if (raw.sc) {
        t.contentType = 'simple';
        let st;
        if (base.kind === 'simple') st = base;
        else if (base.contentType === 'simple') st = base.simpleType;
        else if (base.contentType === 'mixed' && raw.der === 'r' && raw.st !== undefined) st = typeOf(raw.st);
        else throw new Error('xsd-validator: simpleContent derived from a type without simple content: ' + name);
        if (raw.der === 'r') {
          if (raw.st !== undefined) st = typeOf(raw.st);
          if (raw.sf) st = deriveSimple(name, st, raw.sf, '');
        }
        t.simpleType = st;
      } else if (raw.der && base && base.kind === 'complex') {
        if (raw.der === 'e') {
          if (raw.p === undefined && !raw.mixed) {
            t.contentType = base.contentType; t.particle = base.particle; t.simpleType = base.simpleType; t.mixed = base.mixed;
          } else {
            const parts = [];
            if (base.particle) parts.push(base.particle);
            if (raw.p !== undefined) parts.push(raw.p);
            t.particle = parts.length === 1 ? parts[0] : ['s', 1, 1, parts];
            t.mixed = !!raw.mixed || base.mixed;
            t.contentType = t.mixed ? 'mixed' : 'elementOnly';
          }
        } else {
          t.particle = raw.p !== undefined ? raw.p : null;
          t.contentType = t.particle ? (t.mixed ? 'mixed' : 'elementOnly') : (t.mixed ? 'mixed' : 'empty');
        }
      } else {
        t.particle = raw.p !== undefined ? raw.p : null;
        t.contentType = t.particle ? (t.mixed ? 'mixed' : 'elementOnly') : (t.mixed ? 'mixed' : 'empty');
      }
      return t;
    }
    function unionNsc(a, b) {
      if (a.k === 'any' || b.k === 'any') return { k: 'any' };
      if (a.k === 'other' && b.k === 'other') return a.ns === b.ns ? a : { k: 'any' };
      if (a.k === 'list' && b.k === 'list') return { k: 'list', ns: [...new Set(a.ns.concat(b.ns))] };
      const other = a.k === 'other' ? a : b, list = a.k === 'other' ? b : a;
      if (list.ns.includes(other.ns)) return list.ns.includes(0) ? { k: 'any' } : { k: 'any' };
      return other;
    }
    function nscAllows(nsc, nsIdx) {
      if (nsc.k === 'any') return true;
      if (nsc.k === 'other') return nsIdx !== 0 && nsIdx !== nsc.ns;     // '?' (namespace unknown to the schema set) is "other"
      return nsc.ns.includes(nsIdx);
    }

    // ---- content model automata (Glushkov) ---------------------------------------------------
    function elementDeclOfParticle(p) {
      if (p[0] === 'r') {
        const d = globalElements[p[1]];
        if (!d) throw new Error('xsd-validator: unresolved element reference ' + p[1]);
        return { key: p[1], type: d.t, nil: !!d.nil, abs: !!d.abs, fixed: d.fixed, def: d.def, block: d.block || '', global: true };
      }
      const f = p[5] || {};
      return { key: p[1], type: p[2], nil: !!f.nil, abs: !!f.abs, fixed: f.fixed, def: f.def, block: f.block || '', global: false };
    }
    /**
     * Glushkov position automaton -> DFA by subset construction. Bounded repetitions
     * (maxOccurs=n) are unrolled into n copies of the particle, so one DFA state may hold several
     * positions carrying the same element name; they stem from the same particle and therefore
     * carry the same declaration — a genuine Unique Particle Attribution violation (two different
     * particles competing for one name) is reported, Xerces would have rejected such a schema.
     */
    function finish(rootNode, positions) {
      const states = [];
      const index = new Map();          // sorted position ids -> state number
      const sameDecl = (a, b) => a.key === b.key && a.type === b.type && a.nil === b.nil && a.abs === b.abs && a.fixed === b.fixed && a.def === b.def;
      // a DFA state is the set of positions that matched the last child element (the start
      // state is the empty set with the first-set as its targets)
      function stateFor(set, isStart) {
        const ids = [...set].sort((x, y) => x - y);
        const k = (isStart ? 'S' : '') + ids.join(',');
        if (index.has(k)) return index.get(k);
        const id = states.length;
        index.set(k, id);
        let accept = isStart ? rootNode.nullable : false;
        if (!isStart) for (const p of ids) if (rootNode.last.has(p)) accept = true;
        // occurrence information of a counting state (the last child matched a repeating leaf)
        let occ = null;
        if (!isStart) for (const p of ids) if (positions[p].rep) { occ = positions[p].rep; break; }
        const st = { map: new Map(), wild: [], accept, expected: null, occ };
        states.push(st);
        const targets = new Set();
        if (isStart) for (const q of rootNode.first) targets.add(q);
        else for (const p of ids) for (const q of positions[p].follow) targets.add(q);
        // group the target positions by symbol
        const byKey = new Map();          // element key -> {decl, set}
        const byWild = new Map();         // nsc/pc signature -> {nsc, pc, set}
        for (const qid of [...targets].sort((x, y) => x - y)) {
          const q = positions[qid];
          if (q.sym.kind === 'e') {
            const keys = [q.sym.decl.key].concat(substitution[q.sym.decl.key] || []);
            for (const key of keys) {
              const decl = key === q.sym.decl.key ? q.sym.decl : elementDeclOfParticle(['r', key, 1, 1]);
              let g = byKey.get(key);
              if (!g) { g = { decl, set: new Set() }; byKey.set(key, g); }
              else if (!sameDecl(g.decl, decl)) throw new Error('xsd-validator: content model is not deterministic (UPA) at ' + displayKey(key));
              g.set.add(qid);
            }
          } else {
            const sig = JSON.stringify(q.sym.nsc) + '|' + q.sym.pc;
            let g = byWild.get(sig);
            if (!g) { g = { nsc: q.sym.nsc, pc: q.sym.pc, set: new Set() }; byWild.set(sig, g); }
            g.set.add(qid);
          }
        }
        const boundOf = (set) => { for (const qid of set) if (positions[qid].bound) return positions[qid].bound; return null; };
        for (const [key, g] of byKey) st.map.set(key, { next: stateFor(g.set, false), decl: g.decl, bound: boundOf(g.set) });
        for (const g of byWild.values()) st.wild.push({ next: stateFor(g.set, false), nsc: g.nsc, pc: g.pc, bound: boundOf(g.set) });
        return id;
      }
      stateFor(new Set(), true);
      // Xerces-like recovery: any declaration anywhere in this content model
      const anyPos = new Map();
      const anyWild = [];
      for (const p of positions) {
        if (p.sym.kind === 'e') { if (!anyPos.has(p.sym.decl.key)) anyPos.set(p.sym.decl.key, p.sym.decl); for (const k of substitution[p.sym.decl.key] || []) if (!anyPos.has(k)) anyPos.set(k, elementDeclOfParticle(['r', k, 1, 1])); }
        else anyWild.push({ nsc: p.sym.nsc, pc: p.sym.pc });
      }
      return { states, anyPos, anyWild };
    }
    function contentModel(t) {
      if (!t.cm) t.cm = buildAutomaton(t.particle);
      return t.cm;
    }
    function buildAutomaton(particle) {
      const positions = [];
      const EMPTY = Object.freeze(new Set());
      function pos(sym) { const p = { id: positions.length, sym, follow: new Set() }; positions.push(p); return p; }
      const node = (first, last, nullable) => ({ first, last, nullable });
      function seq2(a, b) {
        for (const p of a.last) for (const q of b.first) positions[p].follow.add(q);
        const first = new Set(a.first); if (a.nullable) for (const q of b.first) first.add(q);
        const last = new Set(b.last); if (b.nullable) for (const p of a.last) last.add(p);
        return node(first, last, a.nullable && b.nullable);
      }
      function seqOf(nodes) { let acc = node(EMPTY, EMPTY, true); for (const n of nodes) acc = seq2(acc, n); return acc; }
      function choice(nodes) {
        const first = new Set(), last = new Set(); let nullable = nodes.length === 0;
        for (const n of nodes) { for (const x of n.first) first.add(x); for (const x of n.last) last.add(x); nullable = nullable || n.nullable; }
        return node(first, last, nullable);
      }
      function star(n) { for (const p of n.last) for (const q of n.first) positions[p].follow.add(q); return node(n.first, n.last, true); }
      function plus(n) { for (const p of n.last) for (const q of n.first) positions[p].follow.add(q); return node(n.first, n.last, n.nullable); }
      function term(p, optimizeKids) {
        switch (p[0]) {
          case 'e': case 'r': { const q = pos({ kind: 'e', decl: elementDeclOfParticle(p) }); return node(new Set([q.id]), new Set([q.id]), false); }
          case 'w': { const q = pos({ kind: 'w', nsc: p[1], pc: p[2] }); return node(new Set([q.id]), new Set([q.id]), false); }
          case 's': return seqOf(p[3].map((k) => particleNode(k, optimizeKids)));
          case 'c': return choice(p[3].map((k) => particleNode(k, optimizeKids)));
          default: throw new Error('xsd-validator: unknown particle kind ' + p[0]);
        }
      }
      const isLeaf = (p) => p[0] === 'e' || p[0] === 'r' || p[0] === 'w';
      const minOf = (p) => p[0] === 'e' ? p[3] : p[0] === 'r' ? p[2] : p[0] === 'w' ? p[3] : p[1];
      const maxOf = (p) => p[0] === 'e' ? p[4] : p[0] === 'r' ? p[3] : p[0] === 'w' ? p[4] : p[2];
      // Xerces (CMBuilder.useRepeatingLeafNodes): a content model whose repeated groups contain at most one
      // leaf with occurrence 1..1 is built with counting "repeating leaves" for element/wildcard particles
      // with minOccurs > 1 or a bounded maxOccurs > 1. Their DFA states carry occurrence information, which
      // Xerces uses for the error codes cvc-complex-type.2.4.e/f (maxOccurs exceeded) and 2.4.i/j (minOccurs
      // not reached). The unrolled copies of such a particle are numbered here so that the same
      // information is available in the subset automaton.
      function useRepeatingLeafNodes(p) {
        if (isLeaf(p)) return true;
        const kids = p[3] || [];
        if (minOf(p) !== 1 || maxOf(p) !== 1) {
          if (kids.length === 1) return isLeaf(kids[0]) && minOf(kids[0]) === 1 && maxOf(kids[0]) === 1;
          return kids.length === 0;
        }
        return kids.every(useRepeatingLeafNodes);
      }
      const counting = particle ? useRepeatingLeafNodes(particle) : false;
      let repeatingId = 0;
      const bounded = []; // JDK constant-space algorithm: subsumed e{n,m} leaves, checked at the end of the content
      /**
       * optimize: JDK CMBuilder.buildSyntaxTree(particle, forUPA, optimize) — true at the top and passed to
       * the children of a group only while the group occurs exactly once and is a sequence (or has one
       * particle). An element leaf e{n,m} that is not one of the four trivial forms is then subsumed to
       * e* / e+ and its count is checked when the content is complete (checkMinMaxBounds: 2.4.b / 2.4.d);
       * because of an operator-precedence quirk in the JDK (`optimize && type == ELEMENT || type == WILDCARD`)
       * wildcard leaves are subsumed even when optimize is false.
       */
      function particleNode(p, optimize) {
        if (optimize === undefined) optimize = true;
        let min = minOf(p);
        let max = maxOf(p);
        if (max === 0) return node(EMPTY, EMPTY, true);
        // compact syntax tree (CMBuilder.buildCompactSyntaxTree): a group with a single particle and an
        // occurrence other than 1..1 becomes that particle with the group's occurrence
        if (counting && !isLeaf(p) && (p[3] || []).length === 1 && (min !== 1 || max !== 1)) {
          const k = p[3][0];
          const inner = k[0] === 'e' ? [k[0], k[1], k[2], min, max].concat(k.slice(5)) : k[0] === 'r' ? [k[0], k[1], min, max].concat(k.slice(4)) : [k[0], k[1], k[2], min, max].concat(k.slice(5));
          return particleNode(inner, optimize);
        }
        const trivial = (min === 1 && max === 1) || (min === 0 && max === 1) || (min === 0 && max === -1) || (min === 1 && max === -1);
        if (!counting && isLeaf(p) && !trivial && ((optimize && p[0] !== 'w') || p[0] === 'w')) {
          const n = term(p);
          const b = { id: bounded.length, min, max, label: null, q: [...n.first][0] };
          bounded.push(b);
          for (const q of n.first) positions[q].bound = b;
          return min === 0 ? star(n) : plus(n);
        }
        const optimizeKids = optimize && min === 1 && max === 1 && (p[0] === 's' || (p[3] || []).length === 1);
        const parts = [];
        const repeating = counting && isLeaf(p) && (min > 1 || (max !== -1 && max > 1)) ? { id: ++repeatingId, min, max } : null;
        const leaf = (k) => { const n = term(p, optimizeKids); if (repeating) for (const q of n.first) positions[q].rep = { id: repeating.id, min, max, count: k }; return n; };
        if (max === -1) {
          if (min === 0) parts.push(star(leaf(1)));
          else { for (let i = 0; i < min - 1; i++) parts.push(leaf(i + 1)); parts.push(plus(leaf(min))); }
        } else {
          for (let i = 0; i < min; i++) parts.push(leaf(i + 1));
          for (let i = min; i < max; i++) { const n = leaf(i + 1); parts.push(node(n.first, n.last, true)); }
        }
        return seqOf(parts);
      }
      const rootNode = particle ? particleNode(particle, true) : node(EMPTY, EMPTY, true);
      const cm = finish(rootNode, positions);
      for (const b of bounded) { const q = positions[b.q]; b.label = q.sym.kind === 'e' ? displayKey(q.sym.decl.key) : displayNsc(q.sym.nsc); }
      cm.bounded = bounded;
      return cm;
    }
    function expectedOf(st) {
      if (st.expected === null) {
        const names = [];
        for (const k of st.map.keys()) names.push(displayKey(k));
        for (const w of st.wild) names.push(displayNsc(w.nsc));
        st.expected = names.join(', ');
      }
      return st.expected;
    }

    // ---- validation --------------------------------------------------------------------------
    function nodeLocation(node) {
      const parts = [];
      let n = node;
      while (n && n.nodeType !== 9) {
        if (n.nodeType === 2) { parts.unshift('@' + n.nodeName); n = n.ownerElement; continue; }
        if (n.nodeType === 1) {
          let idx = 1;
          for (let s = n.previousSibling; s; s = s.previousSibling) if (s.nodeType === 1 && s.nodeName === n.nodeName) idx++;
          parts.unshift(n.nodeName + '[' + idx + ']');
        }
        n = n.parentNode;
      }
      return '/' + parts.join('/');
    }

    function validate(doc, options) {
      const errors = [];
      const ids = new Map();           // id value -> true
      const idrefs = [];               // {value, node}
      const maxErrors = (options && options.maxErrors) || 1000;
      let stopped = false;
      function report(code, node, message) {
        if (errors.length >= maxErrors) { stopped = true; return; }
        errors.push({ code, message, location: nodeLocation(node), line: null });
      }

      const docEl = doc.nodeType === 9 ? doc.documentElement : doc;
      if (!docEl) return { valid: false, errors: [{ code: 'xml', message: 'Das Dokument hat kein Wurzelelement.', location: '/', line: null }] };
      const rootKey = keyOfNode(docEl.namespaceURI, docEl.localName);
      const rootDecl = globalElements[rootKey];
      if (!rootDecl) {
        // Xerces: cvc-elt.1.a, and no further assessment (unless xsi:type is given — same as Xerces)
        const xsiType = docEl.getAttributeNS(XSI, 'type');
        if (!xsiType) {
          report('cvc-elt.1.a', docEl, 'Für das Wurzelelement \'' + docEl.nodeName + '\' (Namensraum ' + (docEl.namespaceURI || '(keiner)') + ') gibt es keine Deklaration im Schema.');
          return { valid: false, errors };
        }
        validateElement(docEl, null, null);
      } else {
        validateElement(docEl, { key: rootKey, type: rootDecl.t, nil: !!rootDecl.nil, abs: !!rootDecl.abs, fixed: rootDecl.fixed, def: rootDecl.def, block: rootDecl.block || '', global: true }, null);
      }
      for (const r of idrefs) if (!ids.has(r.value)) report('cvc-id.1', r.node, 'Es gibt kein Element mit der ID \'' + r.value + '\' (IDREF).');
      return { valid: errors.length === 0, errors, truncated: stopped };

      function valueError(node, isAttr, attrName, value, t, reason, complexContent, code) {
        const shown = value.length > 60 ? value.slice(0, 57) + '...' : value;
        // Xerces reports the datatype/facet violation first (cvc-datatype-valid.1.2.x, cvc-pattern-valid,
        // cvc-maxLength-valid, ...) and then the violation of the element/attribute (cvc-type.3.1.3,
        // cvc-complex-type.2.2, cvc-attribute.3); both are reported here, in the same order
        if (code) report(code, node, 'Der Wert \'' + shown + '\' ist kein gültiger Wert des Typs ' + t.name + ': ' + reason + '.');
        if (isAttr) report('cvc-attribute.3', node, 'Der Wert \'' + shown + '\' des Attributs \'' + attrName + '\' im Element \'' + node.ownerElement.nodeName + '\' ist kein gültiger Wert des Typs ' + t.name + ' (' + reason + ').');
        else report(complexContent ? 'cvc-complex-type.2.2' : 'cvc-type.3.1.3', node, 'Der Wert \'' + shown + '\' des Elements \'' + node.nodeName + '\' ist kein gültiger Wert des Typs ' + t.name + ' (' + reason + ').');
      }

      /** validates a simple value, handles ID/IDREF bookkeeping; returns the normalised value or null */
      function checkValue(t, raw, node, isAttr, attrName, complexContent) {
        const r = validateSimple(t, raw, { node: isAttr ? node.ownerElement : node });
        if (!r.ok) { valueError(node, isAttr, attrName, raw, t, r.reason, complexContent, r.code || 'cvc-datatype-valid.1.2.1'); return null; }
        if (t.builtin === 'ID' || t.builtin === 'IDREF' || t.builtin === 'IDREFS') {
          const items = t.builtin === 'IDREFS' ? r.value.split(' ') : [r.value];
          for (const v of items) {
            if (t.builtin === 'ID') { if (ids.has(v)) { report('cvc-id.2', node, 'Der ID-Wert \'' + v + '\' kommt mehrfach vor.'); valueError(node, isAttr, attrName, raw, t, 'der ID-Wert ist nicht eindeutig', complexContent, null); } else ids.set(v, true); }
            else idrefs.push({ value: v, node });
          }
        }
        return r.value;
      }

      function resolveXsiType(el, value, declType, decl) {
        const q = wsCollapse(value);
        const i = q.indexOf(':');
        const prefix = i < 0 ? null : q.slice(0, i), local = i < 0 ? q : q.slice(i + 1);
        if (!isValidNCName(local) || (prefix !== null && !isValidNCName(prefix))) {
          report('cvc-elt.4.1', el, 'Der Wert \'' + q + '\' von xsi:type im Element \'' + el.nodeName + '\' ist kein gültiger QName.');
          return undefined;
        }
        const ns = el.lookupNamespaceURI(prefix);
        if (prefix !== null && ns === null) {
          // Xerces: UndeclaredPrefix + cvc-elt.4.1 (element step) and UndeclaredPrefix + cvc-attribute.3 (attribute step)
          const why = 'Das Präfix \'' + prefix + '\' von xsi:type=\'' + q + '\' im Element \'' + el.nodeName + '\' ist nicht deklariert.';
          report('UndeclaredPrefix', el, why);
          report('cvc-elt.4.1', el, 'Der Wert \'' + q + '\' von xsi:type im Element \'' + el.nodeName + '\' ist kein gültiger QName.');
          report('UndeclaredPrefix', el, why);
          report('cvc-attribute.3', el, 'Der Wert \'' + q + '\' des Attributs xsi:type im Element \'' + el.nodeName + '\' ist kein gültiger Wert des Typs QName.');
          return undefined;
        }
        let t = null;
        if (ns === XS) { try { t = builtin(local); } catch (e) { t = null; } }
        else { const idx = typeByName.get(keyOfNode(ns, local)); if (idx !== undefined) t = typeOf(idx); }
        if (!t) {
          report('cvc-elt.4.2', el, 'Der Typ \'' + q + '\' (xsi:type im Element \'' + el.nodeName + '\') ist im Schema nicht definiert.');
          return undefined;
        }
        if (declType) {
          // cvc-elt.4.3: the local type must be validly derived from the declared type, and no
          // step of the derivation chain may be blocked by the element's or the type's block
          // ({disallowed substitutions} / {prohibited substitutions}); nothing is blocked in the
          // invoice schemas
          let ok = declType === ANY_TYPE || t === declType;
          if (!ok) {
            const blocks = ((decl && decl.block) || '') + ' ' + (declType.block || '');
            const blockExt = /extension|#all/.test(blocks), blockRes = /restriction|#all/.test(blocks);
            let x = t, blocked = false;
            while (x && x !== declType) {
              const der = x.kind === 'complex' ? (x.derivation || 'r') : 'r';
              if ((der === 'e' && blockExt) || (der === 'r' && blockRes)) blocked = true;
              x = x.base;
            }
            ok = x === declType && !blocked;
          }
          if (!ok) {
            report('cvc-elt.4.3', el, 'Der Typ \'' + q + '\' (xsi:type) ist nicht gültig vom deklarierten Typ ' + declType.name + ' des Elements \'' + el.nodeName + '\' abgeleitet.');
            return t; // Xerces continues the assessment with the xsi:type's type definition
          }
        }
        return t;
      }

      /**
       * decl: element declaration ({key,type,nil,abs,fixed,def,block}) or null (element matched by a
       * lax/strict wildcard without declaration but with xsi:type). typeOverride: for the latter.
       */
      function validateElement(el, decl, typeOverride) {
        if (stopped) return;
        let type = typeOverride || (decl ? typeOf(decl.type) : null);
        // xsi attributes
        let xsiType = null, xsiNil = null;
        const attrs = el.attributes;
        for (let i = 0; i < attrs.length; i++) {
          const a = attrs[i];
          if (a.namespaceURI === XSI) {
            if (a.localName === 'type') xsiType = a.value;
            else if (a.localName === 'nil') xsiNil = a.value;
          }
        }
        if (decl && decl.abs) report('cvc-elt.2', el, 'Das Element \'' + el.nodeName + '\' ist abstrakt deklariert und darf in einer Instanz nicht vorkommen.');
        if (xsiType !== null) {
          const t = resolveXsiType(el, xsiType, type, decl);
          if (t === undefined) { if (!type) return; }
          else type = t;
        }
        if (!type) return;      // nothing known about this element (lax wildcard): not assessed
        if (type.kind === 'complex' && type.abstract) report('cvc-type.2', el, 'Der Typ ' + type.name + ' des Elements \'' + el.nodeName + '\' ist abstrakt und kann nicht direkt verwendet werden.');
        let nilled = false;
        if (xsiNil !== null) {
          if (decl && !decl.nil) report('cvc-elt.3.1', el, 'Das Attribut xsi:nil ist im Element \'' + el.nodeName + '\' nicht erlaubt (das Element ist nicht als nillable deklariert).');
          else {
            const v = wsCollapse(xsiNil);
            if (v === 'true' || v === '1') {
              nilled = true;
              if (decl && decl.fixed !== undefined) report('cvc-elt.3.2.2', el, 'Das Element \'' + el.nodeName + '\' hat einen festen Wert und darf nicht xsi:nil=\'true\' sein.');
            } else if (!(v === 'false' || v === '0')) { report('cvc-datatype-valid.1.2.1', el, 'Der Wert \'' + xsiNil + '\' ist kein gültiger Wert des Typs xs:boolean.'); report('cvc-attribute.3', el, 'Der Wert \'' + xsiNil + '\' von xsi:nil im Element \'' + el.nodeName + '\' ist kein gültiger Wahrheitswert.'); }
          }
        }
        // attributes
        if (type.kind === 'simple') {
          for (let i = 0; i < attrs.length; i++) {
            const a = attrs[i];
            if (a.namespaceURI === XMLNS || a.name === 'xmlns') continue;
            if (a.namespaceURI === XSI) { checkXsiAttribute(a, el); continue; }
            report('cvc-type.3.1.1', a, 'Das Element \'' + el.nodeName + '\' hat einen einfachen Typ (' + type.name + ') und darf keine Attribute haben (außer xsi:*); gefunden: \'' + a.name + '\'.');
          }
        } else {
          let seen = null;
          for (let i = 0; i < attrs.length; i++) {
            const a = attrs[i];
            if (a.namespaceURI === XMLNS || a.name === 'xmlns') continue;
            if (a.namespaceURI === XSI && (a.localName === 'type' || a.localName === 'nil' || a.localName === 'schemaLocation' || a.localName === 'noNamespaceSchemaLocation')) { checkXsiAttribute(a, el); continue; }
            const key = keyOfNode(a.namespaceURI, a.localName);
            const use = type.attrUses.get(key);
            if (use) {
              (seen || (seen = new Set())).add(key);
              const v = checkValue(use.type, a.value, a, true, a.name);
              if (v !== null && use.fixed !== undefined) {
                // Xerces (XMLSchemaValidator.processOneAttribute): a fixed value of the attribute DECLARATION
                // (a global attribute referenced with ref=) is cvc-attribute.4, a fixed value of the attribute
                // USE (local attribute or ref with fixed=) is cvc-complex-type.3.1
                const differs = (fx) => fx !== undefined && canonical(use.type, v) !== canonical(use.type, normalize(fx, use.type.ws));
                const msg = (fx) => 'Der Wert \'' + a.value + '\' des Attributs \'' + a.name + '\' im Element \'' + el.nodeName + '\' entspricht nicht dem festen Wert \'' + fx + '\'.';
                if (differs(use.fixedDecl)) report('cvc-attribute.4', a, msg(use.fixedDecl));
                if (differs(use.fixedUse)) report('cvc-complex-type.3.1', a, msg(use.fixedUse));
              }
              continue;
            }
            const w = type.attrWildcard;
            const nsI = nsIndex.get(a.namespaceURI || null);
            if (!w || !nscAllows(w.ns, nsI === undefined ? '?' : nsI)) {
              report('cvc-complex-type.3.2.2', a, 'Das Attribut \'' + a.name + '\' ist im Element \'' + el.nodeName + '\' nicht erlaubt.');
              continue;
            }
            if (w.pc === 'skip') continue;
            const gd = nsI === undefined ? null : globalAttributes[key];
            if (!gd) {
              if (w.pc === 'strict') report('cvc-complex-type.3.2.2', a, 'Das Attribut \'' + a.name + '\' ist im Element \'' + el.nodeName + '\' nicht erlaubt (strikter Attribut-Wildcard ohne globale Deklaration).');
              continue;
            }
            const gt = typeOf(gd.t);
            const v = checkValue(gt, a.value, a, true, a.name);
            if (v !== null && gd.fixed !== undefined && canonical(gt, v) !== canonical(gt, normalize(gd.fixed, gt.ws))) report('cvc-attribute.4', a, 'Der Wert \'' + a.value + '\' des Attributs \'' + a.name + '\' im Element \'' + el.nodeName + '\' entspricht nicht dem festen Wert \'' + gd.fixed + '\'.');
          }
          for (const [key, use] of type.attrUses) {
            if (use.required && !(seen && seen.has(key))) report('cvc-complex-type.4', el, 'Das Pflichtattribut \'' + displayKey(key) + '\' fehlt im Element \'' + el.nodeName + '\'.');
          }
        }
        // content
        if (nilled) {
          // Xerces (cvc-elt.3.2.1): no element and no character children at all — whitespace included
          for (let c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 || ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.length)) {
              report('cvc-elt.3.2.1', el, 'Das Element \'' + el.nodeName + '\' ist mit xsi:nil=\'true\' gekennzeichnet und darf keinen Inhalt haben.');
              break;
            }
          }
          return;
        }
        if (type.kind === 'simple' || type.contentType === 'simple') {
          const st = type.kind === 'simple' ? type : type.simpleType;
          let text = '';
          let childError = false;
          for (let c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue;
            else if (c.nodeType === 1 && !childError) {
              childError = true;
              report(type.kind === 'simple' ? 'cvc-type.3.1.2' : 'cvc-complex-type.2.2', el, 'Das Element \'' + el.nodeName + '\' hat einfachen Inhalt (' + st.name + ') und darf keine Kindelemente enthalten; gefunden: \'' + c.nodeName + '\'.');
            }
          }
          if (childError) return;
          let sawText = false;
          for (let c = el.firstChild; c; c = c.nextSibling) if ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.length) { sawText = true; break; }
          if (!sawText && decl && (decl.fixed !== undefined || decl.def !== undefined)) {
            // XSD 1.0 §3.3.4 cl. 5.1 / Xerces: an element without character children takes its
            // fixed/default value as actual value (whitespace counts as character children)
            checkValue(st, decl.fixed !== undefined ? decl.fixed : decl.def, el, false, null, type.kind === 'complex');
            return;
          }
          const v = checkValue(st, text, el, false, null, type.kind === 'complex');
          if (v !== null && decl && decl.fixed !== undefined && canonical(st, v) !== canonical(st, normalize(decl.fixed, st.ws))) {
            report('cvc-elt.5.2.2.2.2', el, 'Der Wert \'' + text + '\' des Elements \'' + el.nodeName + '\' entspricht nicht dem festen Wert \'' + decl.fixed + '\'.');
          }
          return;
        }
        if (type.contentType === 'empty') {
          // Xerces (cvc-complex-type.2.1): no element and no character children at all — whitespace included
          for (let c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 || ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.length)) {
              report('cvc-complex-type.2.1', el, 'Das Element \'' + el.nodeName + '\' darf keinen Inhalt haben (leerer Inhaltstyp ' + type.name + ').');
              break;
            }
          }
          return;
        }
        // element-only or mixed content: run the automaton
        const cm = contentModel(type);
        let state = 0;
        const boundCounts = cm.bounded.length ? new Array(cm.bounded.length).fill(0) : null;
        let contentError = false;
        let textError = false;
        for (let c = el.firstChild; c; c = c.nextSibling) {
          const nt = c.nodeType;
          if (nt === 3 || nt === 4) {
            if (!type.mixed && !textError && !isWhitespaceOnly(c.nodeValue)) {
              textError = true;
              report('cvc-complex-type.2.3', el, 'Das Element \'' + el.nodeName + '\' darf keinen Text enthalten (Inhaltstyp ' + type.name + ' erlaubt nur Elemente).');
            }
            continue;
          }
          if (nt !== 1) continue;
          const key = keyOfNode(c.namespaceURI, c.localName);
          const nsI = nsIndex.get(c.namespaceURI || null);
          let childDecl = null, wildcard = null;
          if (!contentError) {
            const st = cm.states[state];
            const tr = st.map.get(key);
            if (tr) { state = tr.next; childDecl = tr.decl; if (tr.bound) boundCounts[tr.bound.id]++; }
            else {
              let w = null;
              for (const cand of st.wild) if (nscAllows(cand.nsc, nsI === undefined ? '?' : nsI)) { w = cand; break; }
              if (w) { state = w.next; wildcard = w; if (w.bound) boundCounts[w.bound.id]++; }
              else {
                contentError = true;
                const exp = expectedOf(st);
                const occ = st.occ; // XMLSchemaValidator.handleStartElement: occurrence-specific codes
                if (exp) {
                  if (occ && occ.count < occ.min) report(occ.min - occ.count > 1 ? 'cvc-complex-type.2.4.h' : 'cvc-complex-type.2.4.g', c, 'Unerwartetes Element \'' + c.nodeName + '\' in \'' + el.nodeName + '\': das vorherige Element muss mindestens ' + occ.min + '-mal vorkommen (bisher ' + occ.count + '). Erwartet wird eines von: ' + exp + '.');
                  else if (occ && occ.max !== -1 && occ.count >= occ.max) report('cvc-complex-type.2.4.e', c, 'Das Element \'' + c.nodeName + '\' darf in \'' + el.nodeName + '\' höchstens ' + occ.max + '-mal vorkommen. Erwartet wird eines von: ' + exp + '.');
                  else report('cvc-complex-type.2.4.a', c, 'Unerwartetes Element \'' + c.nodeName + '\' in \'' + el.nodeName + '\'. Erwartet wird eines von: ' + exp + '.');
                } else {
                  if (occ && occ.max !== -1 && occ.count >= occ.max) report('cvc-complex-type.2.4.f', c, 'Das Element \'' + c.nodeName + '\' darf in \'' + el.nodeName + '\' höchstens ' + occ.max + '-mal vorkommen; danach ist kein weiteres Element erlaubt.');
                  else report('cvc-complex-type.2.4.d', c, 'Unerwartetes Element \'' + c.nodeName + '\' in \'' + el.nodeName + '\'. An dieser Stelle ist kein weiteres Element erlaubt.');
                }
              }
            }
          }
          if (contentError && !childDecl && !wildcard) {
            // Xerces recovery: use any declaration of this content model, else a global declaration
            childDecl = cm.anyPos.get(key) || null;
            if (!childDecl) {
              for (const cand of cm.anyWild) if (nscAllows(cand.nsc, nsI === undefined ? '?' : nsI)) { wildcard = cand; break; }
              if (!wildcard) { const g = globalElements[key]; if (g) childDecl = { key, type: g.t, nil: !!g.nil, abs: !!g.abs, fixed: g.fixed, def: g.def, block: g.block || '', global: true }; }
            }
          }
          if (childDecl) { validateElement(c, childDecl, null); continue; }
          if (wildcard) {
            if (wildcard.pc === 'skip') continue;
            const g = globalElements[key];
            if (g) { validateElement(c, { key, type: g.t, nil: !!g.nil, abs: !!g.abs, fixed: g.fixed, def: g.def, block: g.block || '', global: true }, null); continue; }
            if (wildcard.pc === 'strict') report('cvc-complex-type.2.4.c', c, 'Das Element \'' + c.nodeName + '\' wird an dieser Stelle durch einen strikten Wildcard zugelassen, aber es gibt keine Deklaration dafür im Schema.');
            // lax (or strict without declaration): assessed only when xsi:type says how
            if (c.hasAttributeNS(XSI, 'type')) validateElement(c, null, null);
          }
        }
        if (!contentError && cm.states[state].accept && boundCounts) {
          // JDK XSDFACM.checkMinMaxBounds (constant-space a{n,m}): reported for the parent element
          for (const b of cm.bounded) {
            const n = boundCounts[b.id];
            if (n < b.min) report('cvc-complex-type.2.4.b', el, 'Der Inhalt von \'' + el.nodeName + '\' ist unvollständig: \'' + b.label + '\' muss mindestens ' + b.min + '-mal vorkommen (gefunden: ' + n + ').');
            if (b.max !== -1 && n > b.max) report('cvc-complex-type.2.4.d', el, 'Ungültiger Inhalt in \'' + el.nodeName + '\': \'' + b.label + '\' darf höchstens ' + b.max + '-mal vorkommen (gefunden: ' + n + ').');
          }
        }
        if (!contentError && !cm.states[state].accept) {
          const exp = expectedOf(cm.states[state]);
          const occ = cm.states[state].occ;
          if (occ && occ.count < occ.min) report(occ.min - occ.count > 1 ? 'cvc-complex-type.2.4.j' : 'cvc-complex-type.2.4.i', el, 'Der Inhalt von \'' + el.nodeName + '\' ist unvollständig: das letzte Element muss mindestens ' + occ.min + '-mal vorkommen (bisher ' + occ.count + '). Erwartet wird eines von: ' + exp + '.');
          else report('cvc-complex-type.2.4.b', el, 'Der Inhalt von \'' + el.nodeName + '\' ist unvollständig. Erwartet wird eines von: ' + exp + '.');
        }
      }

      function checkXsiAttribute(a, el) {
        switch (a.localName) {
          case 'type': break;       // resolved by validateElement
          case 'nil': break;        // handled by validateElement
          case 'schemaLocation': { const t = builtin('anyURI'); for (const item of wsCollapse(a.value).split(' ')) if (item) { const r = validateSimple(t, item, {}); if (!r.ok) { report('cvc-datatype-valid.1.2.1', a, 'Der Eintrag \'' + item + '\' von xsi:schemaLocation ist keine gültige URI (' + r.reason + ').'); report('cvc-attribute.3', a, 'Der Wert \'' + a.value + '\' von xsi:schemaLocation ist keine gültige URI-Liste (' + r.reason + ').'); break; } } break; }
          case 'noNamespaceSchemaLocation': { const r = validateSimple(builtin('anyURI'), a.value, {}); if (!r.ok) report('cvc-datatype-valid.1.2.1', a, 'Der Wert \'' + a.value + '\' von xsi:noNamespaceSchemaLocation ist keine gültige URI (' + r.reason + ').'); if (!r.ok) report('cvc-attribute.3', a, 'Der Wert \'' + a.value + '\' von xsi:noNamespaceSchemaLocation ist keine gültige URI (' + r.reason + ').'); break; }
          default: report('cvc-complex-type.3.2.2', a, 'Das Attribut \'' + a.name + '\' ist im Element \'' + el.nodeName + '\' nicht erlaubt.');
        }
      }
    }

    /** Builds every content model now (used by the compiler to prove determinism) and returns stats. */
    function compileAllContentModels() {
      let automata = 0, states = 0, transitions = 0;
      for (let i = 0; i < model.types.length; i++) {
        const t = typeOf(i);
        if (t.kind !== 'complex' || (t.contentType !== 'elementOnly' && t.contentType !== 'mixed')) continue;
        const cm = contentModel(t);
        automata++;
        states += cm.states.length;
        for (const s of cm.states) transitions += s.map.size + s.wild.length;
      }
      return { automata, states, transitions };
    }

    return { validate, compileAllContentModels, typeOf, builtin, validateSimple, _nsTable: nsTable };
  }

  return {
    create, translateXsdRegex, isValidNCName, isValidName, isValidNmtoken, parseDecimal, parseInteger, parseDate, parseDateTime, parseTime,
    base64Length, checkURI, wsCollapse, wsReplace,
  };
});
