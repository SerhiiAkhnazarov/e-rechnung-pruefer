/*
 * pruefer-core.js — the complete check pipeline, shared by the browser app (src/app.js) and the Node CLI
 * (tools/pruefer-cli.cjs), so that both produce identical results:
 *
 *   bytes ─► PDF? ─► embedded invoice XML + PDF/A-3 container checks (src/pdfa3-checks.js)
 *         ─► character encoding (src/xml-encoding.js, XML 1.0 §4.3.3) ─► XML parsing
 *         ─► syntax (UBL Invoice / CreditNote / CII) ─► specification identifier (BT-24)
 *         ─► routing:
 *              KoSIT   — a scenario of the KoSIT XRechnung configuration matches (build/scenarios.json) and the
 *                        identifier is not a Factur-X/ZUGFeRD profile inside a PDF: exactly the KoSIT validator's
 *                        processing (XSD of the scenario; Schematron only if schema-valid; customLevel;
 *                        assessment of default-report.xsl);
 *              profile — otherwise the entry of build/rulesets.json (Factur-X/ZUGFeRD profiles, Peppol BIS,
 *                        EN 16931 without CIUS, outdated XRechnung): its XSD model, then its rule sets;
 *         ─► findings with line numbers, counts, assessment, invoice data model,
 *         ─► umsatzsteuerliche Einordnung of every finding and of the invoice (src/vat-relevance.js; with env.VatRelevance
 *            and env.vatData = {legal: legal/ust-pflichtangaben.json, paths: build/bt-paths.json}).
 *
 * Rule sets and XSD models are provided by the host (env.ruleSet(id), env.xsdModel(id)); a rule set that the
 * host does not have (the Peppol rules are not redistributed, see docs/RULESETS.md) is reported in
 * result.missingRuleSets and the assessment says that the check is incomplete.
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrueferCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVEL_ORDER = { error: 0, warning: 1, information: 2 };
  const SOURCE_ORDER = { encoding: 0, pdf: 1, xsd: 2, schematron: 3 };

  // ---------------------------------------------------------------------------------------------
  // profile labels and legal notes (shown to the user; the rule selection itself is data:
  // build/scenarios.json and build/rulesets.json)
  // ---------------------------------------------------------------------------------------------
  function profileTable(props) {
    const XR = props;
    return [
      { test: (id) => id === XR['xrechnung.spec.id'], label: 'XRechnung ' + XR['xrechnung.version'] + ' (CIUS)', family: 'XRechnung', en16931: true },
      { test: (id) => id === XR['xrechnung.extension.id'], label: 'XRechnung ' + XR['xrechnung.version'] + ' Extension', family: 'XRechnung', en16931: true },
      { test: (id) => id === XR['xrechnung.cvd.id'], label: 'XRechnung ' + XR['xrechnung.version'] + ' CVD (Clean Vehicles)', family: 'XRechnung', en16931: true },
      { test: (id) => /^urn:cen\.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_(\d+\.\d+)/.test(id), label: (id) => 'XRechnung ' + /xrechnung_(\d+\.\d+)/.exec(id)[1] + ' (veraltet)', family: 'XRechnung', en16931: true, note: 'Veraltete XRechnung-Version. Seit dem 1. Februar 2024 ist XRechnung 3.0.x für Rechnungen an Bundesbehörden verbindlich; die Version 2.3.1 soll nicht mehr verwendet werden (e-rechnung-bund.de). Der aktuelle KoSIT-Validator (Konfiguration ' + XR['validator.configuration.version.full'] + ') kennt nur XRechnung ' + XR['xrechnung.version'] + ' und würde dieses Dokument mangels eines passenden Szenarios zurückweisen. Geprüft wurden hier nur die EN-16931-Regeln.' },
      { test: (id) => id === 'urn:cen.eu:en16931:2017', label: 'EN 16931 (Kernrechnung) / ZUGFeRD / Factur-X EN 16931', family: 'EN16931', en16931: true },
      { test: (id) => /^urn:cen\.eu:en16931:2017#compliant#urn:(factur-x\.eu:1p0|zugferd\.de:2p0):basic$/.test(id), label: (id) => (/zugferd\.de:2p0/.test(id) ? 'ZUGFeRD 2.0 BASIC (alte Kennung)' : 'ZUGFeRD / Factur-X BASIC'), family: 'ZUGFeRD', en16931: true },
      { test: (id) => /^urn:cen\.eu:en16931:2017#conformant#urn:(factur-x\.eu:1p0|zugferd\.de:2p0):extended$/.test(id), label: (id) => (/zugferd\.de:2p0/.test(id) ? 'ZUGFeRD 2.0 EXTENDED (alte Kennung)' : 'ZUGFeRD / Factur-X EXTENDED'), family: 'ZUGFeRD', en16931: true, note: 'EXTENDED ist eine Erweiterung der EN 16931 („conformant“): Geprüft werden die Regeln des Profils EXTENDED von Factur-X 1.09.2 / ZUGFeRD 2.5.2.' },
      { test: (id) => id === 'urn:factur-x.eu:1p0:minimum' || id === 'urn:zugferd.de:2p0:minimum', label: 'ZUGFeRD / Factur-X MINIMUM', family: 'ZUGFeRD', en16931: false, note: 'Das Profil MINIMUM enthält nicht alle Pflichtfelder der EN 16931 und ist in Deutschland keine E-Rechnung im Sinne des § 14 Abs. 1 UStG, sondern eine „sonstige Rechnung“ (BMF-Schreiben vom 15.10.2024, Rn. 25 und 30). Geprüft wurden die Regeln des Profils MINIMUM.' },
      { test: (id) => id === 'urn:factur-x.eu:1p0:basicwl' || id === 'urn:zugferd.de:2p0:basicwl', label: 'ZUGFeRD / Factur-X BASIC WL', family: 'ZUGFeRD', en16931: false, note: 'Das Profil BASIC WL (ohne Rechnungspositionen) erfüllt die EN 16931 nicht und ist in Deutschland keine E-Rechnung im Sinne des § 14 Abs. 1 UStG, sondern eine „sonstige Rechnung“ (BMF-Schreiben vom 15.10.2024, Rn. 25 und 30). Geprüft wurden die Regeln des Profils BASIC WL.' },
      { test: (id) => /^urn:cen\.eu:en16931:2017#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/.test(id), label: 'Peppol BIS Billing 3.0', family: 'Peppol', en16931: true },
      { test: (id) => /^urn:cen\.eu:en16931:2017:compliant:factur-x\.eu:1p0:/.test(id), label: (id) => 'Factur-X ' + id.split(':').pop().toUpperCase() + ' (fehlerhafte Kennung)', family: 'ZUGFeRD', en16931: true, note: 'Fehlerhafte Profilkennung („:compliant:“ statt „#compliant#urn:“). Die Factur-X-Regeln selbst lehnen diese Kennung ab (Regel FX-SCH-A-000026).' },
      { test: (id) => /^urn:cen\.eu:en16931:2017/.test(id), label: (id) => 'EN-16931-basierte Spezifikation: ' + id, family: 'EN16931', en16931: true, note: 'Unbekannte CIUS/Extension auf Basis der EN 16931 – geprüft wurden die EN-16931-Regeln.' },
      { test: () => true, label: (id) => (id ? 'Unbekannte Spezifikation: ' + id : 'Keine Spezifikationskennung (BT-24)'), family: 'unknown', en16931: false, note: 'Die Spezifikationskennung (BT-24) fehlt oder ist unbekannt.' },
    ];
  }

  function profileFor(props, id) {
    const p = profileTable(props).find((x) => x.test(id || ''));
    return { id: id || '', label: typeof p.label === 'function' ? p.label(id) : p.label, family: p.family, en16931: p.en16931, note: p.note || null };
  }

  /** the first entry of build/rulesets.json for this syntax whose identifier matches */
  function rulesetEntry(rulesets, syntax, specId) {
    const list = rulesets[syntax === 'CII' ? 'CII' : 'UBL'] || [];
    for (const e of list) {
      if (e.match === 'exact' ? specId === e.id : e.match === 'prefix' ? specId.startsWith(e.id) : false) return e;
    }
    return null;
  }

  function selectScenario(env, doc) {
    for (const sc of env.scenarios.scenarios) {
      try {
        if (env.fontoxpath.evaluateXPathToBoolean(sc.match, doc, null, null, { namespaceResolver: (p) => sc.namespaces[p] || null })) return sc;
      } catch (e) { /* a scenario whose match expression fails does not match */ }
    }
    return null;
  }

  // KoSIT scenario <validateWithXmlSchema> resource -> XSD model id
  const XSD_BY_RESOURCE = [[/UBL-Invoice-2\.1\.xsd$/, 'UBL-Invoice-2.1'], [/UBL-CreditNote-2\.1\.xsd$/, 'UBL-CreditNote-2.1'], [/CrossIndustryInvoice_100pD16B\.xsd$/, 'CII-D16B']];

  function runXsd(env, modelId, doc, resource, source) {
    const model = env.xsdModel(modelId);
    if (!model) return { schema: modelId, resource, source, valid: null, unavailable: true, errorCount: 0, errors: [] };
    const cache = env.xsdCache || (env.xsdCache = {});
    const v = cache[modelId] || (cache[modelId] = env.XsdValidator.create(model));
    const t0 = Date.now();
    const res = v.validate(doc);
    return { schema: modelId, resource, source, valid: res.valid, errorCount: res.errors.length, truncated: !!res.truncated, errors: res.errors, ms: Date.now() - t0 };
  }

  function runRuleSets(env, doc, ids, docIndex, customLevels) {
    const cache = env.validatorCache || (env.validatorCache = {});
    const findings = [], processingErrors = [], engineWarnings = [], missing = [], timing = {};
    const run = [];
    for (const id of ids) {
      const compiled = env.ruleSet(id);
      if (!compiled) { missing.push({ id, reason: env.missingReason ? env.missingReason(id) : 'nicht verfügbar' }); continue; }
      const validator = cache[id] || (cache[id] = env.SchematronRunner.create(env.fontoxpath, compiled));
      const t1 = Date.now();
      const rep = validator.validate(doc, { docIndex });
      timing[id] = Date.now() - t1;
      run.push(id);
      for (const f of rep.findings) {
        const custom = customLevels && customLevels[f.id];
        const copy = Object.assign({}, f, { source: 'schematron', schema: id, originalLevel: f.level, level: custom || f.level, customLevel: custom || null });
        if (f.node) Object.defineProperty(copy, 'node', { value: f.node, enumerable: false });
        findings.push(copy);
      }
      for (const e of rep.processingErrors) processingErrors.push(Object.assign({ schema: id }, e));
      for (const w of rep.warnings || []) engineWarnings.push(Object.assign({ schema: id }, w));
    }
    return { findings, processingErrors, engineWarnings, missing, timing, run };
  }

  /**
   * Analysis of a parsed invoice document.
   * @param env    {fontoxpath, SchematronRunner, XsdValidator, ruleSet(id), xsdModel(id), scenarios, rulesets, missingReason?(id)}
   * @param doc    parsed XML document (browser DOM or slimdom)
   * @param syntax 'UBL-Invoice' | 'UBL-CreditNote' | 'CII'
   * @param ctx    {inPdf: boolean}
   */
  function analyzeDocument(env, doc, syntax, ctx) {
    ctx = ctx || {};
    const fx = env.fontoxpath;
    const noNs = { namespaceResolver: () => null };
    const specId = fx.evaluateXPathToString(
      syntax === 'CII' ? '/*/*:ExchangedDocumentContext/*:GuidelineSpecifiedDocumentContextParameter/*:ID' : '/*/*:CustomizationID', doc, null, null, noNs
    ).trim();
    const profile = profileFor(env.scenarios.properties, specId);
    const entry = rulesetEntry(env.rulesets, syntax, specId);
    const scenario = selectScenario(env, doc);
    const docIndex = env.SchematronRunner.documentOrderIndex(doc);
    const out = { specId, profile, rulesetEntry: entry, kositScenario: scenario ? scenario.name : null, docIndex, timing: {} };
    const empty = { findings: [], processingErrors: [], engineWarnings: [], missingRuleSets: [], ruleSetsRun: [] };

    // routing (see header)
    const facturxInPdf = !!(ctx.inPdf && entry && entry.source === 'facturx');
    if (scenario && !facturxInPdf) {
      // ---- KoSIT validator processing -------------------------------------------------------
      out.route = 'kosit';
      out.scenario = { name: scenario.name, customLevels: scenario.customLevels, schematron: scenario.schematron.map((s) => s.schemaId).filter(Boolean) };
      const loc = scenario.xsd && scenario.xsd[0] ? scenario.xsd[0].location : null;
      const hit = loc ? XSD_BY_RESOURCE.find(([re]) => re.test(loc)) : null;
      out.xsd = hit ? runXsd(env, hit[1], doc, loc, 'KoSIT-Szenario') : null;
      out.ruleSets = out.scenario.schematron;
      if (out.xsd && out.xsd.valid === false) {
        // SchematronValidationAction.isSkipped: no Schematron for schema-invalid documents
        out.schematronSkipped = 'xsd-invalid';
        Object.assign(out, empty);
      } else {
        const r = runRuleSets(env, doc, out.ruleSets, docIndex, scenario.customLevels);
        Object.assign(out, { findings: r.findings, processingErrors: r.processingErrors, engineWarnings: r.engineWarnings, missingRuleSets: r.missing, ruleSetsRun: r.run });
        out.timing.rules = r.timing;
      }
    } else if (entry && entry.ruleSets && entry.ruleSets.length) {
      // ---- profile rule sets (build/rulesets.json) ---------------------------------------------
      out.route = entry.source || 'profile';
      out.scenario = null;
      let xsdId = entry.xsd;
      if (xsdId === 'by-root') xsdId = syntax === 'UBL-CreditNote' ? 'UBL-CreditNote-2.1' : 'UBL-Invoice-2.1';
      if (entry.xsdStandalone && !ctx.inPdf) xsdId = entry.xsdStandalone;
      out.xsd = xsdId ? runXsd(env, xsdId, doc, null, 'Profil ' + (entry.family || '')) : null;
      out.ruleSets = entry.ruleSets.slice();
      if (out.xsd && out.xsd.valid === false) {
        out.schematronSkipped = 'xsd-invalid';
        Object.assign(out, empty);
      } else {
        const r = runRuleSets(env, doc, out.ruleSets, docIndex, null);
        Object.assign(out, { findings: r.findings, processingErrors: r.processingErrors, engineWarnings: r.engineWarnings, missingRuleSets: r.missing, ruleSetsRun: r.run });
        out.timing.rules = r.timing;
      }
    } else {
      out.route = 'none';
      out.scenario = null;
      out.xsd = null;
      out.ruleSets = [];
      Object.assign(out, empty);
    }
    return out;
  }

  /** the VAT relevance classifier of an environment (env.VatRelevance + env.vatData {legal, paths}), created once */
  function vatRelevance(env) {
    if (!env.VatRelevance || !env.vatData) return null;
    return env.vatCache || (env.vatCache = env.VatRelevance.create(env.vatData));
  }

  // ---------------------------------------------------------------------------------------------
  // line numbers of the findings: the line of the start tag ('<') of the element a finding refers to
  // (attributes: their element; text nodes: the enclosing element)
  // ---------------------------------------------------------------------------------------------
  /**
   * The line of every element start tag of an XML text, in text order (= document order of the elements).
   * Line breaks as in XML 1.0 §2.11: CR LF, CR and LF each end a line. Comments, CDATA sections, processing
   * instructions and the document type declaration (with its internal subset and quoted literals) are skipped.
   */
  function elementLineIndex(text) {
    const lines = [];
    const n = text.length;
    let line = 1;
    let i = 0;
    // advances over [from, to) counting line breaks; returns to
    const over = (from, to) => {
      for (let k = from; k < to; k++) {
        const c = text.charCodeAt(k);
        if (c === 10) line++;
        else if (c === 13) { line++; if (k + 1 < to && text.charCodeAt(k + 1) === 10) k++; }
      }
      return to;
    };
    const until = (from, end) => { const e = text.indexOf(end, from); return over(from, e < 0 ? n : e + end.length); };
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) { line++; i++; continue; }
      if (c === 13) { line++; i += text.charCodeAt(i + 1) === 10 ? 2 : 1; continue; }
      if (c !== 60) { i++; continue; } // '<'
      if (text.startsWith('<!--', i)) { i = until(i + 4, '-->'); continue; }
      if (text.startsWith('<![CDATA[', i)) { i = until(i + 9, ']]>'); continue; }
      if (text.startsWith('<?', i)) { i = until(i + 2, '?>'); continue; }
      if (text.startsWith('<!', i)) { // <!DOCTYPE …>, optionally with an internal subset […]
        let depth = 0, quote = 0, k = i + 2;
        while (k < n) {
          const ch = text.charCodeAt(k);
          if (ch === 10 || ch === 13) { k = over(k, k + (ch === 13 && text.charCodeAt(k + 1) === 10 ? 2 : 1)); continue; }
          if (quote) { if (ch === quote) quote = 0; k++; continue; }
          if (ch === 34 || ch === 39) { quote = ch; k++; continue; }
          if (depth > 0 && text.startsWith('<!--', k)) { k = until(k + 4, '-->'); continue; }
          if (depth > 0 && text.startsWith('<?', k)) { k = until(k + 2, '?>'); continue; }
          if (ch === 91) depth++;
          else if (ch === 93) depth--;
          else if (ch === 62 && depth <= 0) { k++; break; }
          k++;
        }
        i = k;
        continue;
      }
      if (text.charCodeAt(i + 1) !== 47) lines.push(line); // a start tag (not '</')
      i++;
    }
    return lines;
  }

  /** the elements of a document in document order (pre-order), iteratively */
  function elementsInDocumentOrder(doc) {
    const out = [];
    const stack = [];
    for (let c = doc.lastChild; c; c = c.previousSibling) if (c.nodeType === 1) stack.push(c);
    while (stack.length) {
      const e = stack.pop();
      out.push(e);
      for (let c = e.lastChild; c; c = c.previousSibling) if (c.nodeType === 1) stack.push(c);
    }
    return out;
  }

  /**
   * finding.line for every finding (null where there is no element). When the number of start tags of the text and
   * the number of elements of the parsed document differ (an entity whose replacement text contains markup), no
   * lines are assigned at all rather than wrong ones (result.lineIndex.ok = false).
   */
  function assignLines(env, result) {
    for (const f of result.allFindings) f.line = null;
    if (!result.xml || !result.doc || typeof result.xml.text !== 'string') return;
    const lines = elementLineIndex(result.xml.text);
    const elements = elementsInDocumentOrder(result.doc);
    result.lineIndex = { ok: lines.length === elements.length, startTags: lines.length, elements: elements.length };
    if (!result.lineIndex.ok) return;
    const index = new Map();
    elements.forEach((e, k) => index.set(e, k));
    let byPath = null; // XSD findings carry the path of their node only
    for (const f of result.allFindings) {
      let node = f.node || null;
      if (!node && f.source === 'xsd' && f.location && result.docIndex) {
        if (!byPath) { byPath = new Map(); for (const k of result.docIndex.keys()) if (k.nodeType === 1 || k.nodeType === 2) byPath.set(env.SchematronRunner.nodePath(k), k); }
        node = byPath.get(f.location) || null;
      }
      const el = !node ? null : node.nodeType === 1 ? node : node.nodeType === 2 ? node.ownerElement : node.parentNode;
      const k = el ? index.get(el) : undefined;
      f.line = k !== undefined ? lines[k] : null;
    }
  }

  /**
   * Position of a document type declaration in the prolog of `text` (after the optional XML declaration, comments,
   * processing instructions and white space), or -1. A DOCTYPE can only stand there; a "<!DOCTYPE" anywhere else is
   * character data, a comment or a well-formedness error, which the parser reports.
   */
  function doctypeAt(text) {
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    for (;;) {
      while (i < text.length) { const c = text.charCodeAt(i); if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a) i++; else break; }
      if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e < 0) return -1; i = e + 2; continue; }
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) return -1; i = e + 3; continue; }
      return text.startsWith('<!DOCTYPE', i) ? i : -1;
    }
  }

  // the deepest element nesting Chromium's XML parser accepts (5000 elements; 5001 is "Excessive node nesting")
  const MAX_DEPTH = 5000;
  /** maximum element nesting depth of a document (root element = 1), iteratively; stops once `cap` is exceeded */
  function maxElementDepth(doc, cap) {
    let max = 0, depth = 0;
    let n = doc.documentElement;
    while (n) {
      depth++;
      if (depth > max) { max = depth; if (max > cap) return max; }
      let c = n.firstChild;
      while (c && c.nodeType !== 1) c = c.nextSibling;
      if (c) { n = c; continue; }
      // no element child: next element sibling, else up
      for (;;) {
        let s = n.nextSibling;
        while (s && s.nodeType !== 1) s = s.nextSibling;
        if (s) { depth--; n = s; break; }
        n = n.parentNode;
        depth--;
        if (!n || n.nodeType !== 1) { n = null; break; }
      }
    }
    return max;
  }

  function sortFindings(list) {
    return list.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (SOURCE_ORDER[a.source] || 0) - (SOURCE_ORDER[b.source] || 0) || String(a.id).localeCompare(String(b.id)) || String(a.location || '').localeCompare(String(b.location || '')));
  }

  /**
   * The whole pipeline for one file.
   * env additionally: PdfEmbedded, PdfA3Checks, XmlEncoding, InvoiceModel, parseXml(text) -> {doc, error},
   *                   sha256(bytes) -> Promise<hex> (optional), now() -> ms (optional)
   * Non-enumerable (not serialised): result.doc, result.docIndex, result.xml.text, finding.node.
   */
  async function analyzeBytes(env, bytes, name, progress) {
    const now = env.now || (() => Date.now());
    const t0 = now();
    progress = progress || (() => {});
    const result = { name, size: bytes.length, sha256: env.sha256 ? await env.sha256(bytes) : null, kind: 'unknown', pdf: null, xml: null, warnings: [], issues: [], timing: {} };
    const issue = (source, level, id, text, extra) => result.issues.push(Object.assign({ source, level, id, text, location: '', schema: source === 'pdf' ? 'PDF/A-3 / ZUGFeRD-Container' : source === 'encoding' ? 'Zeichenkodierung' : 'XML-Schema' }, extra || {}));
    let xmlBytes = null;
    const head = String.fromCharCode.apply(null, Array.from(bytes.subarray(0, 5)));
    if (head.startsWith('%PDF')) {
      result.kind = 'pdf';
      progress('PDF wird gelesen …');
      try {
        const ex = await env.PdfEmbedded.extractEmbeddedFiles(bytes);
        result.pdf = { attachments: ex.files.map((f) => ({ name: f.name, size: f.size, mimeType: f.mimeType, afRelationship: f.afRelationship, description: f.description, filter: f.filter })), xmp: ex.xmp ? { zugferd: ex.xmp.zugferd, pdfa: ex.xmp.pdfa } : null, warnings: ex.warnings, method: ex.method };
        // the embedded files themselves (for download in the app; not serialised)
        Object.defineProperty(result.pdf, 'files', { value: ex.files.map((f) => ({ name: f.name, mimeType: f.mimeType, bytes: f.bytes })), enumerable: false });
        const inv = env.PdfEmbedded.pickInvoiceXml(ex.files);
        if (inv) { xmlBytes = inv.bytes; result.pdf.invoiceAttachment = inv.name; result.xmlSha256 = env.sha256 ? await env.sha256(inv.bytes) : null; }
        else result.warnings.push('Die PDF-Datei enthält keine eingebettete Rechnungs-XML (ZUGFeRD/Factur-X: factur-x.xml, zugferd-invoice.xml, xrechnung.xml).');
        if (env.PdfA3Checks) {
          progress('PDF-Container wird geprüft …');
          const tc = now();
          const cc = await env.PdfA3Checks.checkContainer(bytes, { extracted: ex });
          result.timing.container = Math.round(now() - tc);
          result.pdf.container = { checks: cc.checks, facts: cc.facts };
          for (const r of cc.results) issue('pdf', r.level === 'info' ? 'information' : r.level, r.id, r.message, { reference: r.reference });
        }
      } catch (e) {
        result.warnings.push('PDF konnte nicht gelesen werden: ' + e.message);
      }
    } else if (head.startsWith('PK')) {
      result.kind = 'zip';
      result.warnings.push('ZIP-Archive werden nicht entpackt. Bitte die enthaltene XML- oder PDF-Datei einzeln prüfen.');
    } else {
      result.kind = 'xml';
      xmlBytes = bytes;
    }
    // files offered for download (embedded in the PDF, attachments BG-24): classified once (src/file-safety.js), the
    // decoded attachment bytes are kept with the model (not serialised) for the download in the app
    const classifyFiles = async () => {
      const FS = env.FileSafety;
      if (!FS) return;
      const active = async (bytes) => {
        if (!env.PdfA3Checks || !env.PdfA3Checks.activeContent || bytes.length > 64 * 1024 * 1024) return null;
        try { return env.PdfA3Checks.activeContent(await env.PdfEmbedded.loadDocument(bytes, [])); } catch (e) { return null; }
      };
      const judge = async (bytes, name, mime) => {
        const c = FS.classify(bytes, name, mime);
        if (c.detected === 'pdf') FS.addPdfFindings(c, await active(bytes));
        return { risk: c.risk, type: c.type, detected: c.detected, reasons: c.reasons, downloadName: c.downloadName };
      };
      if (result.pdf && result.pdf.files) {
        for (let i = 0; i < result.pdf.files.length; i++) result.pdf.attachments[i].safety = await judge(result.pdf.files[i].bytes, result.pdf.files[i].name, result.pdf.files[i].mimeType);
      }
      if (result.model && result.model.attachments && result.model.attachments.length) {
        result.attachmentSafety = [];
        for (const [i, a] of result.model.attachments.entries()) {
          if (!a.base64) { result.attachmentSafety.push(null); continue; }
          const bytes = FS.decodeBase64(a.base64);
          Object.defineProperty(a, 'bytes', { value: bytes, enumerable: false, configurable: true });
          result.attachmentSafety.push(await judge(bytes, a.file || ('Anlage_' + (i + 1)), a.mime));
        }
      }
    };
    const finish = async (assessment) => {
      await classifyFiles();
      result.assessment = assessment;
      result.findings = result.findings || [];
      result.processingErrors = result.processingErrors || [];
      result.engineWarnings = result.engineWarnings || [];
      result.missingRuleSets = result.missingRuleSets || [];
      result.allFindings = sortFindings(result.issues.concat(result.findings));
      const counts = { error: 0, warning: 0, information: 0 };
      for (const f of result.allFindings) counts[f.level]++;
      result.counts = counts;
      const tLines = now();
      assignLines(env, result);
      result.timing.lines = Math.round(now() - tLines);
      // umsatzsteuerliche Einordnung (Deutschland, src/vat-relevance.js): every finding, then the invoice
      const vat = vatRelevance(env);
      if (vat) {
        for (const f of result.allFindings) f.ust = vat.classify(f, result.syntax, result.model);
        result.ust = vat.verdict(result);
      }
      result.timing.total = Math.round(now() - t0);
      return result;
    };
    if (!xmlBytes) return finish('not-processable');

    // character encoding (XML 1.0 §4.3.3, Appendix F)
    progress('XML wird gelesen …');
    const tParse = now();
    const dec = env.XmlEncoding.decode(xmlBytes);
    result.xml = { encoding: dec.encoding, declared: dec.declared, bom: dec.bom, size: xmlBytes.length, parseError: null };
    for (const e of dec.errors) issue('encoding', 'error', e.code, e.message);
    if (!dec.ok || dec.text === null) { result.timing.parse = Math.round(now() - tParse); return finish('not-processable'); }
    const text = dec.text.charCodeAt(0) === 0xfeff ? dec.text.slice(1) : dec.text;
    Object.defineProperty(result.xml, 'text', { value: text, enumerable: false, writable: true });
    // a document type declaration is refused before parsing, as by the KoSIT validator (its XML parser runs with
    // http://apache.org/xml/features/disallow-doctype-decl: "DOCTYPE is disallowed"): e-invoices use no DTD, and
    // entity expansion or external entities never reach a parser – in no browser and not in Node
    const dt = doctypeAt(text);
    if (dt >= 0) {
      const before = text.slice(0, dt);
      const line = before.split('\n').length, column = dt - before.lastIndexOf('\n');
      const msg = 'Dokumenttyp-Deklaration (DOCTYPE) in Zeile ' + line + ', Spalte ' + column + ' – nicht zulässig wie beim KoSIT-Validator (XML-Parser mit disallow-doctype-decl); E-Rechnungen verwenden keine DTD';
      result.timing.parse = Math.round(now() - tParse);
      result.xml.parseError = msg;
      result.warnings.push('XML ist nicht verarbeitbar: ' + msg + '.');
      return finish('not-processable');
    }
    const parsed = env.parseXml(text);
    result.timing.parse = Math.round(now() - tParse);
    if (!parsed.doc) { result.xml.parseError = parsed.error; result.warnings.push('XML ist nicht wohlgeformt: ' + parsed.error); return finish('not-processable'); }
    const doc = parsed.doc;
    // nesting depth: a document with elements nested deeper than MAX_DEPTH levels is refused like one that is not
    // well-formed – Chromium's XML parser refuses it as well ("Excessive node nesting", same limit), no UBL or CII
    // invoice comes anywhere near it, and the recursive steps of the validation would otherwise exhaust the stack
    if (maxElementDepth(doc, MAX_DEPTH) > MAX_DEPTH) {
      const msg = 'Elemente tiefer als ' + MAX_DEPTH + ' Ebenen verschachtelt – nicht verarbeitet (Schutz vor Überlastung; keine UBL- oder CII-Rechnung ist so tief verschachtelt)';
      result.xml.parseError = msg;
      result.warnings.push('XML ist nicht verarbeitbar: ' + msg + '.');
      return finish('not-processable');
    }
    Object.defineProperty(result, 'doc', { value: doc, enumerable: false });

    const syntax = env.InvoiceModel.detectSyntax(doc);
    result.syntax = syntax;
    if (!syntax) {
      result.warnings.push('Kein unterstütztes Rechnungsformat: Wurzelelement <' + doc.documentElement.nodeName + '> (Namensraum ' + (doc.documentElement.namespaceURI || '–') + '). Unterstützt: UBL 2.1 Invoice/CreditNote, UN/CEFACT CII D16B (XRechnung, ZUGFeRD/Factur-X, Peppol).');
      return finish('not-applicable');
    }
    if (syntax === 'CII-ZUGFeRD1') {
      result.profile = { id: '', label: 'ZUGFeRD 1.0 (CrossIndustryDocument)', family: 'ZUGFeRD1', en16931: false, note: null };
      result.warnings.push('ZUGFeRD 1.0 (rsm:CrossIndustryDocument) ist nicht EN-16931-konform und in Deutschland keine E-Rechnung im Sinne des § 14 Abs. 1 UStG. Geschäftsregeln können nicht geprüft werden.');
      return finish('not-applicable');
    }

    progress('XML-Schema und Geschäftsregeln werden geprüft …');
    const tA = now();
    const core = analyzeDocument(env, doc, syntax, { inPdf: result.kind === 'pdf' });
    result.timing.analyze = Math.round(now() - tA);
    if (core.timing.rules) result.timing.rules = core.timing.rules;
    if (core.xsd && core.xsd.ms !== undefined) result.timing.xsd = core.xsd.ms;
    Object.defineProperty(result, 'docIndex', { value: core.docIndex, enumerable: false });
    result.specId = core.specId;
    result.profile = core.profile;
    result.route = core.route;
    result.scenario = core.scenario;
    result.kositScenario = core.kositScenario;
    result.ruleSets = core.ruleSets;
    result.ruleSetsRun = core.ruleSetsRun;
    result.missingRuleSets = core.missingRuleSets;
    result.rulesetFamily = core.rulesetEntry ? core.rulesetEntry.family : null;
    result.xsd = core.xsd ? Object.assign({}, core.xsd, { errors: core.xsd.errors.slice(0, 500) }) : null;
    if (core.xsd && core.xsd.unavailable) result.warnings.push('Das XML-Schema-Modell ' + core.xsd.schema + ' ist nicht verfügbar; die Schema-Prüfung entfiel.');
    if (core.xsd && core.xsd.valid === false) for (const e of core.xsd.errors) issue('xsd', 'error', e.code, e.message, { location: e.location, schema: 'XML-Schema ' + core.xsd.schema });
    if (core.schematronSkipped) result.schematronSkipped = core.schematronSkipped;
    result.findings = core.findings;
    result.processingErrors = core.processingErrors;
    result.engineWarnings = core.engineWarnings;
    // Spezifikation XRechnung 3.0.2, Abschnitt 6.1: "gemäß den vorgegebenen Syntaxen ist UTF-8 zur Kodierung zu verwenden"
    if (core.profile.family === 'XRechnung' && result.xml.encoding !== 'UTF-8') issue('encoding', 'error', 'XR-ENCODING', 'Die Rechnung ist ' + result.xml.encoding + '-kodiert; XRechnung verlangt UTF-8 (Spezifikation XRechnung 3.0.2, Abschnitt 6.1).');

    // assessment (KoSIT default-report.xsl: processing errors -> not processable; errors -> reject)
    let assessment;
    const anyError = result.issues.some((i) => i.level === 'error') || result.findings.some((f) => f.level === 'error');
    if (result.processingErrors.length) assessment = 'not-processable';
    else if (core.route === 'none') assessment = 'not-applicable';
    else if (anyError) assessment = 'reject';
    else if (result.missingRuleSets.length) assessment = 'incomplete';
    else assessment = 'accept';
    result.legalStatus = core.profile.en16931 ? 'e-invoice' : 'not-e-invoice';

    progress('Rechnungsdaten werden gelesen …');
    const tModel = now();
    try { result.model = env.InvoiceModel.create(env.fontoxpath, doc); } catch (e) { result.warnings.push('Rechnungsdaten konnten nicht gelesen werden: ' + e.message); }
    result.timing.model = Math.round(now() - tModel);
    return finish(assessment);
  }

  return { analyzeBytes, analyzeDocument, profileFor, rulesetEntry, elementLineIndex, elementsInDocumentOrder, maxElementDepth, MAX_DEPTH, doctypeAt, LEVEL_ORDER };
});
