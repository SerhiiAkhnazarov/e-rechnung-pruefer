/*
 * vat-relevance.js — umsatzsteuerliche Einordnung der Befunde nach deutschem Recht (BMF-Schreiben vom 15.10.2025,
 * Rn. 6a, 6b, 35a): Formatfehler / Geschäftsregelfehler mit Bezug zu einer Rechnungspflichtangabe (§ 14 Abs. 4,
 * § 14a UStG) / Geschäftsregelfehler ohne diesen Bezug; dazu das Gesamturteil je Rechnung und die Übersicht, ob die
 * Pflichtangaben im strukturierten Teil vorhanden sind.
 *
 * Data (no legal judgement is coded here):
 *   legal  legal/ust-pflichtangaben.json — business terms (BT) carrying each Pflichtangabe, rule overrides, texts
 *   paths  build/bt-paths.json — syntax binding (element path -> BT/BG) and BG membership, derived from the KoSIT
 *          visualization (tools/build-bt-paths.cjs)
 *
 * Which business terms a Schematron finding concerns, in this order:
 *   1. an override of legal/ust-pflichtangaben.json ("regeln": the terms the rule actually checks);
 *   2. the business terms named in the message (EN 16931 rule messages name them, e.g. "(BT-31)"); business groups
 *      only when the message names no term (otherwise they are the context, e.g. "Each ... (BG-20) shall ... (BT-97)");
 *   3. rules that report an element the EN 16931 does not provide for (UBL-CR, CII-SR, CII-DT, UBL-DT "should not ...",
 *      Factur-X "marked as not used"): no Pflichtangabe;
 *   4. the position of the finding: path of the context node (plus the element the message names, e.g. Factur-X
 *      "Element 'ram:SellerTradeParty' must occur ...") looked up in the syntax binding, nearest ancestor first;
 *   5. otherwise: undetermined — treated like a Pflichtangabe ("prüfen"), never as irrelevant.
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VatRelevance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // fixed prefixes of the paths in build/bt-paths.json; the UBL root element without prefix
  const NS_PREFIX = {
    'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2': '',
    'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2': '',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2': 'cac',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2': 'cbc',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2': 'ext',
    'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100': 'rsm',
    'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100': 'ram',
    'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100': 'udt',
    'urn:un:unece:uncefact:data:standard:QualifiedDataType:100': 'qdt',
  };

  /** namespace-qualified path of a node without positions: /Invoice/cac:AccountingSupplierParty/cac:Party, …/@schemeID */
  function canonicalPath(node) {
    const parts = [];
    let n = node;
    if (n && (n.nodeType === 3 || n.nodeType === 4)) n = n.parentNode;
    if (n && n.nodeType === 2) { parts.unshift('@' + (n.localName || n.nodeName)); n = n.ownerElement; }
    while (n && n.nodeType === 1) {
      const p = NS_PREFIX[n.namespaceURI || ''];
      const local = n.localName || n.nodeName;
      parts.unshift(p === undefined ? (n.namespaceURI ? '{' + n.namespaceURI + '}' : '') + local : (p ? p + ':' : '') + local);
      n = n.parentNode;
    }
    return '/' + parts.join('/');
  }

  const REF_RE = /\b(B[GT])-((?:X|DEX)-)?(\d+)\b/g;
  /** business terms / groups named in a message: std = EN 16931 (BT-n, BG-n), other = extensions (BT-X-n, BT-DEX-n) */
  function refsFromText(text) {
    const std = [], other = [];
    for (const m of String(text || '').matchAll(REF_RE)) {
      const id = m[1] + '-' + (m[2] || '') + m[3];
      const list = m[2] ? other : std;
      if (!list.includes(id)) list.push(id);
    }
    return { std, other };
  }

  // rules that report an element or attribute the EN 16931 does not provide for (or forbids in this place)
  const EXTRA_FAMILY = /^(UBL-CR|CII-SR|CII-DT|UBL-DT)-/;
  const EXTRA_TEXT = /\b(should|shall|must) not (include|be present|be used|exist|contain)\b|\bshould not be present\b|\bshall not be used\b/i;
  const NOT_USED = /\bis marked as not used\b|\bmarked as not used in the given context\b/i;

  /**
   * the element or attribute a message names:
   *   Factur-X  "Element 'ram:SellerTradeParty' must occur …", "Value of '@unitCode' is not allowed."
   *   CII-SR    "[CII-SR-010] - ID must exist exactly once", "… - Only one SpecifiedTradePaymentTerms Description should be present"
   *   otherwise the element names written in CamelCase ("CompanyID (VAT Identifier) must be stated …")
   * Returned as { attr } | { qname } | { local, parent? } | { names: [...] }
   */
  function subjectFromText(text) {
    const t = String(text || '');
    let m = /'(@)?([A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)'/.exec(t);
    if (m) return m[1] ? { attr: m[3] } : m[2] ? { qname: m[2] + m[3] } : { local: m[3] };
    m = /\]\s*-\s*(?:Only one )?(?:([A-Z][A-Za-z]+) )?([A-Z][A-Za-z]+) (?:must|should|shall) (?:exist|occur|be present)/.exec(t);
    if (m) return { local: m[2], parent: m[1] || null };
    const names = uniq((t.replace(/^\[[^\]]*\]/, '').match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/g) || []));
    return names.length ? { names } : null;
  }

  const uniq = (a) => [...new Set(a)];

  const ELEMENT_PREFIX = new Set(['cac', 'cbc', 'ext', 'ubl', 'cn', 'rsm', 'ram', 'udt', 'qdt']);
  const ROOT_ALIAS = { 'ubl:Invoice': 'Invoice', 'cn:CreditNote': 'CreditNote', Invoice: 'Invoice', CreditNote: 'CreditNote' };
  const isStep = (s) => s === '.' || s === '..' || /^@[A-Za-z_][\w.-]*$/.test(s) || (/^[a-z]+:[A-Za-z_][\w.-]*$/.test(s) && ELEMENT_PREFIX.has(s.split(':')[0]));
  /**
   * The element paths a Schematron test expression refers to, as written: { rel: [...] } relative to the context node,
   * { abs: [...] } from the root, { desc: [...] } after '//'. String literals and predicates are removed first;
   * function names, variables and other prefixes (xs:, fn:, u: …) are not element steps.
   */
  function testPaths(test) {
    let t = String(test || '').replace(/'[^']*'|"[^"]*"/g, ' ');
    let s = '', depth = 0;
    for (const ch of t) { if (ch === '[') { depth++; continue; } if (ch === ']') { depth = Math.max(0, depth - 1); continue; } if (!depth) s += ch; }
    const out = { rel: [], abs: [], desc: [] };
    for (const tok of s.split(/[\s(),=!<>|+*]+/)) {
      if (!tok || tok.startsWith('$')) continue;
      const kind = tok.startsWith('//') ? 'desc' : tok.startsWith('/') ? 'abs' : 'rel';
      const steps = tok.replace(/^\/\/?/, '').split('/').filter((x) => x !== '');
      if (!steps.length || !steps.every(isStep)) continue;
      if (kind === 'rel' && steps.every((x) => x === '.')) continue;
      out[kind].push(steps);
    }
    return out;
  }

  function create(data) {
    const legal = data.legal;
    const paths = data.paths || { syntax: {}, groups: {} };
    const angabeById = {};
    const btAngaben = {};
    for (const a of legal.angaben) {
      angabeById[a.id] = a;
      for (const bt of a.bt) (btAngaben[bt] || (btAngaben[bt] = [])).push(a.id);
    }
    const regeln = legal.regeln || {};

    /** BG -> its business terms (recursively), BT -> itself */
    function expand(ids) {
      const out = new Set();
      const visit = (id, depth) => {
        if (depth > 12) return;
        if (/^BT-/.test(id)) { out.add(id); return; }
        for (const m of paths.groups[id] || []) visit(m, depth + 1);
      };
      for (const id of ids) visit(id, 0);
      return [...out];
    }

    const localOf = (seg) => seg.replace(/^[a-z]+:/, '').replace(/^@/, '');
    const BELOW_MAX = 12; // an element without own term stands for the terms below it, if they are few
    /** ids at path p: its own, else the terms mapped below it (at most BELOW_MAX) */
    function idsAt(map, p) {
      if (map[p]) return map[p];
      const below = uniq(Object.keys(map).filter((k) => k.startsWith(p + '/')).flatMap((k) => map[k]));
      return below.length && below.length <= BELOW_MAX ? below : null;
    }
    function locationIds(f, syntax) {
      const node = f.node;
      if (!node) return null;
      const map = (paths.syntax && paths.syntax[syntax]) || {};
      const p = canonicalPath(node);
      const keys = Object.keys(map);
      // 1. the elements the test expression reads (relative to the context node, absolute, or '//' anywhere)
      const tp = testPaths(f.test);
      const fromTest = [];
      const join = (base, steps) => { const segs = base.split('/'); for (const st of steps) { if (st === '.') continue; if (st === '..') segs.pop(); else segs.push(st); } return segs.join('/'); };
      for (const steps of tp.rel) fromTest.push(join(p, steps));
      for (const steps of tp.abs) { const s0 = ROOT_ALIAS[steps[0]] || steps[0]; fromTest.push('/' + [s0].concat(steps.slice(1)).join('/')); }
      for (const steps of tp.desc) { const tail = '/' + steps.join('/'); for (const k of keys) if (k.endsWith(tail)) fromTest.push(k); }
      const testIds = uniq(fromTest.filter((c) => c.split('/').length > 2).flatMap((c) => idsAt(map, c) || []));
      if (testIds.length) return { ids: testIds, path: fromTest.length === 1 ? fromTest[0] : p + ' (Test: ' + uniq(fromTest).length + ' Pfade)' };
      // 2. the element the message names
      const subj = subjectFromText(f.text);
      const under = (base, depth) => keys.filter((k) => k.startsWith(base + '/') && k.slice(base.length + 1).split('/').length <= depth);
      const cands = [];
      if (subj && subj.qname) cands.push(p + '/' + subj.qname);
      else if (subj && subj.attr) cands.push(p + '/@' + subj.attr);
      else if (subj && subj.local) {
        // a child (or, with the parent named, a grandchild) of that local name
        for (const k of under(p, subj.parent ? 2 : 1)) {
          const rest = k.slice(p.length + 1).split('/');
          if (localOf(rest[rest.length - 1]) === subj.local && (!subj.parent || localOf(rest[0]) === subj.parent)) cands.push(k);
        }
        if (!cands.length) cands.push(p + '/' + (syntax === 'CII' ? 'ram:' : 'cbc:') + subj.local, p + '/' + (syntax === 'CII' ? 'ram:' : 'cac:') + subj.local);
      } else if (subj && subj.names) {
        for (const name of subj.names) for (const k of under(p, 3)) if (localOf(k.slice(k.lastIndexOf('/') + 1)) === name) cands.push(k);
      }
      if (cands.length) {
        const ids = uniq(cands.flatMap((c) => idsAt(map, c) || []));
        if (ids.length) return { ids, path: cands.length === 1 ? cands[0] : p + ' (' + cands.length + ' Elemente)' };
      }
      let q = p;
      while (q.split('/').length > 2) { // never the root element: it stands for the whole invoice
        const ids = idsAt(map, q);
        if (ids) return { ids, path: q };
        q = q.slice(0, q.lastIndexOf('/'));
      }
      return null;
    }

    const result = (klasse, basis, bt, angaben, extra) => Object.assign({ klasse, basis, bt: bt || [], angaben: angaben || [] }, extra || {});

    // ---------------------------------------------------------------------------------------------------------------
    // facts of an invoice used by the classification and the checklist (model: src/invoice-model.js)
    // ---------------------------------------------------------------------------------------------------------------
    const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
    function facts(model) {
      const bt = (model && model.bt) || {};
      const has = (id) => (bt[id] || []).length > 0;
      const val = (id) => (bt[id] || []).join(' | ');
      const first = (id) => (bt[id] || [])[0];
      const num = (id) => { const v = first(id); return v !== undefined && DECIMAL.test(String(v).trim()) ? Number(v) : null; };
      const nonZero = (id) => (bt[id] || []).some((v) => (DECIMAL.test(String(v).trim()) ? Number(v) !== 0 : String(v).trim() !== ''));
      const cats = uniq((bt['BT-118'] || []).concat(bt['BT-151'] || []));
      const notes = (bt['BT-22'] || []).concat(bt['BT-21'] || []).join('\n');
      // exemption reasons (BT-120/BT-121) of the VAT breakdown, as recorded and as rows
      const reasons = ((model && model.vat) || []).flatMap((v) => [v.reason, v.reasonCode]).concat(bt['BT-120'] || [], bt['BT-121'] || []).filter(Boolean).join('\n');
      const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(first('BT-2') || '') ? first('BT-2') : null;
      return { bt, has, val, first, num, nonZero, cats, notes, reasons, issueDate, lines: (model && model.lines) || [], vat: (model && model.vat) || [], skonto: (model && model.skonto) || [] };
    }
    /** an Angabe applies to an invoice issued on or after its 'gueltigAb' (without issue date: always, to be safe) */
    const inForce = (id, fx) => { const a = angabeById[id]; return !a || !a.gueltigAb || !fx || !fx.issueDate || fx.issueDate >= a.gueltigAb; };

    /**
     * Einordnung eines Befunds. f: finding of src/pruefer-core.js ({source, level, id, text, node?}); syntax:
     * 'UBL-Invoice' | 'UBL-CreditNote' | 'CII'; model: the invoice data (src/invoice-model.js), optional — it decides the
     * conditional rows of "regeln" ("wenn") and Angaben that apply only from a date on ("gueltigAb", by BT-2).
     * klasse: format | container | zusatz | pflicht | ohne-bezug | unbestimmt
     * basis:  syntax | container | regel | meldung | zusatz | stelle | keine
     */
    function classify(f, syntax, model) {
      if (f.source === 'xsd' || f.source === 'encoding') return result('format', 'syntax');
      if (f.source === 'pdf') return result('container', 'container');
      const fx = model ? facts(model) : null;
      const angabenOf = (ids) => uniq(ids.flatMap((bt) => btAngaben[bt] || [])).filter((a) => inForce(a, fx));
      let ov = Object.prototype.hasOwnProperty.call(regeln, f.id) ? regeln[f.id] : null;
      if (ov && ov.wenn && fx) {
        const hit = ov.wenn.find((w) => w.vorhanden && fx.nonZero(w.vorhanden));
        if (hit) ov = hit;
      }
      let ids, basis, extra = [];
      if (ov) {
        ids = ov.bt; basis = 'regel'; extra = ov.angaben || [];
        if (ov.nurAngaben) return result(ov.nurAngaben.length ? 'pflicht' : 'ohne-bezug', basis, ids, ov.nurAngaben.slice());
      } else {
        const refs = refsFromText(f.text);
        const bts = refs.std.filter((x) => x.startsWith('BT-'));
        if (bts.length) { ids = bts; basis = 'meldung'; }
        else if (refs.std.length) { ids = expand(refs.std); basis = 'meldung'; }
        else if (NOT_USED.test(f.text || '') || (EXTRA_FAMILY.test(f.id || '') && EXTRA_TEXT.test(f.text || ''))) return result('zusatz', 'zusatz');
        else if (refs.other.length) return result('unbestimmt', 'meldung', refs.other);
        else {
          const loc = locationIds(f, syntax);
          if (!loc) return result('unbestimmt', 'keine');
          ids = expand(loc.ids); basis = 'stelle';
          const angaben = angabenOf(ids);
          return result(angaben.length ? 'pflicht' : 'ohne-bezug', basis, ids, angaben, { pfad: loc.path });
        }
      }
      const angaben = uniq(angabenOf(ids).concat(extra));
      return result(angaben.length ? 'pflicht' : 'ohne-bezug', basis, ids, angaben);
    }

    // UNTDID 1001 (BT-3): documents issued by the buyer (self-billing) and corrections
    const SELF_BILLED = new Set(['261', '389', '471', '473', '500', '501', '502', '527']);
    const CORRECTIVE = new Set(['384', '471', '472', '473', '502', '503']);
    const PAID_TO_DATE = new Set(['432', '72']); // BT-8 "paid to date" (UNTDID 2005 in UBL, UNTDID 2475 in CII)
    const MARGIN_CODES = /\bVATEX-EU-(D|F|I|J)\b/; // CEF VATEX codes of the margin schemes (second-hand means of transport, second-hand goods, works of art, antiques)
    const MARGIN_TEXT = /Sonderregelung/i;
    const KLEINUNTERNEHMER = /§\s*19\b|Kleinunternehmer/i;

    // ---------------------------------------------------------------------------------------------------------------
    // Pflichtangaben im strukturierten Teil: vorhanden / fehlt / prüfen / entfällt / nicht zutreffend (presence only —
    // whether a value is correct is not checked; BMF-Schreiben vom 15.10.2025, Rn. 35a: content errors are possible
    // without any rule violation). 'fehlt' only where the structured part certainly lacks a required particular;
    // everything that depends on facts outside the invoice data is 'prüfen'.
    // ---------------------------------------------------------------------------------------------------------------
    function checklist(model) {
      const fx = facts(model);
      const { has, val, first, num, nonZero, cats, notes, reasons, lines, vat } = fx;
      const total = num('BT-112');
      // § 33 UStDV: Gesamtbetrag (also of a correction: its amount) not above 250 euros; not for §§ 6a, 13b (K, AE);
      // § 3c (distance sales) cannot be recognised from the data
      const kleinbetrag = val('BT-5') === 'EUR' && total !== null && Math.abs(total) <= 250 && !cats.includes('AE') && !cats.includes('K');
      // § 34a UStDV: tax-exempt under § 19 UStG (category E with a reference to § 19 / Kleinunternehmer)
      const kleinunternehmer = cats.length > 0 && cats.every((c) => c === 'E') && KLEINUNTERNEHMER.test(reasons + '\n' + notes);
      const reduced = kleinbetrag || kleinunternehmer;
      const reducedText = kleinbetrag ? 'Kleinbetragsrechnung (§ 33 UStDV)' : 'Rechnung eines Kleinunternehmers (§ 34a UStDV)';
      const item = (id, status, werte, hinweis) => ({ id, norm: angabeById[id] ? angabeById[id].norm : id, text: angabeById[id] ? angabeById[id].text : '', status, werte: werte.filter((w) => w[1] !== ''), hinweis: hinweis || '' });
      const missing = (ids, labels) => ids.map((id, i) => (has(id) ? null : labels[i] + ' (' + id + ')')).filter(Boolean);
      const out = [];
      const code = val('BT-3');

      // § 14 Abs. 4 Satz 1 Nr. 1: name and address. Without name, or without both place and postcode, the address is
      // missing; without street/P.O. box, place or postcode it may still be "eindeutig feststellbar" (§ 31 Abs. 2 UStDV)
      const party = (id, nameId, tradeId, street, plz, city, country, who, required) => {
        const name = has(nameId) || has(tradeId);
        const fehlt = [];
        if (!name) fehlt.push('Name (' + nameId + ')');
        if (!has(city) && !has(plz)) fehlt.push('Ort und Postleitzahl (' + city + ', ' + plz + ')');
        const doubt = [];
        if (!street.some(has)) doubt.push('Straße oder Postfach (' + street[0] + ')');
        if (has(city) !== has(plz)) doubt.push(has(city) ? 'Postleitzahl (' + plz + ')' : 'Ort (' + city + ')');
        const werte = [[nameId, val(nameId)], [tradeId, val(tradeId)], [street[0], street.map(val).filter(Boolean).join(', ')], [plz, val(plz)], [city, val(city)], [country, val(country)]];
        if (!fehlt.length && !doubt.length) out.push(item(id, 'vorhanden', werte));
        else if (!required) out.push(item(id, 'entfällt', werte, reducedText + ': Angaben zum ' + who + ' nicht erforderlich.'));
        else if (fehlt.length) out.push(item(id, 'fehlt', werte, 'Fehlt: ' + fehlt.concat(doubt).join(', ') + '.'));
        else out.push(item(id, 'prüfen', werte, 'Nicht angegeben: ' + doubt.join(', ') + '. Ausreichend ist eine Anschrift, die sich eindeutig feststellen lässt (§ 31 Abs. 2 UStDV) – prüfen.'));
      };
      party('nr1v', 'BT-27', 'BT-28', ['BT-35', 'BT-36', 'BT-162'], 'BT-38', 'BT-37', 'BT-40', 'leistenden Unternehmer', true);
      party('nr1e', 'BT-44', 'BT-45', ['BT-50', 'BT-51', 'BT-163'], 'BT-53', 'BT-52', 'BT-55', 'Leistungsempfänger', !kleinbetrag);

      // Nr. 2: tax number or VAT identification number of the supplier
      {
        const werte = [['BT-31', val('BT-31')], ['BT-32', val('BT-32')], ['BT-63', val('BT-63')]];
        const allO = cats.length > 0 && cats.every((c) => c === 'O');
        if (has('BT-31') || has('BT-32')) out.push(item('nr2', 'vorhanden', werte));
        else if (has('BT-63')) out.push(item('nr2', 'prüfen', werte, 'Nur die USt-IdNr. des Steuervertreters (BT-63) ist angegeben; prüfen, ob eine Fiskalvertretung vorliegt (§ 22c UStG).'));
        else if (kleinbetrag) out.push(item('nr2', 'entfällt', werte, 'Kleinbetragsrechnung (§ 33 UStDV): nicht erforderlich.'));
        else if (allO) out.push(item('nr2', 'prüfen', werte, 'Nur nicht steuerbare Umsätze (Kategorie O): Die EN 16931 lässt hier keine USt-IdNr. zu (Regel BR-O-02), die Steuernummer (BT-32) schon. Ob § 14 Abs. 4 UStG anzuwenden ist, hängt davon ab, ob ein steuerbarer Umsatz im Inland vorliegt – prüfen.'));
        else out.push(item('nr2', 'fehlt', werte, 'Weder USt-IdNr. (BT-31) noch Steuernummer (BT-32) des Verkäufers angegeben' + (kleinunternehmer ? ' (§ 34a UStDV lässt auch die Kleinunternehmer-Identifikationsnummer zu)' : '') + '.'));
      }
      // Nr. 3, Nr. 4
      out.push(item('nr3', has('BT-2') ? 'vorhanden' : 'fehlt', [['BT-2', val('BT-2')]]));
      out.push(item('nr4', has('BT-1') ? 'vorhanden' : reduced ? 'entfällt' : 'fehlt', [['BT-1', val('BT-1')]], has('BT-1') ? 'Ob die Nummer einmalig vergeben ist, kann nur der Aussteller sicherstellen.' : reduced ? reducedText + ': nicht erforderlich.' : ''));
      // Nr. 5: quantity and kind of the goods / extent and kind of the service
      {
        const noName = lines.filter((l) => !l.name).length, noQty = lines.filter((l) => !l.qty).length;
        const werte = [['BG-25', lines.length + ' Position(en)'], ['BT-153', lines.slice(0, 3).map((l) => l.name).filter(Boolean).join(' | ') + (lines.length > 3 ? ' | …' : '')]];
        if (!lines.length) out.push(item('nr5', 'fehlt', werte, 'Keine Rechnungsposition (BG-25).'));
        else if (noName || noQty) out.push(item('nr5', 'fehlt', werte, [noName ? noName + ' Position(en) ohne Bezeichnung (BT-153)' : '', noQty ? noQty + ' Position(en) ohne Menge (BT-129)' : ''].filter(Boolean).join(', ') + '.'));
        else out.push(item('nr5', 'vorhanden', werte, 'Ob die Bezeichnung handelsüblich und hinreichend genau ist (Art, Umfang und Gehalt der Leistung), prüft das Werkzeug nicht; ein bloßer Verweis auf einen Vertrag genügt nicht.'));
      }
      // Nr. 6: time of supply (BT-72, BG-14, BG-26); BT-7 only for the receipt of advance payments (Abs. 5 Satz 1)
      {
        const werte = [['BT-72', val('BT-72')], ['BT-73', val('BT-73')], ['BT-74', val('BT-74')], ['BT-7', val('BT-7')], ['BT-8', val('BT-8')]];
        const allLinesPeriod = lines.length > 0 && lines.every((l) => l.period || l.periodEnd);
        const advance = code === '386' || code === '500';
        if (has('BT-72') || has('BT-73') || has('BT-74') || allLinesPeriod) out.push(item('nr6', 'vorhanden', allLinesPeriod && !(has('BT-72') || has('BT-73') || has('BT-74')) ? [['BG-26', 'Zeitraum in jeder Position']] : werte));
        else if (advance && has('BT-7')) out.push(item('nr6', 'vorhanden', werte, 'Anzahlungsrechnung (Code ' + code + '): Zeitpunkt der Vereinnahmung in BT-7.'));
        else if (reduced) out.push(item('nr6', 'entfällt', werte, reducedText + ': nicht erforderlich.'));
        else out.push(item('nr6', 'prüfen', werte, (has('BT-7') || has('BT-8') ? 'Nur das Datum bzw. der Code der Steuerfälligkeit (BT-7/BT-8) ist angegeben, kein Leistungszeitpunkt (BT-72, BG-14, BG-26). ' : 'Kein Leistungszeitpunkt im strukturierten Teil (BT-72, BG-14, BG-26). ') +
          'Nach BFH, Urteil vom 17.12.2008, XI R 62/07, ist er auch dann anzugeben, wenn er mit dem Ausstellungsdatum übereinstimmt; nach BFH, Urteil vom 1.3.2018, V R 18/17, kann er sich aus dem Ausstellungsdatum ergeben, wenn nach den Verhältnissen des Einzelfalls davon auszugehen ist, dass die Leistung im Monat der Rechnungsausstellung erbracht wurde (§ 31 Abs. 4 UStDV: der Kalendermonat genügt) – prüfen; Aussteller sollten den Zeitpunkt angeben.'));
      }
      // Nr. 6a (from 1.1.2028): "Versteuerung nach vereinnahmten Entgelten"
      {
        const werte = [['BT-8', val('BT-8')]];
        const noted = /vereinnahmten\s+Entgelt/i.test(notes);
        if (!inForce('nr6a', fx)) out.push(item('nr6a', 'nicht zutreffend', werte, 'Pflichtangabe erst für Rechnungen ab 1.1.2028' + (fx.issueDate ? '' : ' (Ausstellungsdatum fehlt)') + ', wenn der Leistende nach vereinnahmten Entgelten versteuert (§ 20 UStG).'));
        else if (noted) out.push(item('nr6a', 'vorhanden', werte.concat([['BG-1', 'Hinweis in einer Bemerkung']])));
        else if (PAID_TO_DATE.has(val('BT-8'))) out.push(item('nr6a', 'prüfen', werte, 'BT-8 „paid to date“ deutet auf eine Versteuerung nach vereinnahmten Entgelten hin; die Angabe „Versteuerung nach vereinnahmten Entgelten“ fehlt – prüfen.'));
        else out.push(item('nr6a', 'nicht zutreffend', werte, 'Nur erforderlich, wenn der Leistende nach vereinnahmten Entgelten versteuert (§ 20 UStG); kein Hinweis darauf im strukturierten Teil.'));
      }
      // Nr. 7: Entgelt per rate / exemption, and agreed reductions
      {
        const rows = vat.map((v) => (v.cat || '?') + (v.rate !== '' ? ' ' + v.rate + ' %' : '') + ': ' + (v.taxable || '?'));
        const skonto = fx.skonto.filter((s) => s.type === 'SKONTO');
        if (!vat.length) out.push(item('nr7', 'fehlt', [['BG-23', '']], 'Keine Umsatzsteuer-Aufschlüsselung (BG-23).'));
        else if (vat.some((v) => !v.taxable || !v.cat)) out.push(item('nr7', 'fehlt', [['BG-23', rows.join(' | ')]], 'Aufschlüsselung ohne Bemessungsgrundlage (BT-116) oder Kategorie (BT-118).'));
        else out.push(item('nr7', 'vorhanden', [['BG-23', rows.join(' | ')], ['BT-20', skonto.length ? 'Skonto: ' + skonto.map((s) => s.days + ' Tage ' + s.percent + ' %').join(', ') : '']], 'Im Voraus vereinbarte Minderungen (z. B. Skonto, Boni, Rabatte) müssen angegeben sein, sofern sie nicht bereits im Entgelt berücksichtigt sind; ein allgemeiner Hinweis auf die Vereinbarung genügt (z. B. in BT-20).'));
      }
      // Nr. 8: rate and tax amount, or reference to the exemption; Art. 230 MwStSystRL: VAT in euros
      {
        const exempt = new Set(['E', 'AE', 'K', 'G', 'O']);
        const bad = vat.filter((v) => (exempt.has(v.cat) ? !(v.reason || v.reasonCode) : (v.rate === '' || v.tax === '')));
        const rows = vat.map((v) => (v.cat || '?') + ': ' + (exempt.has(v.cat) ? 'Hinweis ' + ([v.reasonCode, v.reason].filter(Boolean).join(' – ') || '–') : (v.rate || '?') + ' %, Steuer ' + (v.tax || '?')));
        const foreign = has('BT-5') && val('BT-5') !== 'EUR' && vat.some((v) => !exempt.has(v.cat));
        const werte = [['BG-23', rows.join(' | ')], ['BT-110', val('BT-110')]].concat(foreign ? [['BT-6', val('BT-6')], ['BT-111', val('BT-111')]] : []);
        if (!vat.length) out.push(item('nr8', 'fehlt', [['BG-23', '']], 'Keine Umsatzsteuer-Aufschlüsselung (BG-23).'));
        else if (bad.length) out.push(item('nr8', 'fehlt', werte, 'Steuersatz/Steuerbetrag (BT-119/BT-117) oder Hinweis auf die Steuerbefreiung (BT-120/BT-121) fehlt in ' + bad.length + ' Aufschlüsselung(en).'));
        else if (foreign && !(val('BT-6') === 'EUR' && has('BT-111'))) out.push(item('nr8', 'prüfen', werte, 'Rechnung in ' + val('BT-5') + ': Der Steuerbetrag ist in Euro anzugeben (Art. 230 MwStSystRL) – im strukturierten Teil fehlt die Steuer in Euro (BT-6 = EUR mit BT-111).'));
        else out.push(item('nr8', 'vorhanden', werte));
      }
      // Nr. 9: reference to the recipient's retention obligation (§ 14b Abs. 1 Satz 5 UStG)
      out.push(/aufzubewahren|Aufbewahrungspflicht/i.test(notes)
        ? item('nr9', 'vorhanden', [['BG-1', 'Hinweis in einer Bemerkung']])
        : item('nr9', 'nicht zutreffend', [], 'Nur bei Leistungen im Zusammenhang mit einem Grundstück an Nichtunternehmer erforderlich (§ 14b Abs. 1 Satz 5 UStG); kein solcher Hinweis im strukturierten Teil.'));
      // Nr. 10: "Gutschrift" when the recipient issues the invoice
      {
        const gs = /gutschrift/i.test(notes);
        const werte = [['BT-3', code]].concat(gs ? [['BG-1', 'Bemerkung mit „Gutschrift“']] : []);
        if (!has('BT-3')) out.push(item('nr10', 'prüfen', werte, 'Rechnungsart (BT-3) fehlt: Ob es sich um eine Gutschrift handelt, ist nicht erkennbar.'));
        else if (SELF_BILLED.has(code)) out.push(item('nr10', gs ? 'vorhanden' : 'prüfen', werte, gs ? 'Vom Leistungsempfänger ausgestellte Rechnung (Code ' + code + '); die Angabe „Gutschrift“ steht in einer Bemerkung.' : 'Vom Leistungsempfänger ausgestellte Rechnung (Code ' + code + '): die Angabe „Gutschrift“ ist Pflicht (§ 14 Abs. 4 Satz 1 Nr. 10 UStG); im strukturierten Teil (Bemerkung, BG-1) nicht gefunden – prüfen.'));
        else if (code === '381') out.push(item('nr10', gs ? 'vorhanden' : 'nicht zutreffend', werte, gs ? 'Code 381 mit Bemerkung „Gutschrift“ (so die Zuordnung von KoSIT/FeRD für Gutschriften).' : 'Code 381 (Credit Note) ohne die Angabe „Gutschrift“: als Gutschrift im Sinne des § 14 Abs. 2 Satz 5 UStG – vom Leistungsempfänger ausgestellt – müsste das Dokument die Angabe „Gutschrift“ enthalten.'));
        else out.push(item('nr10', 'nicht zutreffend', werte, 'Keine vom Leistungsempfänger ausgestellte Rechnung (Code ' + code + ').'));
      }
      // § 14 Abs. 5 Satz 2: final invoice after advance payments
      {
        const paid = nonZero('BT-113');
        const werte = [['BT-113', val('BT-113')], ['BT-115', val('BT-115')], ['BT-3', code]];
        if (paid || code === '877' || code === '876') out.push(item('14-5', 'prüfen', werte, 'Mögliche Endrechnung' + (paid ? ' (bereits gezahlter Betrag BT-113)' : ' (Code ' + code + ')') + ': die vor Ausführung der Leistung vereinnahmten Teilentgelte und die darauf entfallenden Steuerbeträge sind abzusetzen (§ 14 Abs. 5 Satz 2 UStG). Nicht beanstandet wird bis 30.06.2030 die Absetzung als Summe in BT-113 mit Einzelheiten in einer Bemerkung (BT-22) oder in einer eingebetteten Anlage, auf die der strukturierte Teil ausdrücklich verweist (BMF-Schreiben vom 15.10.2026; zuvor Rz. 48 des Schreibens vom 15.10.2024) – prüfen.'));
        else out.push(item('14-5', 'nicht zutreffend', [], 'Kein bereits gezahlter Betrag (BT-113) – keine Endrechnung erkennbar.'));
      }
      // § 14a UStG
      {
        const ae = vat.filter((v) => v.cat === 'AE'), ic = vat.filter((v) => v.cat === 'K');
        const margin = MARGIN_CODES.test(reasons) || MARGIN_TEXT.test(reasons + '\n' + notes);
        const werte = [['BT-31', val('BT-31')], ['BT-48', val('BT-48')], ['BT-120/121', vat.filter((v) => v.reason || v.reasonCode).map((v) => [v.reasonCode, v.reason].filter(Boolean).join(' – ')).join(' | ')]];
        if (!ae.length && !ic.length && !margin) out.push(item('14a', 'nicht zutreffend', [], 'Keine Steuerschuldnerschaft des Leistungsempfängers (AE), keine innergemeinschaftliche Lieferung (K) und kein Hinweis auf eine Sonderregelung (§ 25, § 25a UStG). Nicht erkennbar sind die Lieferung neuer Fahrzeuge (§ 14a Abs. 4) und das Dreiecksgeschäft (§ 14a Abs. 7).'));
        else {
          const fehlt = [], doubt = [];
          if (ae.some((v) => !(v.reason || v.reasonCode))) fehlt.push('Hinweis „Steuerschuldnerschaft des Leistungsempfängers“ (BT-120/BT-121)');
          if (ic.length && !has('BT-48')) fehlt.push('USt-IdNr. des Erwerbers (BT-48)');
          if (ic.length && !has('BT-31')) (has('BT-63') ? doubt : fehlt).push('USt-IdNr. des Lieferers (BT-31)' + (has('BT-63') ? ' – angegeben ist nur die des Steuervertreters (BT-63)' : ''));
          if (ae.length && has('BT-55') && val('BT-55') !== 'DE' && !(has('BT-31') && has('BT-48'))) doubt.push('bei sonstigen Leistungen an Unternehmer im übrigen Gemeinschaftsgebiet die USt-IdNrn. beider Beteiligten (BT-31, BT-48; § 14a Abs. 1 UStG)');
          if (margin) doubt.push('bei Reiseleistungen bzw. Differenzbesteuerung der Hinweis „Sonderregelung für Reisebüros“ bzw. „Gebrauchtgegenstände/Sonderregelung“, „Kunstgegenstände/Sonderregelung“ oder „Sammlungsstücke und Antiquitäten/Sonderregelung“ (§ 14a Abs. 6 UStG)');
          if (ic.length) doubt.push('bei neuen Fahrzeugen deren Merkmale (§ 14a Abs. 4 UStG, BG-32) und beim Dreiecksgeschäft der Hinweis darauf (§ 14a Abs. 7 UStG)');
          if (fehlt.length) out.push(item('14a', 'fehlt', werte, 'Fehlt: ' + fehlt.join(', ') + '.' + (doubt.length ? ' Außerdem prüfen: ' + doubt.join('; ') + '.' : '')));
          else if (doubt.length && (margin || ae.length && has('BT-55') && val('BT-55') !== 'DE' && !(has('BT-31') && has('BT-48')) || ic.length && !has('BT-31'))) out.push(item('14a', 'prüfen', werte, 'Prüfen: ' + doubt.join('; ') + '.'));
          else out.push(item('14a', 'vorhanden', werte, doubt.length ? 'Gegebenenfalls zusätzlich: ' + doubt.join('; ') + '.' : ''));
        }
      }
      // § 22c UStG: only German fiscal representation (§ 22a: a supplier established abroad, representative in Germany)
      {
        const werte = [['BT-62', val('BT-62')], ['BT-63', val('BT-63')], ['BT-64', val('BT-64')], ['BT-67', val('BT-67')], ['BT-66', val('BT-66')], ['BT-69', val('BT-69')]];
        const german = val('BT-69') === 'DE' || /^DE/i.test(val('BT-63'));
        if (!has('BT-62') && !has('BT-63')) out.push(item('22c', 'nicht zutreffend', [], 'Kein Steuervertreter angegeben (BG-11).'));
        else if (val('BT-40') === 'DE') out.push(item('22c', 'prüfen', werte, 'Steuervertreter (BG-11) bei einem Verkäufer mit Ländercode DE (BT-40): Eine Fiskalvertretung (§§ 22a–22c UStG) kommt nur für im Ausland ansässige Unternehmer in Betracht – prüfen, was die Angabe bedeutet.'));
        else if (!german) out.push(item('22c', 'prüfen', werte, 'Steuervertreter außerhalb Deutschlands: § 22c UStG betrifft nur die Fiskalvertretung im Inland (§ 22a UStG) – für andere Mitgliedstaaten gelten deren Vorschriften.'));
        else {
          const fehlt = missing(['BT-62', 'BT-63'], ['Name', 'USt-IdNr.']);
          if (!has('BT-66') && !has('BT-67')) fehlt.push('Ort und Postleitzahl (BT-66, BT-67)');
          const doubt = (has('BT-66') !== has('BT-67')) ? [has('BT-66') ? 'Postleitzahl (BT-67)' : 'Ort (BT-66)'] : [];
          if (fehlt.length) out.push(item('22c', 'fehlt', werte, 'Fehlt: ' + fehlt.concat(doubt).join(', ') + ' des Fiskalvertreters (§ 22c Nr. 2 und 3 UStG).'));
          else out.push(item('22c', 'prüfen', werte, (doubt.length ? 'Nicht angegeben: ' + doubt.join(', ') + '. ' : '') + 'Den Hinweis auf die Fiskalvertretung (§ 22c Nr. 1 UStG) prüft das Werkzeug nicht.'));
        }
      }
      // § 31 Abs. 5 UStDV: a correction refers specifically and unambiguously to the corrected invoice
      {
        const werte = [['BT-25', val('BT-25')], ['BT-26', val('BT-26')], ['BT-3', code]];
        if (CORRECTIVE.has(code)) out.push(item('31-5', has('BT-25') ? 'vorhanden' : 'prüfen', werte, has('BT-25') ? '' : 'Berichtigte Rechnung (Code ' + code + ') ohne Verweis auf die ursprüngliche Rechnung (BT-25). Die Berichtigung muss spezifisch und eindeutig auf die Rechnung bezogen sein (§ 31 Abs. 5 Satz 2 UStDV) – prüfen, ob der Bezug an anderer Stelle steht (z. B. in einer Bemerkung, BT-22).'));
        else if (code === '381' && has('BT-25')) out.push(item('31-5', 'vorhanden', werte, 'Gutschrift/Korrektur (Code 381) mit Bezug auf die Rechnung (BT-25).'));
        else out.push(item('31-5', 'nicht zutreffend', has('BT-25') ? werte : [], has('BT-25') ? 'Verweis auf vorausgegangene Rechnung(en) (BT-25), z. B. bei einer Endrechnung; keine berichtigte Rechnung (Code ' + code + ').' : 'Keine Rechnungsberichtigung.'));
      }
      return { items: out, kleinbetrag, kleinunternehmer };
    }

    /**
     * Gesamturteil einer Rechnung (r: result of src/pruefer-core.js, findings already classified in f.ust).
     * id: keine-xml | nicht-pruefbar | format | kein-profil | pflicht | luecke | technisch | ok | unvollstaendig
     */
    function verdict(r) {
      const U = legal.urteile, H = legal.hinweise;
      const errors = (r.allFindings || []).filter((f) => f.level === 'error');
      const byClass = (k) => errors.filter((f) => f.ust && f.ust.klasse === k);
      const unknownProfile = r.profile && r.profile.family === 'unknown';
      let id;
      const encodingOrParse = byClass('format').some((f) => f.source === 'encoding') || !!(r.xml && r.xml.parseError);
      if (!r.xml) id = r.kind === 'zip' ? 'nicht-pruefbar' : 'keine-xml'; // ZIP not unpacked; PDF without invoice XML, other files
      else if (encodingOrParse) id = 'format';                       // character encoding, not well-formed XML
      else if (r.syntax === 'CII-ZUGFeRD1') id = 'kein-profil';       // ZUGFeRD 1.0: not EN 16931
      else if (!r.syntax) id = 'nicht-pruefbar';                      // XML, but no UBL/CII invoice: another format?
      else if (byClass('format').length || r.schematronSkipped === 'xsd-invalid') id = 'format'; // XML Schema
      else if (unknownProfile) id = 'nicht-pruefbar';                 // missing or unknown specification identifier
      else if (r.legalStatus === 'not-e-invoice') id = 'kein-profil'; // MINIMUM, BASIC WL
      else if (byClass('pflicht').length || byClass('unbestimmt').length) id = 'pflicht';
      else if ((r.processingErrors || []).length || (r.missingRuleSets || []).length) id = 'unvollstaendig';
      else if (errors.length) id = 'technisch';
      else id = 'ok';
      // the checklist whenever there is invoice data; a Pflichtangabe missing in the structured part (Rn. 35) is a
      // content defect even without a rule violation (Rn. 35a) – only for documents that are e-invoices
      const liste = r.model ? checklist(r.model) : null;
      const eInvoice = !['keine-xml', 'nicht-pruefbar', 'format', 'kein-profil'].includes(id);
      const fehlend = liste && eInvoice ? liste.items.filter((i) => i.status === 'fehlt').map((i) => i.id) : [];
      const zuPruefen = liste && eInvoice ? liste.items.filter((i) => i.status === 'prüfen').map((i) => i.id) : [];
      const technisch = errors.length > 0 && id !== 'pflicht';
      if (fehlend.length && (id === 'ok' || id === 'technisch' || id === 'unvollstaendig')) id = 'luecke';
      const angaben = uniq(errors.flatMap((f) => (f.ust && f.ust.angaben) || []).concat(fehlend));
      let text = U[id].text;
      if (id === 'luecke' && technisch) text += ' ' + U.luecke.zusatzTechnisch;
      if (id === 'ok' && zuPruefen.length) text += ' ' + U.ok.zusatzPruefen;
      const hinweise = [H.geltung];
      if (!eInvoice) hinweise.push(H.uebergang, H.ausnahmen);
      if (id === 'format' && byClass('format').length && byClass('format').every((f) => f.id === 'XR-ENCODING')) hinweise.push(H.kodierung);
      const bt = (r.model && r.model.bt) || {};
      const sellerCountry = (bt['BT-40'] || [])[0], buyerCountry = (bt['BT-55'] || [])[0];
      if (sellerCountry && sellerCountry !== 'DE') hinweise.push(H.ausland);
      if (buyerCountry && buyerCountry !== 'DE' && (!sellerCountry || sellerCountry === 'DE')) hinweise.push(H.kaeuferAusland);
      if (liste && liste.kleinbetrag) hinweise.push(H.kleinbetrag);
      if (liste && liste.kleinunternehmer) hinweise.push(H.kleinunternehmer);
      if ((id === 'pflicht' || id === 'luecke') && uniq((bt['BT-118'] || []).concat(bt['BT-151'] || [])).includes('AE')) hinweise.push(H.reverseCharge);
      if (r.kind === 'pdf' && r.xml) hinweise.push(H.hybrid);
      if (id !== 'unvollstaendig' && ((r.processingErrors || []).length || (r.missingRuleSets || []).length)) hinweise.push(U.unvollstaendig.text);
      return {
        id, kurz: U[id].kurz, text,
        fehler: { format: byClass('format').length, container: byClass('container').length, pflicht: byClass('pflicht').length, unbestimmt: byClass('unbestimmt').length, 'ohne-bezug': byClass('ohne-bezug').length + byClass('zusatz').length },
        angaben: angaben.map((a) => ({ id: a, norm: (angabeById[a] || {}).norm || a, text: (angabeById[a] || {}).text || '' })),
        zuPruefen,
        hinweise,
        pflichtangaben: liste,
      };
    }

    return { classify, verdict, checklist, expand, btAngaben, angabe: (id) => angabeById[id], legal, paths };
  }

  return { create, canonicalPath, refsFromText, subjectFromText };
});
