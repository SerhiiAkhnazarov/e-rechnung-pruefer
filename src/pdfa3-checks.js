/*
 * pdfa3-checks.js — container checks for hybrid e-invoices (ZUGFeRD 1.0 / 2.x, Factur-X 1.0x,
 * XRechnung in PDF): the requirements of the ZUGFeRD / Factur-X specification and of PDF/A-3
 * (ISO 19005-3) that can be decided from the PDF object structure and the XMP metadata alone.
 *
 * NOT a PDF/A validator: fonts, colour spaces, transparency, annotations, actions, the complete XMP
 * rules etc. need veraPDF (see docs/PDFA3-CHECKS.md and the CI job "pdfa-verapdf"); every report
 * says so in the info item PDFA3-FULL-VALIDATION.
 *
 * Sources of every rule (file/line citations): docs/PDFA3-CHECKS.md and the `reference` field of
 * each check below. Mustang = github.com/ZUGFeRD/mustangproject (commit c1618af86e68), the
 * reference implementation used by FeRD.
 *
 * API (async):
 *   checkContainer(bytes: Uint8Array, opts?) -> {
 *     results: [{ id, level: 'error'|'warning'|'info', message (German), reference }],   // findings
 *     checks:  [{ id, status: 'pass'|'fail'|'n/a', level, title, reference }],          // every check
 *     facts:   { header, encrypted, pdfaid, xmp, invoice, profileId, expectedLevel, ... } }
 *   CHECKS: the check catalogue (id -> { level, title, reference })
 *   opts.extracted: a result of PdfEmbedded.extractEmbeddedFiles(bytes) to reuse (optional)
 *
 * Depends on src/pdf-embedded.js (loadDocument, util primitives). Plain UMD, no dependencies.
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pdf-embedded.js'));
  else root.PdfA3Checks = factory(root.PdfEmbedded);
})(typeof self !== 'undefined' ? self : this, function (PdfEmbedded) {
  'use strict';

  const U = PdfEmbedded.util;
  const { Ref, Name, nameOf, pdfString, nameTreeEntries } = U;

  // ---------------------------------------------------------------------------------------------
  // Namespaces and value sets
  // ---------------------------------------------------------------------------------------------
  const NS = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    pdfaid: 'http://www.aiim.org/pdfa/ns/id/',
    pdfaExtension: 'http://www.aiim.org/pdfa/ns/extension/',
    pdfaSchema: 'http://www.aiim.org/pdfa/ns/schema#',
    pdfaProperty: 'http://www.aiim.org/pdfa/ns/property#',
  };
  // Mustang ZUGFeRDExporterFromA3.java l. 221-231 (getNamespaceForVersion)
  const FX_NAMESPACES = {
    'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#': { family: 'Factur-X 1.0x / ZUGFeRD 2.1+', fileNames: ['factur-x.xml', 'xrechnung.xml'] },
    'urn:zugferd:pdfa:CrossIndustryDocument:invoice:2p0#': { family: 'ZUGFeRD 2.0', fileNames: ['zugferd-invoice.xml'] },
    'urn:ferd:pdfa:CrossIndustryDocument:invoice:1p0#': { family: 'ZUGFeRD 1.0', fileNames: ['ZUGFeRD-invoice.xml'] },
  };
  // pre-release namespace of ZUGFeRD 1.0 (release candidate; found in early Mustang samples)
  const FX_NAMESPACE_RC = 'urn:ferd:pdfa:invoice:rc#';
  const FX_PROPS = ['DocumentType', 'DocumentFileName', 'Version', 'ConformanceLevel'];
  // Mustang PDFValidator.java l. 192 / 216 / 237 / 272 (accepted values)
  const MUSTANG_LEVELS = ['BASIC WL', 'BASIC', 'MINIMUM', 'EN 16931', 'COMFORT', 'CIUS', 'EXTENDED', 'EXTENDED-CTC-FR', 'XRECHNUNG'];
  const MUSTANG_DOCTYPES = ['INVOICE', 'ORDER', 'ORDER_RESPONSE', 'ORDER_CHANGE'];
  const MUSTANG_FILENAMES = ['factur-x.xml', 'ZUGFeRD-invoice.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'order-x.xml'];
  const MUSTANG_VERSIONS = ['1.0', '1p0', '2p0', '3p0', '1.2', '2.0', '2.1', '2.2', '2.3', '3.0'];
  // Mustang ZUGFeRDInvoiceImporter.java l. 286-293 (attachment names from which the XML is read)
  const INVOICE_FILENAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'ZUGFeRD-invoice.xml'];
  // ISO 32000-2 / ISO 19005-3: values of /AFRelationship
  const AFREL_ALL = ['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified'];
  // Factur-X / ZUGFeRD 2.x: values allowed for the invoice XML
  const AFREL_INVOICE = ['Data', 'Alternative', 'Source'];

  const REF = {
    iso: 'ISO 19005-3:2012 (PDF/A-3), Normtext nicht im Repository; die Regel wird im CI-Job pdfa-verapdf von veraPDF geprüft (test/compare-verapdf.cjs)',
    spec: 'ZUGFeRD 2.x / Factur-X 1.0x Spezifikation (Spezifikationstext nicht im Repository)',
    m: 'Mustangproject c1618af86e68 ',
  };
  const MV = REF.m + 'validator/src/main/java/org/mustangproject/validator/PDFValidator.java';
  const MI = REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/ZUGFeRDInvoiceImporter.java';
  const ME = REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/ZUGFeRDExporterFromA3.java';
  const MX = REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/XMPSchemaPDFAExtensions.java';
  const MP = REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/Profile.java';

  // ---------------------------------------------------------------------------------------------
  // Check catalogue
  // ---------------------------------------------------------------------------------------------
  const CHECKS = {
    'PDFA3-HEADER': { level: 'error', title: 'Dateikopf %PDF-1.n (n = 0…7) ab Byte 0', reference: REF.iso + ', 6.1.2 (File header); Mustang prüft nur %PDF am Dateianfang: ' + MV + ' l. 89-93 (section 20)' },
    'PDFA3-HEADER-BINARY': { level: 'error', title: 'Binärkommentar (mindestens 4 Bytes > 127) nach dem Dateikopf', reference: REF.iso + ', 6.1.2 (File header)' },
    'PDFA3-TRAILER-ID': { level: 'error', title: 'Dateikennung /ID im Trailer', reference: REF.iso + ', 6.1.3 (File trailer)' },
    'PDFA3-ENCRYPT': { level: 'error', title: 'keine Verschlüsselung (/Encrypt im Trailer verboten)', reference: REF.iso + ', 6.1.3 (File trailer); Mustang: nur über veraPDF (' + MV + ' l. 99-133, l. 348-350)' },
    'PDFA3-XMP-CATALOG': { level: 'error', title: 'XMP-Metadatenstrom im Dokumentkatalog (/Metadata), als XML lesbar', reference: REF.iso + ', 6.6.2.1; ' + MV + ' l. 155-157 (section 17 "Invalid XMP Metadata not found"), l. 284-287 (section 28 "Could not parse XMP metadata"); XMP wird aus dem Katalog gelesen: ' + MI + ' l. 191-198' },
    'PDFA3-PDFAID-PART': { level: 'error', title: 'pdfaid:part = 3', reference: REF.iso + ', 6.6.4 (Version and conformance level identification); ' + MV + ' l. 352-358 (section 23 "Not a PDF/A-3", Flavour aus veraPDF)' },
    'PDFA3-PDFAID-CONFORMANCE': { level: 'error', title: 'pdfaid:conformance = A, B oder U', reference: REF.iso + ', 6.6.4; ' + MV + ' l. 59 (PDFA_3_A, PDFA_3_B, PDFA_3_U)' },
    'FX-XMP-NAMESPACE': { level: 'error', title: 'Factur-X/ZUGFeRD-Eigenschaften im Namensraum urn:factur-x:… / urn:zugferd:… / urn:ferd:…', reference: REF.spec + '; Namensräume: ' + ME + ' l. 221-231 (getNamespaceForVersion). Mustang selbst sucht namensraumunabhängig (local-name()): ' + MV + ' l. 179-180' },
    'FX-XMP-DOCUMENTTYPE': { level: 'error', title: 'fx:DocumentType vorhanden und = INVOICE', reference: MV + ' l. 204-225 (section 13 "DocumentType not found", section 14 "DocumentType invalid"); Wert INVOICE: ' + REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/XMPSchemaZugferd.java l. 71' },
    'FX-XMP-DOCUMENTFILENAME': { level: 'error', title: 'fx:DocumentFileName vorhanden, zulässiger Wert', reference: MV + ' l. 226-257 (section 21 "DocumentFileName not found", section 19 "DocumentFileName contains invalid value", section 17 notice "Potentially incorrectly named XML file attachments")' },
    'FX-XMP-VERSION': { level: 'error', title: 'fx:Version vorhanden, zulässiger Wert', reference: MV + ' l. 258-283 (section 15 "Version not found", section 16 "Version contains invalid value")' },
    'FX-XMP-CONFORMANCELEVEL': { level: 'error', title: 'fx:ConformanceLevel vorhanden, zulässiger Wert', reference: MV + ' l. 179-202 (section 11 "ConformanceLevel not found", section 12 "ConformanceLevel contains invalid value")' },
    'FX-XMP-EXTENSION-SCHEMA': { level: 'error', title: 'PDF/A-Erweiterungsschema (pdfaExtension:schemas) deklariert Namensraum, Präfix und die vier Eigenschaften', reference: REF.iso + ', 6.6.2.3 (Extension schemas); Mustang schreibt das Schema: ' + MX + ' l. 114-157' },
    'FX-ATTACHMENT-PRESENT': { level: 'error', title: 'Rechnungs-XML als eingebettete Datei vorhanden', reference: REF.m + 'validator/src/main/java/org/mustangproject/validator/ZUGFeRDValidator.java l. 291-298 ("XML could not be extracted", section 17)' },
    'FX-ATTACHMENT-UNIQUE': { level: 'warning', title: 'genau eine Rechnungs-XML eingebettet', reference: REF.spec + '; Mustang liest jede Anlage mit gültigem Namen und überschreibt die vorige (' + MI + ' l. 295-302: setRawXML pro Treffer) — bei mehreren ist nicht bestimmt, welche gilt' },
    'FX-ATTACHMENT-NAME': { level: 'error', title: 'Dateiname der Rechnungs-XML (factur-x.xml, zugferd-invoice.xml, xrechnung.xml; ZUGFeRD 1.0: ZUGFeRD-invoice.xml)', reference: MI + ' l. 286-298 (validFilenames, case-sensitiv); Zuordnung Version/Profil -> Name: ' + ME + ' l. 252-264 (getFilenameForVersion)' },
    'FX-FILENAME-MATCH': { level: 'error', title: 'fx:DocumentFileName = Name der eingebetteten Rechnungs-XML', reference: REF.spec + ' (DocumentFileName bezeichnet die Anlage); Mustang schreibt beide aus demselben Wert: ' + ME + ' l. 581-583 und l. 695-708; Mustang-Validator vergleicht nicht' },
    'FX-LEVEL-PROFILE': { level: 'error', title: 'fx:ConformanceLevel passt zum Profil der XML (GuidelineSpecifiedDocumentContextParameter/ram:ID)', reference: REF.spec + '; Zuordnung Profil -> XMP-Name: ' + MP + ' l. 43-51 (getXMPName), ' + REF.m + 'library/src/main/java/org/mustangproject/ZUGFeRD/Profiles.java l. 34-50; Profilkennungen: build/rulesets.json; Mustang-Validator vergleicht nicht' },
    'PDFA3-NAMETREE': { level: 'error', title: 'Rechnungs-XML im Namensbaum /Names /EmbeddedFiles', reference: 'ISO 32000-1, 7.7.4 / 7.11.4 (Embedded file streams); Mustang liest Anlagen nur aus dem Namensbaum: ' + MI + ' l. 200-222; Erzeugung: ' + ME + ' l. 430-446' },
    'PDFA3-AF-CATALOG': { level: 'error', title: 'Katalog-/AF-Array referenziert die Dateispezifikation der Rechnung', reference: REF.iso + ', 6.8 (associated files) / ' + REF.spec + '; Mustang: ' + ME + ' l. 448-464' },
    'PDFA3-FILESPEC-F-UF': { level: 'error', title: 'Dateispezifikation mit /F und /UF', reference: REF.iso + ', 6.8; Mustang: ' + ME + ' l. 403-408' },
    'PDFA3-AFRELATIONSHIP': { level: 'error', title: '/AFRelationship vorhanden; Rechnungs-XML: Data, Alternative oder Source', reference: REF.iso + ', 6.8 (Pflichtschlüssel AFRelationship, Werte nach ISO 32000-2); Werte für die Rechnung: ' + REF.spec + ', Mustang ' + REF.m + 'library/src/main/java/org/mustangproject/FileAttachment.java l. 80-95' },
    'FX-AFRELATIONSHIP-PROFILE': { level: 'info', title: 'AFRelationship passend zum Profil (MINIMUM/BASIC WL: Data, sonst Alternative oder Source)', reference: 'ZUGFeRD 2.1.1 Technischer Anhang Teil A, 2.2.2 "Data Relationship" (Text nicht im Repository), umgesetzt in ' + ME + ' l. 697-704; nur Hinweis: die offiziellen Beispiele (corpus ZUGFeRDv2/correct/symtrax = FeRD ZUGFeRD 2.1, FNFE-factur-x-examples) verwenden /Data auch für BASIC, EN 16931 und EXTENDED' },
    'PDFA3-DESC': { level: 'info', title: 'Dateispezifikation mit /Desc (optional)', reference: 'ISO 32000-1, 7.11.3 (Desc optional); Mustang setzt /Desc: ' + ME + ' l. 409' },
    'PDFA3-EF-SUBTYPE': { level: 'error', title: 'EmbeddedFile-Strom mit /Subtype (MIME-Typ); Rechnung: text/xml (/text#2Fxml)', reference: REF.iso + ', 6.8 (MIME-Typ Pflicht); text/xml: ' + REF.spec + ', Mustang ' + ME + ' l. 707-708 und l. 415' },
    'PDFA3-EF-PARAMS-MODDATE': { level: 'warning', title: 'EmbeddedFile-Strom mit /Params /ModDate', reference: REF.spec + ' (Änderungsdatum der Anlage); Mustang setzt ModDate immer: ' + ME + ' l. 419; ob ISO 19005-3 dies verlangt, zeigt der veraPDF-Vergleich im CI' },
    'PDFA3-FULL-VALIDATION': { level: 'info', title: 'keine vollständige Prüfung gegen ISO 19005-3', reference: 'docs/PDFA3-CHECKS.md, Abschnitt "Nicht geprüft"; vollständige Prüfung: veraPDF (CI-Job pdfa-verapdf); Mustang verwendet dafür veraPDF: ' + MV + ' l. 97-137' },
  };

  // ---------------------------------------------------------------------------------------------
  // Minimal namespace-aware XML parser (for the XMP packet; no DTD, no external entities)
  // ---------------------------------------------------------------------------------------------
  // well-formedness: '&' must start one of the predefined entity or a character reference (no DTD)
  const BAD_AMP = /&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);)/;
  function decodeEntities(s, strict) {
    if (strict && BAD_AMP.test(s)) throw new Error('"&" ohne gültige Entity-Referenz');
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch (x) { return m; } }
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    });
  }

  function parseXml(text) {
    const rootEl = { local: '#document', ns: null, attrs: [], children: [], text: '' };
    const stack = [{ el: rootEl, nsmap: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
    let i = 0;
    const n = text.length;
    const fail = (msg) => { throw new Error(msg + ' at offset ' + i); };
    while (i < n) {
      const lt = text.indexOf('<', i);
      const top = stack[stack.length - 1];
      if (lt < 0) { top.el.text += decodeEntities(text.slice(i), true); break; }
      if (lt > i) top.el.text += decodeEntities(text.slice(i, lt), true);
      i = lt;
      if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i); if (e < 0) fail('unterminated PI'); i = e + 2; continue; }
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); if (e < 0) fail('unterminated comment'); i = e + 3; continue; }
      if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i); if (e < 0) fail('unterminated CDATA'); top.el.text += text.slice(i + 9, e); i = e + 3; continue; }
      if (text.startsWith('<!', i)) { const e = text.indexOf('>', i); if (e < 0) fail('unterminated declaration'); i = e + 1; continue; }
      if (text[i + 1] === '/') {
        const e = text.indexOf('>', i);
        if (e < 0) fail('unterminated end tag');
        const qn = text.slice(i + 2, e).trim();
        if (stack.length < 2 || stack[stack.length - 1].qn !== qn) fail('mismatched end tag </' + qn + '>');
        stack.pop();
        i = e + 1;
        continue;
      }
      // start tag
      const m = /^<([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)/.exec(text.slice(i, i + 256));
      if (!m) fail('invalid tag');
      const qn = m[1];
      i += m[0].length;
      const rawAttrs = [];
      for (;;) {
        while (i < n && /\s/.test(text[i])) i++;
        if (text[i] === '>' || text.startsWith('/>', i)) break;
        const am = /^([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(i, i + 65536));
        if (!am) fail('invalid attribute');
        const av = am[3] !== undefined ? am[3] : am[4];
        if (av.indexOf('<') >= 0) fail('"<" in attribute value');
        rawAttrs.push([am[1], decodeEntities(av, true)]);
        i += am[0].length;
      }
      const selfClose = text.startsWith('/>', i);
      i += selfClose ? 2 : 1;
      const nsmap = Object.assign({}, top.nsmap);
      for (const [k, v] of rawAttrs) { if (k === 'xmlns') nsmap[''] = v; else if (k.startsWith('xmlns:')) nsmap[k.slice(6)] = v; }
      const split = (q, isAttr) => { const c = q.indexOf(':'); const p = c < 0 ? '' : q.slice(0, c); const l = c < 0 ? q : q.slice(c + 1); const ns = c < 0 ? (isAttr ? null : nsmap[''] || null) : nsmap[p]; if (c >= 0 && ns === undefined) fail('undeclared prefix ' + p); return { prefix: p, local: l, ns }; };
      const nm = split(qn, false);
      const el = { local: nm.local, ns: nm.ns, prefix: nm.prefix, attrs: [], children: [], text: '', parent: top.el };
      for (const [k, v] of rawAttrs) { if (k === 'xmlns' || k.startsWith('xmlns:')) continue; const a = split(k, true); el.attrs.push({ local: a.local, ns: a.ns, value: v }); }
      top.el.children.push(el);
      if (!selfClose) stack.push({ el, nsmap, qn });
    }
    if (stack.length > 1) throw new Error('unclosed element <' + stack[stack.length - 1].qn + '>');
    return rootEl;
  }

  function* descendants(el) { for (const c of el.children) { yield c; yield* descendants(c); } }
  const textOf = (el) => { let s = el.text; for (const c of el.children) s += textOf(c); return s; };

  /** values of a property given as element <p:Name>v</p:Name> or as attribute p:Name="v" (any namespace in nsList, or any namespace if nsList is null) */
  function xmpProperty(doc, local, nsList) {
    const out = [];
    const ok = (ns) => (nsList ? nsList.includes(ns) : true);
    for (const el of descendants(doc)) {
      if (el.local === local && ok(el.ns) && el.ns !== NS.pdfaSchema && el.ns !== NS.pdfaProperty) out.push({ value: textOf(el).trim(), ns: el.ns, form: 'element' });
      if (el.ns === NS.rdf && el.local === 'Description') for (const a of el.attrs) if (a.local === local && ok(a.ns)) out.push({ value: a.value.trim(), ns: a.ns, form: 'attribute' });
    }
    return out;
  }

  /** pdfaExtension:schemas -> [{ namespaceURI, prefix, schema, properties: [name] }] (element and attribute forms) */
  function extensionSchemas(doc) {
    const schemas = [];
    const field = (el, ns, local) => {
      for (const a of el.attrs) if (a.ns === ns && a.local === local) return a.value.trim();
      for (const c of el.children) {
        if (c.ns === ns && c.local === local) return textOf(c).trim();
        if (c.ns === NS.rdf && c.local === 'Description') { const v = field(c, ns, local); if (v !== null) return v; }
      }
      return null;
    };
    for (const el of descendants(doc)) {
      if (!(el.ns === NS.pdfaExtension && el.local === 'schemas')) continue;
      for (const li of descendants(el)) {
        if (!(li.ns === NS.rdf && li.local === 'li')) continue;
        const nsUri = field(li, NS.pdfaSchema, 'namespaceURI');
        if (nsUri === null) continue;
        const props = [];
        for (const d of descendants(li)) {
          if (d.ns === NS.rdf && d.local === 'li') { const pn = field(d, NS.pdfaProperty, 'name'); if (pn !== null) props.push(pn); }
        }
        schemas.push({ namespaceURI: nsUri, prefix: field(li, NS.pdfaSchema, 'prefix'), schema: field(li, NS.pdfaSchema, 'schema'), properties: props });
      }
    }
    return schemas;
  }

  // ---------------------------------------------------------------------------------------------
  // Profile of the embedded XML -> expected XMP ConformanceLevel
  // ---------------------------------------------------------------------------------------------
  function profileIdOf(xmlBytes) {
    if (!xmlBytes) return null;
    let s;
    try { s = new TextDecoder('utf-8').decode(xmlBytes.subarray(0, Math.min(xmlBytes.length, 65536))); } catch (e) { return null; }
    const m = /GuidelineSpecifiedDocumentContextParameter\b[^>]*>\s*<(?:[\w.\-]+:)?ID\b[^>]*>([^<]*)</.exec(s);
    if (m) return { syntax: 'CII', id: decodeEntities(m[1]).replace(/\s+/g, ' ').trim() };
    const u = /<(?:[\w.\-]+:)?CustomizationID\b[^>]*>([^<]*)</.exec(s);
    if (u) return { syntax: 'UBL', id: decodeEntities(u[1]).replace(/\s+/g, ' ').trim() };
    return null;
  }

  /**
   * Expected ConformanceLevel(s) for a guideline id. Mapping = Mustang Profiles.java l. 34-50 (ids)
   * + Profile.getXMPName l. 43-51 (XMP names); ZUGFeRD 2.0 ids (urn:zugferd.de:2p0:*) and
   * XRechnung ids from build/rulesets.json. Returns { levels: [...], tolerated: [...] } or null.
   */
  function expectedLevels(id) {
    if (!id) return null;
    const x = id.toLowerCase();
    if (/^urn:ferd:(crossindustrydocument:invoice:1p0|invoice:rc):(basic|comfort|extended)$/.test(x)) return { levels: [x.split(':').pop().toUpperCase()], tolerated: [] };
    if (x === 'urn:factur-x.eu:1p0:minimum' || x === 'urn:zugferd.de:2p0:minimum') return { levels: ['MINIMUM'], tolerated: [] };
    if (x === 'urn:factur-x.eu:1p0:basicwl' || x === 'urn:zugferd.de:2p0:basicwl') return { levels: ['BASIC WL'], tolerated: [] };
    if (/^urn:cen\.eu:en16931:2017(#compliant#|:compliant:)urn:(factur-x\.eu|zugferd\.de):[12]p0:basic$/.test(x) || x === 'urn:cen.eu:en16931:2017:compliant:factur-x.eu:1p0:basic') return { levels: ['BASIC'], tolerated: [] };
    if (/^urn:cen\.eu:en16931:2017(#conformant#|:compliant:)urn:(factur-x\.eu|zugferd\.de):[12]p0:extended$/.test(x) || x === 'urn:cen.eu:en16931:2017:compliant:factur-x.eu:1p0:extended') return { levels: ['EXTENDED'], tolerated: [] };
    if (x === 'urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr') return { levels: ['EXTENDED-CTC-FR'], tolerated: ['EXTENDED'] };
    if (/xrechnung/.test(x)) return { levels: ['XRECHNUNG'], tolerated: ['EN 16931', 'CIUS'] };
    if (x === 'urn:cen.eu:en16931:2017' || x === 'urn:cen.eu:en16931:2017:compliant:factur-x.eu:1p0:en16931') return { levels: ['EN 16931'], tolerated: ['COMFORT'] };
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------------------------
  async function checkContainer(bytes, opts) {
    opts = opts || {};
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const results = [];
    const status = {};
    const facts = {};
    const add = (id, level, message, extra) => {
      results.push(Object.assign({ id, level, message, reference: CHECKS[id].reference }, extra || {}));
      if (level === 'error' || level === 'warning') status[id] = 'fail';
      else if (!status[id]) status[id] = 'pass';
    };
    const pass = (id) => { if (!status[id]) status[id] = 'pass'; };
    const na = (id) => { if (!status[id]) status[id] = 'n/a'; };

    // --- header ---------------------------------------------------------------------------------
    const head = U.latin1(bytes, 0, Math.min(bytes.length, 64));
    const hm = /^%PDF-(\d+\.\d+)/.exec(head);
    facts.header = hm ? hm[1] : null;
    if (!hm) add('PDFA3-HEADER', 'error', head.indexOf('%PDF-') > 0 ? 'Der Dateikopf %PDF- steht nicht am Dateianfang (Byte 0).' : 'Kein PDF-Dateikopf (%PDF-) gefunden.');
    else if (!/^1\.[0-7]$/.test(hm[1])) add('PDFA3-HEADER', 'error', 'PDF-Version ' + hm[1] + ' im Dateikopf; PDF/A-3 verlangt %PDF-1.0 bis %PDF-1.7.');
    else if (!/^%PDF-1\.[0-7](\r\n|\r|\n)/.test(head)) add('PDFA3-HEADER', 'error', 'Auf den Dateikopf %PDF-' + hm[1] + ' folgt kein Zeilenende.');
    else pass('PDFA3-HEADER');
    if (hm) {
      const lm = /^%PDF-\d\.\d(?:\r\n|\r|\n)%([^\r\n]*)/.exec(head);
      const high = lm ? Array.from(lm[1]).filter((c) => c.charCodeAt(0) > 127).length : 0;
      facts.headerBinaryBytes = high;
      if (!lm || high < 4) add('PDFA3-HEADER-BINARY', 'error', 'Nach dem Dateikopf fehlt der Binärkommentar (% gefolgt von mindestens vier Bytes > 127)' + (lm ? '; gefunden: ' + high + ' solche Bytes' : '') + '.');
      else pass('PDFA3-HEADER-BINARY');
    } else na('PDFA3-HEADER-BINARY');

    // --- object graph ---------------------------------------------------------------------------
    const doc = await PdfEmbedded.loadDocument(bytes, []);
    const resolve = doc.resolve;
    facts.method = doc.method;
    let catalog = doc.trailer ? resolve(doc.trailer.get('Root')) : null;
    let encrypted = !!(doc.trailer && doc.trailer.has('Encrypt'));
    if (!doc.trailer) {
      // scan fallback: no trailer dictionary through the xref; take the last /Type /Catalog object
      let best = null;
      for (const o of doc.objects.values()) if (o.dict && nameOf(resolve(o.dict.get('Type'))) === 'Catalog' && (!best || o.offset > best.offset)) best = o;
      catalog = best ? best.dict : null;
      // trailer dictionaries ("trailer << ... >>") are searched textually
      encrypted = /trailer\s*<<[\s\S]{0,4096}?\/Encrypt\b/.test(U.latin1(bytes, Math.max(0, bytes.length - 65536), bytes.length));
      for (const o of doc.objects.values()) if (o.dict && nameOf(resolve(o.dict.get('Type'))) === 'XRef' && o.dict.has('Encrypt')) encrypted = true;
    }
    facts.encrypted = encrypted;
    if (doc.trailer) {
      const id = resolve(doc.trailer.get('ID'));
      facts.trailerId = Array.isArray(id) && id.length === 2 && id.every((x) => x && x.string);
      if (!facts.trailerId) add('PDFA3-TRAILER-ID', 'error', doc.trailer.has('ID') ? 'Der Trailer-Eintrag /ID ist kein Array aus zwei Zeichenketten.' : 'Der Trailer enthält keine Dateikennung /ID.');
      else pass('PDFA3-TRAILER-ID');
    } else na('PDFA3-TRAILER-ID');
    if (encrypted) add('PDFA3-ENCRYPT', 'error', 'Das PDF ist verschlüsselt (/Encrypt im Trailer). PDF/A-3 verbietet Verschlüsselung; eingebettete Dateien sind ggf. nicht lesbar.');
    else pass('PDFA3-ENCRYPT');
    if (!(catalog instanceof Map)) catalog = null;
    facts.catalogFound = !!catalog;

    // --- XMP in the catalog ---------------------------------------------------------------------
    let xmpDoc = null;
    const mdRef = catalog ? catalog.get('Metadata') : null;
    let mdObj = null;
    if (mdRef instanceof Ref) mdObj = doc.objects.get(mdRef.num) || null;
    if (!catalog) add('PDFA3-XMP-CATALOG', 'error', 'Dokumentkatalog nicht gefunden; XMP-Metadaten nicht prüfbar.');
    else if (!mdObj || mdObj.streamStart < 0) add('PDFA3-XMP-CATALOG', 'error', 'Der Dokumentkatalog enthält keinen XMP-Metadatenstrom (/Metadata).');
    else {
      try {
        const raw = U.streamBytes(bytes, mdObj, resolve, []);
        const { data, filters } = await U.decodeStream({ dict: mdObj.dict, raw }, resolve, []);
        facts.xmpFilters = filters;
        let text = new TextDecoder('utf-8').decode(data);
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        facts.xmpObject = mdObj.num;
        try { xmpDoc = parseXml(text); pass('PDFA3-XMP-CATALOG'); } catch (e) { add('PDFA3-XMP-CATALOG', 'error', 'Die XMP-Metadaten (Objekt ' + mdObj.num + ') sind kein wohlgeformtes XML: ' + e.message + '.'); }
      } catch (e) { add('PDFA3-XMP-CATALOG', 'error', 'Der XMP-Metadatenstrom (Objekt ' + mdObj.num + ') kann nicht dekodiert werden: ' + e.message + '.'); }
    }

    // --- pdfaid -----------------------------------------------------------------------------------
    const xmpIds = ['PDFA3-PDFAID-PART', 'PDFA3-PDFAID-CONFORMANCE', 'FX-XMP-NAMESPACE', 'FX-XMP-DOCUMENTTYPE', 'FX-XMP-DOCUMENTFILENAME', 'FX-XMP-VERSION', 'FX-XMP-CONFORMANCELEVEL', 'FX-XMP-EXTENSION-SCHEMA'];
    const fx = {};
    let fxNs = null;
    if (!xmpDoc) { for (const id of xmpIds) na(id); }
    else {
      const part = xmpProperty(xmpDoc, 'part', [NS.pdfaid]);
      const conf = xmpProperty(xmpDoc, 'conformance', [NS.pdfaid]);
      facts.pdfaid = { part: part.length ? part[0].value : null, conformance: conf.length ? conf[0].value : null };
      if (!part.length) add('PDFA3-PDFAID-PART', 'error', 'pdfaid:part fehlt in den XMP-Metadaten (keine PDF/A-Kennung).');
      else if (part[0].value !== '3') add('PDFA3-PDFAID-PART', 'error', 'pdfaid:part = ' + part[0].value + '; ZUGFeRD/Factur-X verlangt PDF/A-3.');
      else pass('PDFA3-PDFAID-PART');
      if (!conf.length) add('PDFA3-PDFAID-CONFORMANCE', 'error', 'pdfaid:conformance fehlt in den XMP-Metadaten.');
      else if (!['A', 'B', 'U'].includes(conf[0].value)) add('PDFA3-PDFAID-CONFORMANCE', 'error', 'pdfaid:conformance = "' + conf[0].value + '"; zulässig sind A, B oder U.');
      else pass('PDFA3-PDFAID-CONFORMANCE');

      // --- Factur-X / ZUGFeRD properties ------------------------------------------------------------
      const any = {};
      for (const p of FX_PROPS) any[p] = xmpProperty(xmpDoc, p, null);
      const nsSeen = new Set();
      for (const p of FX_PROPS) for (const v of any[p]) nsSeen.add(v.ns);
      const known = Array.from(nsSeen).filter((ns) => FX_NAMESPACES[ns] || ns === FX_NAMESPACE_RC);
      fxNs = known[0] || null;
      facts.fxNamespace = fxNs || (nsSeen.size ? Array.from(nsSeen)[0] : null);
      if (!nsSeen.size) add('FX-XMP-NAMESPACE', 'error', 'Die XMP-Metadaten enthalten keine Factur-X/ZUGFeRD-Eigenschaften (DocumentType, DocumentFileName, Version, ConformanceLevel).');
      else if (!fxNs) add('FX-XMP-NAMESPACE', 'error', 'Die Factur-X/ZUGFeRD-Eigenschaften stehen im unbekannten Namensraum ' + Array.from(nsSeen).join(', ') + '.');
      else if (fxNs === FX_NAMESPACE_RC) add('FX-XMP-NAMESPACE', 'warning', 'Namensraum ' + FX_NAMESPACE_RC + ' ist der Vorabversions-Namensraum (Release Candidate) von ZUGFeRD 1.0, kein Namensraum einer veröffentlichten Version.');
      else if (known.length > 1) add('FX-XMP-NAMESPACE', 'warning', 'Factur-X/ZUGFeRD-Eigenschaften in mehreren Namensräumen: ' + known.join(', ') + '.');
      else pass('FX-XMP-NAMESPACE');
      for (const p of FX_PROPS) {
        const vals = fxNs ? any[p].filter((v) => v.ns === fxNs) : any[p];
        fx[p] = vals.length ? vals[0].value : null;
      }
      facts.xmp = Object.assign({}, fx);
      const noFx = !nsSeen.size; // already reported once by FX-XMP-NAMESPACE

      if (noFx) na('FX-XMP-DOCUMENTTYPE');
      else if (fx.DocumentType === null) add('FX-XMP-DOCUMENTTYPE', 'error', 'fx:DocumentType fehlt in den XMP-Metadaten.');
      else if (fx.DocumentType !== 'INVOICE') add('FX-XMP-DOCUMENTTYPE', 'error', 'fx:DocumentType = "' + fx.DocumentType + '"; für eine Rechnung ist INVOICE vorgeschrieben' + (MUSTANG_DOCTYPES.includes(fx.DocumentType) ? ' (' + fx.DocumentType + ' bezeichnet ein Order-X-Dokument).' : '.'));
      else pass('FX-XMP-DOCUMENTTYPE');

      if (noFx) na('FX-XMP-DOCUMENTFILENAME');
      else if (fx.DocumentFileName === null) add('FX-XMP-DOCUMENTFILENAME', 'error', 'fx:DocumentFileName fehlt in den XMP-Metadaten.');
      else if (!MUSTANG_FILENAMES.includes(fx.DocumentFileName)) add('FX-XMP-DOCUMENTFILENAME', 'error', 'fx:DocumentFileName = "' + fx.DocumentFileName + '" ist kein zulässiger Dateiname (' + MUSTANG_FILENAMES.filter((x) => x !== 'order-x.xml').join(', ') + ').');
      else pass('FX-XMP-DOCUMENTFILENAME');

      if (noFx) na('FX-XMP-VERSION');
      else if (fx.Version === null) add('FX-XMP-VERSION', 'error', 'fx:Version fehlt in den XMP-Metadaten.');
      else if (!MUSTANG_VERSIONS.includes(fx.Version)) add('FX-XMP-VERSION', 'error', 'fx:Version = "' + fx.Version + '" ist kein zulässiger Wert (' + MUSTANG_VERSIONS.join(', ') + ').');
      else pass('FX-XMP-VERSION');

      if (noFx) na('FX-XMP-CONFORMANCELEVEL');
      else if (fx.ConformanceLevel === null) add('FX-XMP-CONFORMANCELEVEL', 'error', 'fx:ConformanceLevel fehlt in den XMP-Metadaten.');
      else if (!MUSTANG_LEVELS.includes(fx.ConformanceLevel)) add('FX-XMP-CONFORMANCELEVEL', 'error', 'fx:ConformanceLevel = "' + fx.ConformanceLevel + '" ist kein zulässiger Wert (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED, XRECHNUNG; ZUGFeRD 1.0: BASIC, COMFORT, EXTENDED).');
      else pass('FX-XMP-CONFORMANCELEVEL');

      // --- extension schema --------------------------------------------------------------------------
      const schemas = extensionSchemas(xmpDoc);
      facts.extensionSchemas = schemas.map((s) => s.namespaceURI);
      const usedNs = facts.fxNamespace;
      if (usedNs) {
        const decl = schemas.find((s) => s.namespaceURI === usedNs);
        if (!schemas.length) add('FX-XMP-EXTENSION-SCHEMA', 'error', 'Die XMP-Metadaten enthalten kein PDF/A-Erweiterungsschema (pdfaExtension:schemas); die Factur-X/ZUGFeRD-Eigenschaften sind damit in PDF/A nicht zulässig.');
        else if (!decl) add('FX-XMP-EXTENSION-SCHEMA', 'error', 'Das PDF/A-Erweiterungsschema deklariert den Namensraum ' + usedNs + ' nicht (deklariert: ' + schemas.map((s) => s.namespaceURI).join(', ') + ').');
        else {
          const usedProps = FX_PROPS.filter((p) => any[p].some((v) => v.ns === usedNs));
          const missing = usedProps.filter((p) => !decl.properties.includes(p));
          const prefixes = new Set();
          for (const el of descendants(xmpDoc)) { if (el.ns === usedNs) prefixes.add(el.prefix); }
          if (missing.length) add('FX-XMP-EXTENSION-SCHEMA', 'error', 'Das PDF/A-Erweiterungsschema für ' + usedNs + ' deklariert die Eigenschaft(en) ' + missing.join(', ') + ' nicht.');
          else if (!decl.prefix) add('FX-XMP-EXTENSION-SCHEMA', 'error', 'Das PDF/A-Erweiterungsschema für ' + usedNs + ' enthält kein pdfaSchema:prefix.');
          else if (prefixes.size && !prefixes.has(decl.prefix)) add('FX-XMP-EXTENSION-SCHEMA', 'warning', 'Das Erweiterungsschema deklariert das Präfix "' + decl.prefix + '", verwendet wird "' + Array.from(prefixes).join('", "') + '".');
          else pass('FX-XMP-EXTENSION-SCHEMA');
        }
      } else na('FX-XMP-EXTENSION-SCHEMA');
    }

    // --- embedded files ---------------------------------------------------------------------------
    const extracted = opts.extracted || await PdfEmbedded.extractEmbeddedFiles(bytes);
    // the invoice attachment: the one named by fx:DocumentFileName, otherwise the heuristic of pdf-embedded.js
    const INVOICE_ROOTS = ['CrossIndustryInvoice', 'CrossIndustryDocument', 'Invoice', 'CreditNote'];
    const isInvoiceLike = (f) => INVOICE_FILENAMES.includes(f.name) || INVOICE_ROOTS.includes(U.rootElementName(f.bytes || new Uint8Array(0)) || '');
    const byXmpName = fx.DocumentFileName ? extracted.files.find((f) => f.name === fx.DocumentFileName && isInvoiceLike(f)) : null;
    const invoiceFile = byXmpName || PdfEmbedded.pickInvoiceXml(extracted.files);
    const invoiceLike = extracted.files.filter(isInvoiceLike);
    if (!invoiceFile) na('FX-ATTACHMENT-UNIQUE');
    else if (invoiceLike.length > 1) add('FX-ATTACHMENT-UNIQUE', 'warning', 'Das PDF enthält ' + invoiceLike.length + ' Rechnungs-XML-Dateien (' + invoiceLike.map((f) => f.name).join(', ') + '); maßgeblich ist nach fx:DocumentFileName "' + invoiceFile.name + '". Empfänger können eine andere Datei auswerten.');
    else pass('FX-ATTACHMENT-UNIQUE');
    // file specifications of the name tree
    const names = catalog ? resolve(catalog.get('Names')) : null;
    const treeSpecs = [];
    if (names instanceof Map && names.has('EmbeddedFiles')) {
      for (const [key, spec] of nameTreeEntries(names.get('EmbeddedFiles'), resolve)) { const sp = resolve(spec); if (sp instanceof Map) treeSpecs.push({ key, ref: spec instanceof Ref ? spec.num : null, dict: sp }); }
    }
    // catalog /AF
    const afArr = catalog ? resolve(catalog.get('AF')) : null;
    const afRefs = Array.isArray(afArr) ? afArr.filter((x) => x instanceof Ref).map((x) => x.num) : [];
    const afDicts = Array.isArray(afArr) ? afArr.map((x) => resolve(x)).filter((x) => x instanceof Map) : [];
    facts.catalogAF = Array.isArray(afArr) ? afArr.length : null;
    const efRefOf = (sp) => { const ef = resolve(sp.get('EF')); if (!(ef instanceof Map)) return null; const r = ef.get('UF') || ef.get('F'); return r instanceof Ref ? r.num : null; };
    const specName = (sp) => pdfString(resolve(sp.get('UF'))) || pdfString(resolve(sp.get('F'))) || null;
    // the file specification of the invoice: the one whose EF stream is the invoice file
    let invSpec = null;
    if (invoiceFile) {
      invSpec = treeSpecs.find((s) => efRefOf(s.dict) === invoiceFile.objectNumber) || null;
      if (!invSpec) {
        // not in the name tree: look among all file specifications of the document
        for (const o of doc.objects.values()) {
          if (o.dict && o.dict.has('EF') && efRefOf(o.dict) === invoiceFile.objectNumber) { invSpec = { key: null, ref: o.num, dict: o.dict, outsideTree: true }; break; }
        }
      }
    }
    facts.attachments = extracted.files.map((f) => f.name);
    facts.invoice = invoiceFile ? { name: invoiceFile.name, objectNumber: invoiceFile.objectNumber, mimeType: invoiceFile.mimeType, afRelationship: invoiceFile.afRelationship } : null;

    const attachIds = ['FX-ATTACHMENT-NAME', 'FX-FILENAME-MATCH', 'FX-LEVEL-PROFILE', 'PDFA3-NAMETREE', 'PDFA3-AF-CATALOG', 'FX-AFRELATIONSHIP-PROFILE'];
    if (!invoiceFile) {
      add('FX-ATTACHMENT-PRESENT', 'error', extracted.files.length ? 'Unter den eingebetteten Dateien (' + extracted.files.map((f) => f.name).join(', ') + ') ist keine Rechnungs-XML.' : 'Das PDF enthält keine eingebetteten Dateien, also keine Rechnungs-XML.');
      for (const id of attachIds) na(id);
    } else {
      pass('FX-ATTACHMENT-PRESENT');
      const name = invoiceFile.name;
      // --- file name -------------------------------------------------------------------------------
      if (!INVOICE_FILENAMES.includes(name)) {
        const ci = INVOICE_FILENAMES.find((x) => x.toLowerCase() === String(name).toLowerCase());
        add('FX-ATTACHMENT-NAME', 'error', 'Die Rechnungs-XML ist als "' + name + '" eingebettet' + (ci ? ' (Groß-/Kleinschreibung weicht von "' + ci + '" ab)' : '') + '; zulässig sind factur-x.xml (Factur-X / ZUGFeRD 2.1+), zugferd-invoice.xml (ZUGFeRD 2.0), xrechnung.xml (Profil XRECHNUNG) und ZUGFeRD-invoice.xml (ZUGFeRD 1.0). Empfänger wie Mustang lesen die XML unter diesem Namen nicht.');
      } else {
        const nsInfo = fxNs ? FX_NAMESPACES[fxNs] : null;
        if (name === 'ZUGFeRD-invoice.xml') add('FX-ATTACHMENT-NAME', 'info', 'ZUGFeRD-invoice.xml ist der Dateiname von ZUGFeRD 1.0 (veraltet; ZUGFeRD 2.x/Factur-X: factur-x.xml).');
        if (nsInfo && !nsInfo.fileNames.includes(name)) add('FX-ATTACHMENT-NAME', 'warning', 'Der Dateiname "' + name + '" passt nicht zum XMP-Namensraum ' + fxNs + ' (' + nsInfo.family + ': ' + nsInfo.fileNames.join(' / ') + ').');
        else if (name === 'xrechnung.xml' && fx.ConformanceLevel && fx.ConformanceLevel !== 'XRECHNUNG') add('FX-ATTACHMENT-NAME', 'warning', 'xrechnung.xml ist nur für das Profil XRECHNUNG vorgesehen; fx:ConformanceLevel = "' + fx.ConformanceLevel + '".');
        else if (name === 'factur-x.xml' && fx.ConformanceLevel === 'XRECHNUNG') add('FX-ATTACHMENT-NAME', 'info', 'Profil XRECHNUNG mit Dateiname factur-x.xml; ab ZUGFeRD 2.1.1 ist für XRECHNUNG auch xrechnung.xml zulässig (Mustang erzeugt xrechnung.xml).');
        else pass('FX-ATTACHMENT-NAME');
      }
      // --- DocumentFileName = embedded name -------------------------------------------------------
      if (!xmpDoc || fx.DocumentFileName === null || fx.DocumentFileName === undefined) na('FX-FILENAME-MATCH');
      else if (fx.DocumentFileName !== name) add('FX-FILENAME-MATCH', 'error', 'fx:DocumentFileName = "' + fx.DocumentFileName + '", die Rechnungs-XML ist jedoch als "' + name + '" eingebettet.');
      else pass('FX-FILENAME-MATCH');
      // --- ConformanceLevel vs. profile -------------------------------------------------------------
      const prof = profileIdOf(invoiceFile.bytes);
      facts.profileId = prof ? prof.id : null;
      facts.syntax = prof ? prof.syntax : null;
      const exp = prof && prof.syntax === 'CII' ? expectedLevels(prof.id) : null;
      facts.expectedLevel = exp ? exp.levels[0] : null;
      if (!xmpDoc || !fx.ConformanceLevel) na('FX-LEVEL-PROFILE');
      else if (!prof) add('FX-LEVEL-PROFILE', 'warning', 'Die Profilkennung der Rechnungs-XML (GuidelineSpecifiedDocumentContextParameter/ID) wurde nicht gefunden; fx:ConformanceLevel ist nicht abgleichbar.');
      else if (prof.syntax === 'UBL') add('FX-LEVEL-PROFILE', 'error', 'Die eingebettete Rechnung ist UBL (CustomizationID ' + prof.id + '); ZUGFeRD/Factur-X betten CII (CrossIndustryInvoice) ein, fx:ConformanceLevel "' + fx.ConformanceLevel + '" bezeichnet ein CII-Profil.');
      else if (!exp) add('FX-LEVEL-PROFILE', 'warning', 'Profilkennung "' + prof.id + '" ist keinem ZUGFeRD/Factur-X-Profil zugeordnet; fx:ConformanceLevel "' + fx.ConformanceLevel + '" nicht abgleichbar.');
      else if (exp.levels.includes(fx.ConformanceLevel)) pass('FX-LEVEL-PROFILE');
      else if (exp.tolerated.includes(fx.ConformanceLevel)) add('FX-LEVEL-PROFILE', 'warning', 'fx:ConformanceLevel = "' + fx.ConformanceLevel + '", die XML trägt die Profilkennung ' + prof.id + ' (erwartet: ' + exp.levels.join(' / ') + '). Der Wert ist inhaltlich nicht falsch, entspricht aber nicht der aktuellen Spezifikation.');
      else add('FX-LEVEL-PROFILE', 'error', 'fx:ConformanceLevel = "' + fx.ConformanceLevel + '" widerspricht dem Profil der eingebetteten XML (' + prof.id + ' => ' + exp.levels.join(' / ') + ').');
      // --- name tree / AF ------------------------------------------------------------------------
      if (!invSpec || invSpec.outsideTree) add('PDFA3-NAMETREE', 'error', 'Die Dateispezifikation der Rechnungs-XML "' + name + '" ist nicht im Namensbaum /Names /EmbeddedFiles eingetragen.');
      else pass('PDFA3-NAMETREE');
      if (!Array.isArray(afArr)) add('PDFA3-AF-CATALOG', 'error', 'Der Dokumentkatalog hat kein /AF-Array (Associated Files); die Rechnungs-XML ist dem Dokument nicht zugeordnet.');
      else if (!invSpec || !((invSpec.ref !== null && afRefs.includes(invSpec.ref)) || afDicts.includes(invSpec.dict))) {
        // a different file specification object in /AF that points to the same EmbeddedFile stream
        const twinIdx = afDicts.findIndex((d) => efRefOf(d) === invoiceFile.objectNumber);
        if (twinIdx >= 0) add('PDFA3-AF-CATALOG', 'warning', 'Das /AF-Array des Katalogs referenziert für "' + name + '" eine zweite Dateispezifikation' + (afArr[twinIdx] instanceof Ref ? ' (Objekt ' + afArr[twinIdx].num + ')' : '') + ', nicht die des Namensbaums' + (invSpec && invSpec.ref !== null ? ' (Objekt ' + invSpec.ref + ')' : '') + '; beide verweisen auf denselben Dateistrom (Objekt ' + invoiceFile.objectNumber + '). Die im Namensbaum eingetragene Dateispezifikation ist damit keine zugeordnete Datei (Associated File).');
        else add('PDFA3-AF-CATALOG', 'error', 'Das /AF-Array des Katalogs referenziert die Dateispezifikation der Rechnungs-XML "' + name + '" nicht.');
      }
      else pass('PDFA3-AF-CATALOG');
    }

    // --- per file specification (every embedded file, the invoice most strictly) -------------------
    const specs = treeSpecs.slice();
    if (invSpec && invSpec.outsideTree) specs.push(invSpec);
    const perSpecIds = ['PDFA3-FILESPEC-F-UF', 'PDFA3-AFRELATIONSHIP', 'PDFA3-DESC', 'PDFA3-EF-SUBTYPE', 'PDFA3-EF-PARAMS-MODDATE'];
    if (!specs.length) { for (const id of perSpecIds) na(id); if (!invoiceFile) na('FX-AFRELATIONSHIP-PROFILE'); }
    for (const s of specs) {
      const sp = s.dict;
      const isInv = invSpec && sp === invSpec.dict;
      const label = (isInv ? 'Rechnungs-XML ' : 'Anlage ') + '"' + (specName(sp) || s.key || '?') + '"';
      const hasF = sp.has('F'), hasUF = sp.has('UF');
      if (!hasF || !hasUF) add('PDFA3-FILESPEC-F-UF', 'error', label + ': der Dateispezifikation fehlt ' + (!hasF && !hasUF ? '/F und /UF' : !hasF ? '/F' : '/UF') + '.');
      else pass('PDFA3-FILESPEC-F-UF');
      const rel = nameOf(resolve(sp.get('AFRelationship')));
      if (!sp.has('AFRelationship')) add('PDFA3-AFRELATIONSHIP', 'error', label + ': /AFRelationship fehlt (Pflicht in PDF/A-3).');
      else if (!rel || !AFREL_ALL.includes(rel)) add('PDFA3-AFRELATIONSHIP', 'error', label + ': /AFRelationship = ' + (rel ? '/' + rel : 'kein Name') + ' ist kein zulässiger Wert (' + AFREL_ALL.join(', ') + ').');
      else if (isInv && !AFREL_INVOICE.includes(rel)) add('PDFA3-AFRELATIONSHIP', 'error', label + ': /AFRelationship = /' + rel + '; für die Rechnungs-XML sind nur Data, Alternative und Source zulässig.');
      else pass('PDFA3-AFRELATIONSHIP');
      if (isInv) {
        const lvl = fx.ConformanceLevel || facts.expectedLevel;
        if (!rel || !AFREL_INVOICE.includes(rel) || !lvl) na('FX-AFRELATIONSHIP-PROFILE');
        else if ((lvl === 'MINIMUM' || lvl === 'BASIC WL') && rel !== 'Data') add('FX-AFRELATIONSHIP-PROFILE', 'info', label + ': Profil ' + lvl + ' ist keine vollständige Rechnung im Sinne von EN 16931; vorgesehen ist /AFRelationship /Data, gefunden /' + rel + '.');
        else if (!(lvl === 'MINIMUM' || lvl === 'BASIC WL') && rel === 'Data') add('FX-AFRELATIONSHIP-PROFILE', 'info', label + ': für das Profil ' + lvl + ' sieht ZUGFeRD 2.1.1 /AFRelationship /Alternative (oder /Source) vor, gefunden /Data (in den offiziellen Beispielen ebenfalls üblich).');
        else pass('FX-AFRELATIONSHIP-PROFILE');
      }
      if (!sp.has('Desc')) add('PDFA3-DESC', 'info', label + ': keine Beschreibung (/Desc) — optional.');
      else pass('PDFA3-DESC');
      // the EmbeddedFile stream
      const efNum = efRefOf(sp);
      const efObj = efNum !== null ? doc.objects.get(efNum) : null;
      const efDict = efObj && efObj.dict ? efObj.dict : null;
      if (!efDict) { add('PDFA3-EF-SUBTYPE', 'error', label + ': der eingebettete Dateistrom (/EF) ist nicht auffindbar.'); continue; }
      const sub = resolve(efDict.get('Subtype'));
      const mime = nameOf(sub);
      if (!mime) add('PDFA3-EF-SUBTYPE', 'error', label + ': dem EmbeddedFile-Strom fehlt /Subtype (MIME-Typ).');
      else if (!/^[A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+$/.test(mime)) add('PDFA3-EF-SUBTYPE', 'error', label + ': /Subtype "' + mime + '" ist kein MIME-Typ.');
      else if (isInv && mime !== 'text/xml') add('PDFA3-EF-SUBTYPE', 'warning', label + ': /Subtype = ' + mime + '; für die Rechnungs-XML ist text/xml (/text#2Fxml) vorgesehen.');
      else pass('PDFA3-EF-SUBTYPE');
      const params = resolve(efDict.get('Params'));
      if (!(params instanceof Map)) add('PDFA3-EF-PARAMS-MODDATE', 'warning', label + ': dem EmbeddedFile-Strom fehlt /Params (mit /ModDate).');
      else if (!params.has('ModDate')) add('PDFA3-EF-PARAMS-MODDATE', 'warning', label + ': /Params des EmbeddedFile-Stroms enthält kein /ModDate.');
      else pass('PDFA3-EF-PARAMS-MODDATE');
    }

    add('PDFA3-FULL-VALIDATION', 'info', 'Geprüft wurden nur die Container-Anforderungen von ZUGFeRD/Factur-X und die strukturell entscheidbaren PDF/A-3-Regeln. Eine vollständige Prüfung gegen ISO 19005-3 (Schriften, Farbräume, Transparenz, Annotationen, Aktionen, vollständige XMP-Regeln u. a.) wurde NICHT durchgeführt; dafür ist ein PDF/A-Validator wie veraPDF nötig.');

    const checks = Object.keys(CHECKS).map((id) => ({ id, status: status[id] || 'n/a', level: CHECKS[id].level, title: CHECKS[id].title, reference: CHECKS[id].reference }));
    return { results, checks, facts };
  }

  return { checkContainer, CHECKS, _internal: { parseXml, xmpProperty, extensionSchemas, profileIdOf, expectedLevels } };
});
