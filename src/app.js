/*
 * app.js — E-Rechnung Prüfer (standalone, offline). UI and orchestration.
 * Depends on globals: fontoxpath, SchematronRunner, PdfEmbedded, InvoiceModel, VatRelevance, PdfWriter, Reports,
 * PrueferCore, PRUEFER_SCHEMAS, PRUEFER_SCENARIOS, PRUEFER_VAT, PRUEFER_BUILD.
 * Licence: EUPL-1.2
 */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (tag, attrs, ...children) => {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  const SCHEMAS = window.PRUEFER_SCHEMAS;          // embedded rule sets (compiled Schematron)
  const XSD_MODELS = window.PRUEFER_XSD;           // embedded XML Schema models
  const SCENARIOS = window.PRUEFER_SCENARIOS;      // KoSIT scenarios
  const RULESETS = window.PRUEFER_RULESETS;        // profile -> rule sets (build/rulesets.json)
  const VAT = window.PRUEFER_VAT;                  // umsatzsteuerliche Einordnung: legal table + syntax binding
  const BUILD = window.PRUEFER_BUILD || {};
  const NOTICES = window.PRUEFER_NOTICES || [];

  const LEVEL_LABEL = { error: 'Fehler', warning: 'Warnung', information: 'Hinweis' };
  const SOURCE_LABEL = { encoding: 'Kodierung', pdf: 'PDF-Container', xsd: 'XML-Schema', schematron: 'Geschäftsregel' };

  // ---------- rule sets loaded by the user (not redistributed: Peppol BIS, see docs/RULESETS.md) ----------
  const STORE_PREFIX = 'e-rechnung-pruefer.ruleset.';
  const imported = {};
  function loadImported() {
    for (const id of Object.keys(BUILD.importable || {})) {
      try { const t = localStorage.getItem(STORE_PREFIX + id); if (t) imported[id] = JSON.parse(t); } catch (e) { /* storage unavailable (private mode, file://): in-memory only */ }
    }
  }
  function storeImported(id, compiled) {
    imported[id] = compiled;
    try { localStorage.setItem(STORE_PREFIX + id, JSON.stringify(compiled)); } catch (e) { /* kept for this session only */ }
  }

  const CORE_ENV = {
    fontoxpath, SchematronRunner, XsdValidator, PdfEmbedded, PdfA3Checks, XmlEncoding, InvoiceModel, VatRelevance,
    scenarios: SCENARIOS, rulesets: RULESETS, vatData: VAT,
    ruleSet: (id) => SCHEMAS[id] || imported[id] || null,
    xsdModel: (id) => XSD_MODELS[id] || null,
    missingReason: (id) => (BUILD.importable && BUILD.importable[id] ? 'nicht eingebettet (Lizenz) – offizielle Datei ' + BUILD.importable[id].file + ' unter „Regelwerke“ laden' : 'nicht verfügbar'),
    parseXml: (text) => parseXml(text),
    sha256: (bytes) => sha256Hex(bytes),
    now: () => performance.now(),
  };

  // ---------- helpers ----------
  async function sha256Hex(bytes) {
    try {
      if (window.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* insecure context: fall back */ }
    return Sha256.hex(bytes);
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const pe = doc.getElementsByTagName('parsererror')[0];
    if (pe) return { doc: null, error: pe.textContent.replace(/\s+/g, ' ').trim() };
    return { doc, error: null };
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  const fmtDate = (v) => Reports.date(v);
  const DATE_TERMS = InvoiceModel.DATE_TERMS;
  const money = (v, cur) => Reports.amount(v, cur);
  const codeLabel = (table, code) => (code ? (table[code] ? table[code] + ' (' + code + ')' : code) : '');

  // ---------- analysis (src/pruefer-core.js: the same pipeline as the command-line version) ----------
  // (line numbers of the findings are assigned in the core as well: PrueferCore.elementLineIndex)
  async function analyzeFile(file, progress) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return PrueferCore.analyzeBytes(CORE_ENV, bytes, file.name, progress);
  }

  // ---------- downloads ----------
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  const reportCtx = () => ({ build: BUILD, now: new Date(), vat: VAT.legal });
  function downloadProtocol(r) { const ctx = reportCtx(); download(Reports.fileName(r, 'protocol', ctx.now), Reports.protocolPdf(r, ctx), 'application/pdf'); }
  function downloadInvoicePdf(r) { const ctx = reportCtx(); const pdf = Reports.invoicePdf(r, ctx); if (pdf) download(Reports.fileName(r, 'invoice', ctx.now), pdf, 'application/pdf'); }

  // ---------- rendering ----------
  const ASSESSMENT = {
    accept: { cls: 'ok', text: 'Keine Format- oder Geschäftsregelfehler (Prüfung wie KoSIT-Validator)', short: 'OK' },
    reject: { cls: 'bad', text: 'Technisch fehlerhaft: Format- oder Geschäftsregelfehler – der KoSIT-Validator empfiehlt die Zurückweisung (öffentliche Auftraggeber können sie zurückweisen). Die umsatzsteuerliche Bedeutung steht darunter.', short: 'Fehler' },
    'not-processable': { cls: 'warn', text: 'Das Dokument konnte nicht vollständig verarbeitet werden und sollte nicht automatisiert angenommen werden', short: 'Nicht prüfbar' },
    'not-applicable': { cls: 'neutral', text: 'Keine Geschäftsregeln anwendbar (kein unterstütztes E-Rechnungsformat)', short: 'Nicht anwendbar' },
    incomplete: { cls: 'warn', text: 'Keine Fehler in den geprüften Regelwerken – die Prüfung ist jedoch unvollständig, weil ein Regelwerk fehlt (siehe unten)', short: 'Unvollständig' },
  };
  const VERDICT_CLASS = { ok: 'ok', technisch: 'info', pflicht: 'bad', luecke: 'bad', 'nicht-pruefbar': 'warn', format: 'bad', 'kein-profil': 'bad', 'keine-xml': 'bad', unvollstaendig: 'warn' };
  const KLASSE_CLASS = { format: 'bad', pflicht: 'bad', unbestimmt: 'warn', container: 'neutral', 'ohne-bezug': 'ok', zusatz: 'ok' };
  const STATUS_CLASS = { vorhanden: 'ok', fehlt: 'bad', 'prüfen': 'warn', 'entfällt': 'neutral', 'nicht zutreffend': 'neutral' };

  function renderVat(r) {
    const u = r.ust;
    const cls = VERDICT_CLASS[u.id] || 'neutral';
    return h('div', { class: 'ust ust-' + cls },
      h('div', { class: 'ust-head' }, h('span', { class: 'badge ' + cls, text: u.kurz }), h('strong', { text: ' Umsatzsteuerliche Einordnung (Deutschland)' })),
      h('p', { class: 'ust-text' }, u.text),
      u.angaben.length ? h('p', { class: 'small' }, h('strong', { text: 'Betroffene Pflichtangaben: ' }), u.angaben.map((a) => a.norm).join('; ')) : null,
      h('details', { class: 'small' }, h('summary', { text: 'Grundlage und Grenzen der Einordnung' }), h('ul', null, u.hinweise.map((t) => h('li', { text: t })))));
  }

  function renderResult(r) {
    const a = ASSESSMENT[r.assessment] || ASSESSMENT['not-processable'];
    const card = h('section', { class: 'card result ' + a.cls, 'data-name': r.name });
    card.append(h('div', { class: 'result-head' },
      h('div', { class: 'badge ' + a.cls, text: a.short }),
      h('div', { class: 'result-title' },
        h('h2', { text: r.name }),
        h('div', { class: 'muted small' }, fmtBytes(r.size) + (r.sha256 ? ' · SHA-256 ' + r.sha256.slice(0, 16) + '…' : '') + (r.timing && r.timing.total ? ' · ' + r.timing.total + ' ms' : '')))));
    card.append(h('p', { class: 'assessment' }, a.text));
    if (r.ust) card.append(renderVat(r));
    if (r.profile) {
      const bits = [r.syntax === 'CII' ? 'UN/CEFACT CII D16B' : r.syntax === 'UBL-CreditNote' ? 'UBL 2.1 CreditNote' : r.syntax === 'UBL-Invoice' ? 'UBL 2.1 Invoice' : (r.syntax || ''), r.profile.label].filter(Boolean);
      if (r.kind === 'pdf') bits.unshift('PDF mit eingebetteter XML (' + ((r.pdf && r.pdf.invoiceAttachment) || '?') + ')');
      card.append(h('p', { class: 'small' }, h('strong', { text: 'Format: ' }), bits.join(' · ')));
      if (r.route === 'kosit' && r.scenario) card.append(h('p', { class: 'small' }, h('strong', { text: 'Prüfung wie KoSIT-Validator, Szenario: ' }), r.scenario.name, ' – XML-Schema ', r.xsd ? r.xsd.schema : '–', ', Regelwerke: ', r.ruleSets.join(' + ')));
      else if (r.ruleSets && r.ruleSets.length) card.append(h('p', { class: 'small' }, h('strong', { text: 'Prüfung nach Profil' + (r.rulesetFamily ? ' „' + r.rulesetFamily + '“' : '') + ': ' }), 'XML-Schema ', r.xsd ? r.xsd.schema : '–', ', Regelwerke: ', r.ruleSets.join(' + '), r.kositScenario ? '' : ' (kein KoSIT-Szenario – der XRechnung-Validator der KoSIT würde dieses Dokument nicht annehmen)'));
      if (r.profile.note) card.append(h('p', { class: 'note' }, r.profile.note));
      if (r.legalStatus === 'not-e-invoice') card.append(h('p', { class: 'note warn-note' }, 'Rechtlicher Status: keine E-Rechnung im Sinne der EN 16931 / des § 14 Abs. 1 UStG.'));
      if (r.schematronSkipped === 'xsd-invalid') card.append(h('p', { class: 'note warn-note' }, 'Das Dokument verletzt das XML-Schema (' + r.xsd.schema + ', ' + r.xsd.errorCount + ' Fehler). Wie beim KoSIT-Validator werden die Geschäftsregeln dann nicht geprüft.'));
      for (const m of r.missingRuleSets || []) card.append(h('p', { class: 'note warn-note' }, 'Regelwerk ' + m.id + ' wurde nicht angewendet: ' + m.reason + '.'));
    }
    for (const w of r.warnings || []) card.append(h('p', { class: 'note warn-note' }, w));
    if (r.pdf && r.pdf.warnings && r.pdf.warnings.length) card.append(h('details', null, h('summary', { text: 'Hinweise des PDF-Lesers (' + r.pdf.warnings.length + ')' }), h('ul', null, r.pdf.warnings.map((w) => h('li', { class: 'small', text: w })))));

    if (r.allFindings) {
      const c = r.counts;
      card.append(h('div', { class: 'counts' },
        h('span', { class: 'pill error', text: c.error + ' Fehler' }),
        h('span', { class: 'pill warning', text: c.warning + ' Warnungen' }),
        h('span', { class: 'pill information', text: c.information + ' Hinweise' }),
        h('span', { class: 'pill neutral', text: (r.processingErrors && r.processingErrors.length ? r.processingErrors.length + ' Verarbeitungsfehler' : 'keine Verarbeitungsfehler') })));
    }

    // files of this invoice
    const actions = h('div', { class: 'actions' });
    actions.append(h('button', { class: 'btn small-btn', type: 'button', 'data-action': 'protocol', title: 'Was mit welchen Regeln wann geprüft wurde, mit Ergebnis, Einordnung und SHA-256 – zum Aufbewahren mit der Rechnung', onclick: () => downloadProtocol(r) }, 'Prüfprotokoll (PDF)'));
    if (r.model) actions.append(h('button', { class: 'btn secondary small-btn', type: 'button', 'data-action': 'invoice-pdf', title: 'Die Rechnungsdaten in lesbarer Form; rechtlich maßgeblich bleibt die XML', onclick: () => downloadInvoicePdf(r) }, 'Lesefassung (PDF)'));
    const invXml = r.pdf && r.pdf.files ? r.pdf.files.find((f) => f.name === r.pdf.invoiceAttachment) : null;
    if (invXml) actions.append(h('button', { class: 'btn secondary small-btn', type: 'button', 'data-action': 'xml', title: 'Die eingebettete Rechnungs-XML (strukturierter Teil) unverändert', onclick: () => download(invXml.name, invXml.bytes, 'application/xml') }, 'XML (' + invXml.name + ')'));
    const att = Reports.attachmentFiles(r);
    if (att.length) actions.append(h('span', { class: 'small muted' }, att.length + ' Anlage(n) unter „Rechnungsdaten“'));
    card.append(actions);

    // tabs
    const tabs = h('div', { class: 'tabs' });
    const panes = {};
    const addTab = (key, label, build) => {
      const btn = h('button', { class: 'tab', type: 'button', 'data-tab': key, text: label });
      const pane = h('div', { class: 'pane', 'data-pane': key });
      pane.hidden = true;
      let built = false;
      const show = () => { if (!built) { build(pane); built = true; } for (const b of tabs.children) b.classList.toggle('active', b === btn); for (const [k, p] of Object.entries(panes)) p.hidden = k !== key; };
      btn.addEventListener('click', show);
      tabs.append(btn);
      panes[key] = pane;
      return { btn, pane, show };
    };
    card.append(tabs);
    const t1 = addTab('report', 'Prüfbericht', (pane) => renderFindings(pane, r));
    if (r.ust && r.ust.pflichtangaben) addTab('pflicht', 'Pflichtangaben', (pane) => renderChecklist(pane, r));
    if (r.model) addTab('invoice', 'Rechnungsdaten', (pane) => renderModel(pane, r));
    addTab('details', 'Details', (pane) => renderDetails(pane, r));
    if (r.xml && r.xml.text) addTab('xml', 'XML', (pane) => renderXml(pane, r));
    for (const p of Object.values(panes)) card.append(p);
    t1.show();
    return card;
  }

  function ustCell(f) {
    const u = f.ust;
    if (!u) return '';
    const klasse = VAT.legal.klassen[u.klasse] || {};
    const label = Reports.ustLabel(f, VAT.legal);
    // warnings and notes are no errors: the area they concern is shown, one tone lighter
    const tone = KLASSE_CLASS[u.klasse] || 'neutral';
    const shown = f.level === 'error' ? tone : tone === 'bad' ? 'warn' : tone === 'warn' ? 'neutral' : tone;
    return h('div', { title: (f.level === 'error' ? '' : LEVEL_LABEL[f.level] + ', kein Fehler. ') + (klasse.text || '') },
      h('span', { class: 'pill ' + shown, text: label }),
      u.bt && u.bt.length ? h('div', { class: 'tiny muted', text: u.bt.slice(0, 6).join(', ') + (u.bt.length > 6 ? ' …' : '') + (u.basis === 'stelle' ? ' (aus der Stelle)' : u.basis === 'regel' ? ' (Regeltabelle)' : '') }) : null);
  }

  function renderFindings(pane, r) {
    if (!r.allFindings) { pane.append(h('p', { class: 'muted' }, 'Keine Prüfung durchgeführt.')); return; }
    if (r.processingErrors && r.processingErrors.length) {
      pane.append(h('div', { class: 'proc-errors' },
        h('h3', { text: 'Verarbeitungsfehler' }),
        h('p', { class: 'small' }, 'Beim Auswerten einzelner Regeln traten Fehler auf (meist, weil ein Wert nicht dem erwarteten Datentyp entspricht). Ein solches Dokument sollte nicht automatisiert angenommen werden (wie beim KoSIT-Validator).'),
        h('ul', null, r.processingErrors.map((e) => h('li', { class: 'small mono' }, (e.id ? e.id + ' ' : '') + (e.location ? '@ ' + e.location + ' ' : '') + '– ' + e.message)))));
    }
    if (!r.allFindings.length) {
      const what = [r.xsd && r.xsd.valid ? 'XML-Schema ' + r.xsd.schema : null].concat(r.ruleSetsRun || []).filter(Boolean);
      pane.append(h('p', { class: 'ok-text' }, '✔ Keine Befunde' + (what.length ? ' (' + what.join(', ') + ')' : '') + '.'));
      return;
    }
    const filter = h('div', { class: 'filter' });
    const table = h('table', { class: 'findings' });
    table.append(h('thead', null, h('tr', null, ['Stufe', 'Regel', 'Meldung', 'USt-Bedeutung', 'Stelle', 'Zeile'].map((t) => h('th', { text: t })))));
    const tbody = h('tbody');
    const rows = r.allFindings.map((f) => {
      const tr = h('tr', { class: 'lvl-' + f.level },
        h('td', null, h('span', { class: 'pill ' + f.level, text: LEVEL_LABEL[f.level] }), f.customLevel ? h('div', { class: 'tiny muted', text: 'KoSIT-Stufe (Regelwerk: ' + LEVEL_LABEL[f.originalLevel] + ')' }) : null),
        h('td', { class: 'mono' }, f.id, h('div', { class: 'tiny muted', text: (SOURCE_LABEL[f.source] || '') + ' · ' + (f.schema || '') })),
        h('td', null, f.text, f.source === 'schematron' ? h('details', { class: 'tiny' }, h('summary', { text: 'Regel anzeigen' }), h('div', { class: 'mono wrap' }, 'Kontext: ' + f.context), h('div', { class: 'mono wrap' }, 'Test: ' + f.test)) : f.reference ? h('div', { class: 'tiny muted', text: 'Grundlage: ' + f.reference }) : null),
        h('td', null, ustCell(f)),
        h('td', { class: 'mono wrap small' }, f.location || ''),
        h('td', { class: 'num' }, f.line ? String(f.line) : ''));
      tr.dataset.level = f.level;
      tr.dataset.ust = f.ust ? f.ust.klasse : '';
      return tr;
    });
    tbody.append(...rows);
    table.append(tbody);
    const shown = { error: true, warning: true, information: true };
    let onlyVat = false;
    const apply = () => { for (const tr of rows) tr.hidden = !shown[tr.dataset.level] || (onlyVat && ['ohne-bezug', 'zusatz'].includes(tr.dataset.ust)); };
    for (const lvl of ['error', 'warning', 'information']) {
      const cb = h('input', { type: 'checkbox', checked: 'checked' });
      cb.addEventListener('change', () => { shown[lvl] = cb.checked; apply(); });
      filter.append(h('label', null, cb, ' ' + LEVEL_LABEL[lvl] + ' (' + r.counts[lvl] + ')'));
    }
    if (r.allFindings.some((f) => f.ust)) {
      const cb = h('input', { type: 'checkbox', 'data-filter': 'ust' });
      cb.addEventListener('change', () => { onlyVat = cb.checked; apply(); });
      filter.append(h('label', null, cb, ' nur umsatzsteuerlich bedeutsame'));
    }
    pane.append(filter, h('div', { class: 'table-scroll' }, table));
  }

  function renderChecklist(pane, r) {
    const p = r.ust.pflichtangaben;
    pane.append(h('p', { class: 'small' }, 'Ob die Rechnungspflichtangaben im strukturierten Teil der E-Rechnung vorhanden sind (BMF-Schreiben vom 15.10.2025, Rn. 35: alle Pflichtangaben gehören in den strukturierten Teil; Zuordnung zu den Geschäftsbegriffen nach den Empfehlungen von KoSIT und FeRD). Geprüft wird das Vorhandensein, nicht die Richtigkeit; die Werte stehen so da, wie sie in der XML stehen.'));
    if (p.kleinbetrag) pane.append(h('p', { class: 'note' }, VAT.legal.hinweise.kleinbetrag));
    if (p.kleinunternehmer) pane.append(h('p', { class: 'note' }, VAT.legal.hinweise.kleinunternehmer));
    pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data checklist' },
      h('thead', null, h('tr', null, ['Pflichtangabe', 'Status', 'Werte im strukturierten Teil', 'Hinweis'].map((t) => h('th', { text: t })))),
      h('tbody', null, p.items.map((i) => h('tr', { 'data-angabe': i.id, 'data-status': i.status },
        h('td', null, h('strong', { text: i.norm }), h('div', { class: 'tiny muted', text: i.text })),
        h('td', null, h('span', { class: 'pill ' + (STATUS_CLASS[i.status] || 'neutral'), text: i.status })),
        h('td', { class: 'small' }, i.werte.map((w) => h('div', null, h('span', { class: 'bt', text: w[0] }), ' ', w[1]))),
        h('td', { class: 'small' }, i.hinweis)))))));
  }

  function renderModel(pane, r) {
    const m = r.model;
    const cur = (m.bt['BT-5'] || [])[0] || '';
    const dl = (items) => h('dl', { class: 'kv' }, items.map((t) => [h('dt', null, t.label, h('span', { class: 'bt', text: t.id })), h('dd', null, t.value)]));
    const show = (t) => {
      if (DATE_TERMS.has(t.id)) return { id: t.id, label: t.label, value: t.value.split(' | ').map(fmtDate).join(' | ') };
      if (t.id === 'BT-3') return { id: t.id, label: t.label, value: codeLabel(Reports.TYPE_CODES, t.value) };
      if (t.id === 'BT-81') return { id: t.id, label: t.label, value: codeLabel(Reports.PAYMENT_MEANS, t.value) };
      return t;
    };
    pane.append(h('div', { class: 'grid2' },
      h('div', null, h('h3', { text: 'Rechnung' }), dl(m.header.map(show))),
      h('div', null, h('h3', { text: 'Beträge' }), dl(m.totals.map((t) => ({ id: t.id, label: t.label, value: money(t.value, t.id === 'BT-111' ? (m.bt['BT-6'] || [])[0] : cur) }))))));
    pane.append(h('div', { class: 'grid2' },
      h('div', null, h('h3', { text: 'Verkäufer' }), dl(m.seller)),
      h('div', null, h('h3', { text: 'Käufer' }), dl(m.buyer))));
    const extra = [['Steuervertreter des Verkäufers (BG-11)', m.taxRep], ['Zahlungsempfänger (BG-10)', m.payeeParty], ['Lieferung (BG-13)', m.delivery]].filter(([, l]) => l.length);
    if (extra.length) pane.append(h('div', { class: 'grid2' }, extra.map(([t, l]) => h('div', null, h('h3', { text: t }), dl(l)))));
    if (m.payment.length) pane.append(h('h3', { text: 'Zahlung' }), dl(m.payment.map(show)));
    if (m.skonto.length) pane.append(h('h3', { text: 'Skonto / Verzug (BT-20, XRechnung-Format)' }), h('ul', null, m.skonto.map((s) => h('li', null, s.type + ': ' + s.days + ' Tage, ' + s.percent + ' %' + (s.base ? ', Basisbetrag ' + money(s.base, cur) : '')))));
    if (m.vat.length) {
      pane.append(h('h3', { text: 'Umsatzsteuer-Aufschlüsselung (BG-23)' }));
      pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Kategorie', 'Satz %', 'Bemessungsgrundlage', 'Steuerbetrag', 'Befreiungsgrund'].map((t) => h('th', { text: t })))), h('tbody', null, m.vat.map((v) => h('tr', null, h('td', null, codeLabel(Reports.VAT_CATEGORIES, v.cat)), h('td', { class: 'num' }, v.rate), h('td', { class: 'num' }, money(v.taxable, cur)), h('td', { class: 'num' }, money(v.tax, cur)), h('td', null, [v.reasonCode, v.reason].filter(Boolean).join(' – '))))))));
    }
    if (m.allowances.length) {
      pane.append(h('h3', { text: 'Nachlässe / Zuschläge auf Dokumentebene (BG-20/21)' }));
      pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Art', 'Betrag', 'Basis', '%', 'Grund', 'USt'].map((t) => h('th', { text: t })))), h('tbody', null, m.allowances.map((v) => h('tr', null, h('td', null, v.indicator === 'true' ? 'Zuschlag' : 'Nachlass'), h('td', { class: 'num' }, money(v.amount, cur)), h('td', { class: 'num' }, money(v.base, cur)), h('td', { class: 'num' }, v.pct), h('td', null, [v.reasonCode, v.reason].filter(Boolean).join(' – ')), h('td', null, [v.vatCat, v.vatRate ? v.vatRate + ' %' : ''].filter(Boolean).join(' '))))))));
    }
    pane.append(h('h3', { text: 'Positionen (' + m.lines.length + ')' }));
    pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data lines' }, h('thead', null, h('tr', null, ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Netto', 'USt'].map((t) => h('th', { text: t })))), h('tbody', null, m.lines.map((l) => h('tr', null,
      h('td', null, l.id),
      h('td', null, l.name, l.desc ? h('div', { class: 'tiny muted', text: l.desc }) : null, l.sellerId ? h('div', { class: 'tiny muted', text: 'Art.-Nr. ' + l.sellerId }) : null, l.period || l.periodEnd ? h('div', { class: 'tiny muted', text: 'Zeitraum ' + fmtDate(l.period) + ' – ' + fmtDate(l.periodEnd) }) : null, l.allowances.length ? h('div', { class: 'tiny muted', text: l.allowances.map((x) => (x.indicator === 'true' ? 'Zuschlag ' : 'Nachlass ') + money(x.amount, cur) + (x.reason ? ' (' + x.reason + ')' : '')).join('; ') }) : null, l.note ? h('div', { class: 'tiny muted', text: l.note }) : null),
      h('td', { class: 'num' }, l.qty), h('td', null, codeLabel(Reports.UNITS, l.unit)),
      h('td', { class: 'num' }, money(l.price, cur) + (l.baseQty && l.baseQty !== '1' ? ' / ' + l.baseQty : '')),
      h('td', { class: 'num' }, money(l.net, cur)),
      h('td', null, [l.vatCat, l.vatRate ? l.vatRate + ' %' : ''].filter(Boolean).join(' '))))))));
    if (m.attachments.length) {
      const files = Reports.attachmentFiles(r);
      pane.append(h('h3', { text: 'Rechnungsbegründende Unterlagen (BG-24)' }));
      pane.append(h('ul', { class: 'attachments' }, m.attachments.map((a, i) => {
        const f = files.find((x) => x.index === i);
        return h('li', null, [a.id, a.desc, a.file, a.mime, a.uri].filter(Boolean).join(' · '),
          f ? [' ', h('button', { class: 'btn secondary small-btn', type: 'button', 'data-action': 'attachment', onclick: () => download(f.name, f.bytes, 'application/octet-stream') }, 'Herunterladen (' + fmtBytes(f.bytes.length) + ')')] : null);
      })));
      pane.append(h('p', { class: 'tiny muted' }, 'Anlagen tragen keine Pflichtangaben: Diese müssen im strukturierten Teil stehen (BMF-Schreiben vom 15.10.2025, Rn. 35). Anlagen werden unverändert gespeichert und nicht geöffnet.'));
    }
    if (m.precedingInvoices.length) pane.append(h('p', { class: 'small' }, 'Vorausgegangene Rechnungen: ' + m.precedingInvoices.map((p) => p.id + (p.date ? ' (' + fmtDate(p.date) + ')' : '')).join(', ')));
    if (m.notes.length) pane.append(h('h3', { text: 'Bemerkungen' }), h('ul', null, m.notes.map((n) => h('li', { class: 'small pre', text: n }))));
  }

  function renderDetails(pane, r) {
    const rows = [];
    rows.push(['Datei', r.name + ' (' + fmtBytes(r.size) + ')']);
    if (r.sha256) rows.push(['SHA-256 (Datei)', r.sha256]);
    if (r.xmlSha256) rows.push(['SHA-256 (eingebettete XML)', r.xmlSha256]);
    if (r.xml) rows.push(['Zeichenkodierung', r.xml.encoding + (r.xml.declared ? ' (deklariert: ' + r.xml.declared + ')' : ' (ohne Deklaration)') + (r.xml.bom ? ', Byte-Order-Mark ' + r.xml.bom : '') + ', ' + fmtBytes(r.xml.size)]);
    if (r.syntax) rows.push(['Syntax', r.syntax]);
    if (r.profile) rows.push(['Spezifikationskennung (BT-24)', r.profile.id || '– fehlt –'], ['Erkanntes Profil', r.profile.label]);
    rows.push(['Prüfweg', r.route === 'kosit' ? 'KoSIT-Validator-Szenario' : r.route === 'none' || !r.route ? '–' : 'Profilregeln (' + (r.rulesetFamily || r.route || '') + ')']);
    if (r.scenario) rows.push(['KoSIT-Szenario', r.scenario.name], ['Angepasste Fehlerstufen (customLevel)', Object.entries(r.scenario.customLevels).map(([k, v]) => k + '→' + LEVEL_LABEL[v]).join(', ') || '–']);
    else if (r.kositScenario) rows.push(['Passendes KoSIT-Szenario (nicht angewendet)', r.kositScenario]);
    if (r.xsd) rows.push(['XML-Schema', r.xsd.schema + ': ' + (r.xsd.valid === true ? 'gültig' : r.xsd.valid === false ? r.xsd.errorCount + ' Fehler' : 'nicht geprüft') + (r.xsd.ms !== undefined ? ' (' + r.xsd.ms + ' ms)' : '')]);
    if (r.ruleSets) rows.push(['Regelwerke', r.ruleSets.map((id) => id + ((BUILD.schemas && BUILD.schemas[id]) ? ' (' + BUILD.schemas[id].stats.asserts + ' Regeln)' : imported[id] ? ' (geladen)' : ' (fehlt)')).join(', ') || 'keine']);
    if (r.timing && r.timing.total) rows.push(['Prüfdauer', Object.entries(r.timing.rules || {}).map(([k, v]) => k + ' ' + v + ' ms').concat(r.timing.xsd !== undefined ? ['XSD ' + r.timing.xsd + ' ms'] : []).concat(r.timing.container !== undefined ? ['PDF-Container ' + r.timing.container + ' ms'] : []).join(', ') + ', gesamt ' + r.timing.total + ' ms']);
    if (r.pdf) {
      rows.push(['PDF-Leseverfahren', r.pdf.method === 'xref' ? 'Querverweistabelle (regulär)' : 'Vollständiger Scan (Querverweistabelle unbrauchbar)']);
      if (r.pdf.xmp && r.pdf.xmp.zugferd) rows.push(['ZUGFeRD/Factur-X XMP', Object.entries(r.pdf.xmp.zugferd).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(', ')]);
      if (r.pdf.xmp && r.pdf.xmp.pdfa) rows.push(['PDF/A-Kennzeichnung (XMP)', 'PDF/A-' + r.pdf.xmp.pdfa.part + (r.pdf.xmp.pdfa.conformance || '')]);
      if (r.pdf.container) {
        const st = r.pdf.container.checks;
        rows.push(['Container-Prüfungen', st.filter((c) => c.status === 'pass').length + ' erfüllt, ' + st.filter((c) => c.status === 'fail').length + ' nicht erfüllt, ' + st.filter((c) => c.status === 'n/a').length + ' nicht anwendbar (vollständige PDF/A-3-Validierung: veraPDF)']);
      }
    }
    if (r.engineWarnings && r.engineWarnings.length) rows.push(['Hinweise der Regel-Engine', r.engineWarnings.slice(0, 5).map((w) => w.message).join(' | ')]);
    pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { text: k }), h('td', { class: 'wrap' }, v)))))));
    if (r.pdf) {
      pane.append(h('h3', { text: 'Eingebettete Dateien der PDF (' + r.pdf.attachments.length + ')' }));
      if (!r.pdf.attachments.length) pane.append(h('p', { class: 'small muted', text: 'keine' }));
      else pane.append(h('ul', { class: 'attachments' }, r.pdf.attachments.map((a, i) => {
        const f = r.pdf.files && r.pdf.files[i];
        return h('li', null, a.name + ' (' + fmtBytes(a.size) + (a.mimeType ? ', ' + a.mimeType : '') + (a.afRelationship ? ', AFRelationship=' + a.afRelationship : '') + ')' + (a.name === r.pdf.invoiceAttachment ? ' – Rechnungs-XML' : ''),
          f ? [' ', h('button', { class: 'btn secondary small-btn', type: 'button', 'data-action': 'pdf-file', onclick: () => download(a.name.replace(/[\\/:*?"<>|]+/g, '_'), f.bytes, 'application/octet-stream') }, 'Herunterladen')] : null);
      })));
    }
    if (r.pdf && r.pdf.container) {
      pane.append(h('h3', { text: 'PDF-Container (ZUGFeRD / Factur-X, PDF/A-3)' }));
      pane.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Prüfung', 'Ergebnis', 'Grundlage'].map((t) => h('th', { text: t })))), h('tbody', null, r.pdf.container.checks.map((c) => h('tr', null, h('td', null, c.title || c.id, h('div', { class: 'tiny mono muted', text: c.id })), h('td', null, c.status === 'pass' ? '✔ erfüllt' : c.status === 'fail' ? '✘ ' + LEVEL_LABEL[c.level === 'info' ? 'information' : c.level] : '– n. a.'), h('td', { class: 'tiny' }, c.reference || '')))))));
    }
  }

  function renderXml(pane, r) {
    const text = r.xml.text;
    const lines = text.split(/\r\n|\r|\n/); // line breaks as in XML 1.0 §2.11 and PrueferCore.elementLineIndex
    const max = 20000;
    const pre = h('pre', { class: 'xml' });
    const hl = new Set((r.allFindings || []).filter((f) => f.line).map((f) => f.line));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < Math.min(lines.length, max); i++) {
      const ln = h('span', { class: 'ln' + (hl.has(i + 1) ? ' hit' : ''), text: String(i + 1).padStart(5, ' ') + ' ' });
      frag.append(ln, document.createTextNode(lines[i] + '\n'));
    }
    pre.append(frag);
    if (lines.length > max) pre.append('… (' + (lines.length - max) + ' weitere Zeilen nicht angezeigt)');
    pane.append(h('p', { class: 'small muted' }, 'Zeilen mit Befunden sind markiert.'), pre);
  }

  // ---------- batch summary + exports ----------
  const results = [];

  function renderSummary() {
    const box = $('#summary');
    box.innerHTML = '';
    if (results.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    const table = h('table', { class: 'data summary' },
      h('thead', null, h('tr', null, ['Datei', 'Format', 'Ergebnis', 'USt-Einordnung', 'Fehler', 'Warnungen', 'Hinweise'].map((t) => h('th', { text: t })))),
      h('tbody', null, results.map((r) => {
        const a = ASSESSMENT[r.assessment] || ASSESSMENT['not-processable'];
        return h('tr', null, h('td', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); const c = document.querySelector('section.result[data-name="' + CSS.escape(r.name) + '"]'); if (c) c.scrollIntoView({ behavior: 'smooth' }); } }, r.name)), h('td', null, r.profile ? r.profile.label : (r.kind || '')), h('td', null, h('span', { class: 'badge small ' + a.cls, text: a.short })), h('td', null, r.ust ? h('span', { class: 'badge small ' + (VERDICT_CLASS[r.ust.id] || 'neutral'), text: r.ust.kurz }) : ''), h('td', { class: 'num' }, r.counts ? r.counts.error : ''), h('td', { class: 'num' }, r.counts ? r.counts.warning : ''), h('td', { class: 'num' }, r.counts ? r.counts.information : ''));
      })));
    box.append(h('h2', { text: 'Übersicht (' + results.length + ' Dateien)' }), h('div', { class: 'table-scroll' }, table));
  }

  const CSV = 'text/csv;charset=utf-8';
  const exportCsv = () => download('E-Rechnung-Pruefbericht.csv', Reports.findingsCsv(results, VAT.legal), CSV);
  const exportDataCsv = () => download('E-Rechnung-Rechnungsdaten.csv', Reports.invoicesCsv(results), CSV);
  const exportLinesCsv = () => download('E-Rechnung-Positionen.csv', Reports.linesCsv(results), CSV);
  const exportJson = () => download('E-Rechnung-Pruefbericht.json', Reports.jsonReport(results, reportCtx()), 'application/json');

  // ---------- wiring ----------
  async function handleFiles(files) {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (!list.length) return;
    const status = $('#status');
    const out = $('#results');
    $('#exports').hidden = false;
    for (const file of list) {
      status.hidden = false;
      status.textContent = file.name + ': wird geprüft …';
      await new Promise((res) => setTimeout(res, 20));
      let r;
      try {
        r = await analyzeFile(file, (msg) => { status.textContent = file.name + ': ' + msg; });
      } catch (e) {
        r = { name: file.name, size: file.size, kind: 'unknown', warnings: ['Unerwarteter Fehler: ' + (e && e.message || e)], assessment: 'not-processable', timing: {} };
        console.error(e);
      }
      results.unshift(r);
      out.prepend(renderResult(r));
    }
    status.hidden = true;
    renderSummary();
  }

  // ---------- loading rule sets that are not redistributed (Peppol BIS) ----------
  const browserHost = (files) => ({
    read: (p) => { if (!(p in files)) throw new Error('Datei ' + p + ' fehlt (sch:include / document())'); return files[p]; },
    exists: (p) => p in files,
    resolve: (...parts) => parts[parts.length - 1],
    dirname: () => '',
    basename: (p) => p,
    parseXml: (t) => { const r = parseXml(t); if (!r.doc) throw new Error('XML nicht wohlgeformt: ' + r.error); return r.doc; },
    serialize: (d) => new XMLSerializer().serializeToString(d),
    sha256: (t) => Sha256.hex(t),
    byteLength: (t) => new TextEncoder().encode(t).length,
    sourceName: (p) => 'vom Benutzer geladen/' + p,
  });
  async function importRuleFile(file) {
    // the SHA-256 is taken over the file's bytes, as in the manifest (build/STANDARDS_MANIFEST.json); the text is
    // decoded per XML 1.0 §4.3.3 like every other XML input
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dec = XmlEncoding.decode(bytes);
    if (!dec.ok) throw new Error(dec.errors.map((e) => e.message).join(' '));
    const text = dec.text.charCodeAt(0) === 0xfeff ? dec.text.slice(1) : dec.text;
    const spec = Object.entries(BUILD.importable || {}).find(([, v]) => v.file === file.name);
    if (!spec) throw new Error('Unbekannte Datei „' + file.name + '“. Erwartet: ' + Object.values(BUILD.importable || {}).map((v) => v.file).join(', '));
    const [id, info] = spec;
    const digest = Sha256.hex(bytes);
    const compiled = SchCompiler.compile(browserHost({ [file.name]: text }), file.name, id);
    compiled.importedFrom = { file: file.name, sha256: digest, verified: digest === info.sha256, expected: info.sha256, loaded: new Date().toISOString() };
    storeImported(id, compiled);
    return compiled;
  }
  function renderRuleImport() {
    const box = $('#ruleimport');
    if (!box || !BUILD.importable) return;
    box.innerHTML = '';
    const list = h('ul', null, Object.entries(BUILD.importable).map(([id, v]) => {
      const c = imported[id];
      return h('li', null, h('strong', { text: id }), ' – ', v.title, ': ',
        c ? h('span', { class: c.importedFrom && c.importedFrom.verified ? 'ok-text' : 'warn-note' }, 'geladen' + (c.importedFrom ? ' (' + c.importedFrom.file + (c.importedFrom.verified ? ', SHA-256 entspricht der geprüften Version ' + v.version : ', ABWEICHENDE Version: SHA-256 ' + c.importedFrom.sha256.slice(0, 12) + '… statt ' + v.sha256.slice(0, 12) + '… – Ergebnisse nicht gegen Referenz verifiziert') + ')' : ''))
          : h('span', { class: 'muted' }, 'nicht geladen – Bezugsquelle: ' + v.source));
    }));
    const input = h('input', { type: 'file', accept: '.sch', multiple: 'multiple' });
    const msg = h('p', { class: 'small' });
    input.addEventListener('change', async () => {
      for (const f of Array.from(input.files)) {
        try { const c = await importRuleFile(f); msg.textContent = f.name + ' geladen: ' + c.stats.asserts + ' Regeln.'; }
        catch (e) { msg.textContent = f.name + ': ' + e.message; }
      }
      input.value = '';
      renderRuleImport();
    });
    box.append(h('p', { class: 'small' }, 'Die Regeln der Peppol BIS Billing 3.0 sind urheberrechtlich geschützt (OpenPeppol AISBL) und ohne Lizenz zur Weitergabe; sie werden deshalb nicht mitgeliefert. Laden Sie die offiziellen Dateien selbst herunter und wählen Sie sie hier aus – sie werden nur in diesem Browser gespeichert.'), list, h('label', { class: 'btn secondary' }, 'Regeldatei (.sch) laden …', input), msg);
  }

  function init() {
    loadImported();
    const drop = $('#drop');
    const input = $('#file');
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
    drop.addEventListener('click', (e) => { if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') input.click(); });
    $('#csv').addEventListener('click', exportCsv);
    $('#data-csv').addEventListener('click', exportDataCsv);
    $('#lines-csv').addEventListener('click', exportLinesCsv);
    $('#json').addEventListener('click', exportJson);
    $('#print').addEventListener('click', () => window.print());
    $('#clear').addEventListener('click', () => { results.length = 0; $('#results').innerHTML = ''; renderSummary(); $('#exports').hidden = true; });
    // build info: rule sets, versions, verification fingerprint (version axis)
    const bi = $('#buildinfo');
    if (bi && BUILD.standards) {
      bi.append(h('ul', null, BUILD.standards.map((x) => h('li', null, h('strong', { text: x.name + ' ' + x.version }), x.detail ? ' – ' + x.detail : '', x.licence ? h('span', { class: 'tiny muted' }, ' (' + x.licence + ')') : null, x.sha256 ? h('span', { class: 'tiny mono muted' }, ' SHA-256 ' + x.sha256.slice(0, 12) + '…') : null))));
      bi.append(h('p', { class: 'small muted' }, 'Build ' + (BUILD.version || '') + ' vom ' + (BUILD.date || '') + ' · Engine fontoxpath ' + (BUILD.fontoxpath || '') + (BUILD.fingerprint ? ' · Prüfstand (Fingerprint der Eingaben aller Testläufe) ' + BUILD.fingerprint.slice(0, 16) : '') + (BUILD.verification ? ' · ' + BUILD.verification : '')));
    }
    renderRuleImport();
    const nl = $('#notices');
    if (nl) for (const n of NOTICES) nl.append(h('details', { class: 'notice' }, h('summary', { text: n.title }), h('pre', { class: 'small pre', text: n.text })));
    // self-test: engine available?
    try { fontoxpath.evaluateXPathToNumber('1 + 1'); } catch (e) { $('#status').hidden = false; $('#status').textContent = 'Fehler: XPath-Engine nicht geladen (' + e.message + ')'; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PrueferApp = { analyzeFile, results, handleFiles, importRuleFile, imported, reportCtx };
})();
