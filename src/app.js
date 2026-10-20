/*
 * app.js — E-Rechnung Prüfer (standalone, offline). UI and orchestration.
 * Depends on globals: fontoxpath, SchematronRunner, PdfEmbedded, InvoiceModel, PrueferCore,
 * PRUEFER_SCHEMAS, PRUEFER_SCENARIOS, PRUEFER_BUILD.
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
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  const SCHEMAS = window.PRUEFER_SCHEMAS;          // embedded rule sets (compiled Schematron)
  const XSD_MODELS = window.PRUEFER_XSD;           // embedded XML Schema models
  const SCENARIOS = window.PRUEFER_SCENARIOS;      // KoSIT scenarios
  const RULESETS = window.PRUEFER_RULESETS;        // profile -> rule sets (build/rulesets.json)
  const BUILD = window.PRUEFER_BUILD || {};
  const NOTICES = window.PRUEFER_NOTICES || [];

  const LEVEL_LABEL = { error: 'Fehler', warning: 'Warnung', information: 'Hinweis' };
  const LEVEL_ORDER = { error: 0, warning: 1, information: 2 };
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
    fontoxpath, SchematronRunner, XsdValidator, PdfEmbedded, PdfA3Checks, XmlEncoding, InvoiceModel,
    scenarios: SCENARIOS, rulesets: RULESETS,
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

  /** Line number of every element start, in document order (same order as DOM document order). */
  function elementLineIndex(text) {
    const lines = [];
    let line = 1;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) { line++; i++; continue; }
      if (c !== 60) { i++; continue; } // '<'
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); const end = e < 0 ? n : e + 3; for (let k = i; k < end; k++) if (text.charCodeAt(k) === 10) line++; i = end; continue; }
      if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); const end = e < 0 ? n : e + 3; for (let k = i; k < end; k++) if (text.charCodeAt(k) === 10) line++; i = end; continue; }
      if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); const end = e < 0 ? n : e + 2; for (let k = i; k < end; k++) if (text.charCodeAt(k) === 10) line++; i = end; continue; }
      if (text.startsWith('<!', i)) { // DOCTYPE with optional internal subset
        let depth = 0, k = i;
        for (; k < n; k++) { const ch = text[k]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) { k++; break; } else if (ch === '\n') line++; }
        i = k; continue;
      }
      if (text[i + 1] === '/') { i++; continue; }
      lines.push(line); // element start
      i++;
    }
    return lines;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtDate(v) {
    if (!v) return v;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return m[3] + '.' + m[2] + '.' + m[1];
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (m) return m[3] + '.' + m[2] + '.' + m[1] + ' (' + v + ')';
    return v;
  }
  const DATE_TERMS = new Set(['BT-2', 'BT-9', 'BT-72', 'BT-73', 'BT-74']);

  function money(v, cur) {
    if (v === '' || v === undefined || v === null) return '';
    const num = Number(v);
    if (!Number.isFinite(num)) return v;
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
  }

  // ---------- analysis (src/pruefer-core.js: the same pipeline as the command-line version) ----------
  async function analyzeFile(file, progress) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await PrueferCore.analyzeBytes(CORE_ENV, bytes, file.name, progress);
    // line numbers: map every finding back to its element in the source text
    if (r.xml && r.xml.text && r.doc) {
      const tLines = performance.now();
      const lineIndex = elementLineIndex(r.xml.text);
      const elements = r.doc.getElementsByTagName('*');
      const elementNo = new Map();
      for (let i = 0; i < elements.length; i++) elementNo.set(elements[i], i);
      let byPath = null; // XSD errors carry a path only
      for (const f of r.allFindings) {
        let n = f.node || null;
        if (!n && f.location && f.source === 'xsd') {
          if (!byPath) { byPath = new Map(); for (const k of r.docIndex.keys()) if (k.nodeType === 1 || k.nodeType === 2) byPath.set(SchematronRunner.nodePath(k), k); }
          n = byPath.get(f.location.replace(/\/@[^/]+$/, (m) => m)) || byPath.get(f.location) || null;
        }
        const el = n ? (n.nodeType === 2 ? n.ownerElement : n) : null;
        const no = el ? elementNo.get(el) : undefined;
        f.line = no !== undefined && lineIndex[no] ? lineIndex[no] : null;
      }
      r.timing.lines = Math.round(performance.now() - tLines);
    }
    return r;
  }

  // ---------- rendering ----------
  const ASSESSMENT = {
    accept: { cls: 'ok', text: 'Keine Fehler – das Dokument kann angenommen werden', short: 'OK' },
    reject: { cls: 'bad', text: 'Fehler gefunden – es wird empfohlen, das Dokument zurückzuweisen', short: 'Fehler' },
    'not-processable': { cls: 'warn', text: 'Das Dokument konnte nicht vollständig verarbeitet werden und sollte nicht automatisiert angenommen werden', short: 'Nicht prüfbar' },
    'not-applicable': { cls: 'neutral', text: 'Keine Geschäftsregeln anwendbar (kein unterstütztes E-Rechnungsformat)', short: 'Nicht anwendbar' },
    incomplete: { cls: 'warn', text: 'Keine Fehler in den geprüften Regelwerken – die Prüfung ist jedoch unvollständig, weil ein Regelwerk fehlt (siehe unten)', short: 'Unvollständig' },
  };

  function renderResult(r) {
    const a = ASSESSMENT[r.assessment] || ASSESSMENT['not-processable'];
    const card = h('section', { class: 'card result ' + a.cls, 'data-name': r.name });
    const title = h('div', { class: 'result-head' },
      h('div', { class: 'badge ' + a.cls, text: a.short }),
      h('div', { class: 'result-title' },
        h('h2', { text: r.name }),
        h('div', { class: 'muted small' }, fmtBytes(r.size) + (r.sha256 ? ' · SHA-256 ' + r.sha256.slice(0, 16) + '…' : '') + (r.timing && r.timing.total ? ' · ' + r.timing.total + ' ms' : ''))
      )
    );
    card.append(title);
    card.append(h('p', { class: 'assessment' }, a.text));
    if (r.profile) {
      const bits = [r.syntax === 'CII' ? 'UN/CEFACT CII D16B' : r.syntax === 'UBL-CreditNote' ? 'UBL 2.1 CreditNote' : 'UBL 2.1 Invoice', r.profile.label];
      if (r.kind === 'pdf') bits.unshift('PDF mit eingebetteter XML (' + ((r.pdf && r.pdf.invoiceAttachment) || '?') + ')');
      card.append(h('p', { class: 'small' }, h('strong', { text: 'Format: ' }), bits.join(' · ')));
      if (r.route === 'kosit' && r.scenario) card.append(h('p', { class: 'small' }, h('strong', { text: 'Prüfung wie KoSIT-Validator, Szenario: ' }), r.scenario.name, ' – XML-Schema ', r.xsd ? r.xsd.schema : '–', ', Regelwerke: ', r.ruleSets.join(' + ')));
      else if (r.ruleSets && r.ruleSets.length) card.append(h('p', { class: 'small' }, h('strong', { text: 'Prüfung nach Profil' + (r.rulesetFamily ? ' „' + r.rulesetFamily + '“' : '') + ': ' }), 'XML-Schema ', r.xsd ? r.xsd.schema : '–', ', Regelwerke: ', r.ruleSets.join(' + '), r.kositScenario ? '' : ' (kein KoSIT-Szenario – der XRechnung-Validator der KoSIT würde dieses Dokument nicht annehmen)'));
      if (r.profile.note) card.append(h('p', { class: 'note' }, r.profile.note));
      if (r.legalStatus === 'not-e-invoice') card.append(h('p', { class: 'note warn-note' }, 'Rechtlicher Status: keine E-Rechnung im Sinne der EN 16931 / des § 14 Abs. 1 UStG.'));
      if (r.schematronSkipped === 'xsd-invalid') card.append(h('p', { class: 'note warn-note' }, 'Das Dokument verletzt das XML-Schema (' + r.xsd.schema + ', ' + r.xsd.errorCount + ' Fehler). Wie beim KoSIT-Validator werden die Geschäftsregeln dann nicht geprüft.'));
      for (const m of r.missingRuleSets || []) card.append(h('p', { class: 'note warn-note' }, 'Regelwerk ' + m.id + ' wurde nicht angewendet: ' + m.reason + '.'));
    }
    for (const w of r.warnings) card.append(h('p', { class: 'note warn-note' }, w));
    if (r.pdf && r.pdf.warnings && r.pdf.warnings.length) card.append(h('details', null, h('summary', { text: 'Hinweise des PDF-Lesers (' + r.pdf.warnings.length + ')' }), h('ul', null, r.pdf.warnings.map((w) => h('li', { class: 'small', text: w })))));

    if (r.allFindings) {
      const c = r.counts;
      card.append(h('div', { class: 'counts' },
        h('span', { class: 'pill error', text: c.error + ' Fehler' }),
        h('span', { class: 'pill warning', text: c.warning + ' Warnungen' }),
        h('span', { class: 'pill information', text: c.information + ' Hinweise' }),
        h('span', { class: 'pill neutral', text: (r.processingErrors && r.processingErrors.length ? r.processingErrors.length + ' Verarbeitungsfehler' : 'keine Verarbeitungsfehler') })
      ));
    }

    // tabs
    const tabs = h('div', { class: 'tabs' });
    const panes = {};
    const addTab = (key, label, build) => {
      const btn = h('button', { class: 'tab', type: 'button', text: label, onclick: () => { for (const b of tabs.children) b.classList.toggle('active', b === btn); for (const [k, p] of Object.entries(panes)) p.hidden = k !== key; } });
      tabs.append(btn);
      const pane = h('div', { class: 'pane' });
      pane.hidden = true;
      let built = false;
      const origClick = btn.onclick;
      btn.addEventListener('click', () => { if (!built) { build(pane); built = true; } });
      panes[key] = pane;
      return { btn, pane, build: () => { if (!built) { build(pane); built = true; } } };
    };
    card.append(tabs);
    const t1 = addTab('report', 'Prüfbericht', (pane) => renderFindings(pane, r));
    if (r.model) addTab('invoice', 'Rechnungsdaten', (pane) => renderModel(pane, r));
    addTab('details', 'Details', (pane) => renderDetails(pane, r));
    if (r.xml && r.xml.text) addTab('xml', 'XML', (pane) => renderXml(pane, r));
    for (const p of Object.values(panes)) card.append(p);
    t1.btn.classList.add('active');
    t1.build();
    panes.report.hidden = false;
    return card;
  }

  function renderFindings(pane, r) {
    if (!r.allFindings) { pane.append(h('p', { class: 'muted' }, 'Keine Prüfung durchgeführt.')); return; }
    if (r.processingErrors && r.processingErrors.length) {
      pane.append(h('div', { class: 'proc-errors' },
        h('h3', { text: 'Verarbeitungsfehler' }),
        h('p', { class: 'small' }, 'Beim Auswerten einzelner Regeln traten Fehler auf (meist, weil ein Wert nicht dem erwarteten Datentyp entspricht). Ein solches Dokument sollte nicht automatisiert angenommen werden (wie beim KoSIT-Validator).'),
        h('ul', null, r.processingErrors.map((e) => h('li', { class: 'small mono' }, (e.id ? e.id + ' ' : '') + (e.location ? '@ ' + e.location + ' ' : '') + '– ' + e.message)))
      ));
    }
    if (!r.allFindings.length) {
      const what = [r.xsd && r.xsd.valid ? 'XML-Schema ' + r.xsd.schema : null].concat((r.ruleSetsRun || []).map((x) => x)).filter(Boolean);
      pane.append(h('p', { class: 'ok-text' }, '✔ Keine Befunde' + (what.length ? ' (' + what.join(', ') + ')' : '') + '.'));
      return;
    }
    const filter = h('div', { class: 'filter' });
    const table = h('table', { class: 'findings' });
    table.append(h('thead', null, h('tr', null, ['Stufe', 'Regel', 'Meldung', 'Stelle', 'Zeile'].map((t) => h('th', { text: t })))));
    const tbody = h('tbody');
    const rows = r.allFindings.map((f) => {
      const tr = h('tr', { class: 'lvl-' + f.level },
        h('td', null, h('span', { class: 'pill ' + f.level, text: LEVEL_LABEL[f.level] }), f.customLevel ? h('div', { class: 'tiny muted', text: 'KoSIT-Stufe (Regelwerk: ' + LEVEL_LABEL[f.originalLevel] + ')' }) : null),
        h('td', { class: 'mono' }, f.id, h('div', { class: 'tiny muted', text: (SOURCE_LABEL[f.source] || '') + ' · ' + (f.schema || '') })),
        h('td', null, f.text, f.source === 'schematron' ? h('details', { class: 'tiny' }, h('summary', { text: 'Regel anzeigen' }), h('div', { class: 'mono wrap' }, 'Kontext: ' + f.context), h('div', { class: 'mono wrap' }, 'Test: ' + f.test)) : f.reference ? h('div', { class: 'tiny muted', text: 'Grundlage: ' + f.reference }) : null),
        h('td', { class: 'mono wrap small' }, f.location || ''),
        h('td', { class: 'num' }, f.line ? String(f.line) : '')
      );
      tr.dataset.level = f.level;
      return tr;
    });
    tbody.append(...rows);
    table.append(tbody);
    for (const lvl of ['error', 'warning', 'information']) {
      const cb = h('input', { type: 'checkbox', checked: 'checked' });
      cb.addEventListener('change', () => { for (const tr of rows) if (tr.dataset.level === lvl) tr.hidden = !cb.checked; });
      filter.append(h('label', null, cb, ' ' + LEVEL_LABEL[lvl] + ' (' + r.counts[lvl] + ')'));
    }
    pane.append(filter, table);
  }

  function renderModel(pane, r) {
    const m = r.model;
    const cur = (m.header.find((t) => t.id === 'BT-5') || {}).value || '';
    const dl = (items) => h('dl', { class: 'kv' }, items.map((t) => [h('dt', null, t.label, h('span', { class: 'bt', text: t.id })), h('dd', null, t.value)]));
    pane.append(h('div', { class: 'grid2' },
      h('div', null, h('h3', { text: 'Rechnung' }), dl(m.header.map((t) => (DATE_TERMS.has(t.id) ? { id: t.id, label: t.label, value: fmtDate(t.value) } : t)))),
      h('div', null, h('h3', { text: 'Beträge' }), dl(m.totals.map((t) => ({ id: t.id, label: t.label, value: money(t.value, cur) }))))
    ));
    pane.append(h('div', { class: 'grid2' },
      h('div', null, h('h3', { text: 'Verkäufer' }), dl(m.seller)),
      h('div', null, h('h3', { text: 'Käufer' }), dl(m.buyer))
    ));
    if (m.payee || m.deliveryParty || m.deliveryAddress) pane.append(h('p', { class: 'small' }, m.payee ? 'Zahlungsempfänger: ' + m.payee + ' ' : '', m.deliveryParty ? 'Lieferung an: ' + m.deliveryParty + ' ' : '', m.deliveryAddress ? '(' + m.deliveryAddress + ')' : ''));
    if (m.payment.length) pane.append(h('h3', { text: 'Zahlung' }), dl(m.payment));
    if (m.skonto.length) pane.append(h('h3', { text: 'Skonto / Verzug (BT-20, XRechnung-Format)' }), h('ul', null, m.skonto.map((s) => h('li', null, s.type + ': ' + s.days + ' Tage, ' + s.percent + ' %' + (s.base ? ', Basisbetrag ' + money(s.base, cur) : '')))));
    if (m.vat.length) {
      pane.append(h('h3', { text: 'Umsatzsteuer-Aufschlüsselung (BG-23)' }));
      pane.append(h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Kategorie', 'Satz %', 'Bemessungsgrundlage', 'Steuerbetrag', 'Befreiungsgrund'].map((t) => h('th', { text: t })))), h('tbody', null, m.vat.map((v) => h('tr', null, h('td', null, v.cat), h('td', { class: 'num' }, v.rate), h('td', { class: 'num' }, money(v.taxable, cur)), h('td', { class: 'num' }, money(v.tax, cur)), h('td', null, [v.reasonCode, v.reason].filter(Boolean).join(' – ')))))));
    }
    if (m.allowances.length) {
      pane.append(h('h3', { text: 'Nachlässe / Zuschläge auf Dokumentebene (BG-20/21)' }));
      pane.append(h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Art', 'Betrag', 'Basis', '%', 'Grund', 'USt'].map((t) => h('th', { text: t })))), h('tbody', null, m.allowances.map((v) => h('tr', null, h('td', null, v.indicator === 'true' ? 'Zuschlag' : 'Nachlass'), h('td', { class: 'num' }, money(v.amount, cur)), h('td', { class: 'num' }, money(v.base, cur)), h('td', { class: 'num' }, v.pct), h('td', null, [v.reasonCode, v.reason].filter(Boolean).join(' – ')), h('td', null, [v.vatCat, v.vatRate ? v.vatRate + ' %' : ''].filter(Boolean).join(' ')))))));
    }
    pane.append(h('h3', { text: 'Positionen (' + m.lines.length + ')' }));
    pane.append(h('table', { class: 'data lines' }, h('thead', null, h('tr', null, ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Netto', 'USt'].map((t) => h('th', { text: t })))), h('tbody', null, m.lines.map((l) => h('tr', null, h('td', null, l.id), h('td', null, l.name, l.desc ? h('div', { class: 'tiny muted', text: l.desc }) : null, l.note ? h('div', { class: 'tiny muted', text: l.note }) : null, l.period ? h('div', { class: 'tiny muted', text: 'Zeitraum ' + l.period + (l.periodEnd ? ' – ' + l.periodEnd : '') }) : null), h('td', { class: 'num' }, l.qty), h('td', null, l.unit), h('td', { class: 'num' }, money(l.price, cur) + (l.baseQty && l.baseQty !== '1' ? ' / ' + l.baseQty : '')), h('td', { class: 'num' }, money(l.net, cur)), h('td', null, [l.vatCat, l.vatRate ? l.vatRate + ' %' : ''].filter(Boolean).join(' ')))))));
    if (m.attachments.length) {
      pane.append(h('h3', { text: 'Rechnungsbegründende Unterlagen (BG-24)' }));
      pane.append(h('ul', null, m.attachments.map((a) => h('li', null, [a.id, a.desc, a.file, a.mime, a.uri, a.size && a.size !== '0' ? '~' + fmtBytes(Math.round(Number(a.size) * 0.75)) + ' eingebettet' : ''].filter(Boolean).join(' · ')))));
    }
    if (m.precedingInvoices.length) pane.append(h('p', { class: 'small' }, 'Vorausgegangene Rechnungen: ' + m.precedingInvoices.map((p) => p.id + (p.date ? ' (' + p.date + ')' : '')).join(', ')));
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
    rows.push(['Prüfweg', r.route === 'kosit' ? 'KoSIT-Validator-Szenario' : r.route === 'none' ? '–' : 'Profilregeln (' + (r.rulesetFamily || r.route || '') + ')']);
    if (r.scenario) rows.push(['KoSIT-Szenario', r.scenario.name], ['Angepasste Fehlerstufen (customLevel)', Object.entries(r.scenario.customLevels).map(([k, v]) => k + '→' + LEVEL_LABEL[v]).join(', ') || '–']);
    else if (r.kositScenario) rows.push(['Passendes KoSIT-Szenario (nicht angewendet)', r.kositScenario]);
    if (r.xsd) rows.push(['XML-Schema', r.xsd.schema + ': ' + (r.xsd.valid === true ? 'gültig' : r.xsd.valid === false ? r.xsd.errorCount + ' Fehler' : 'nicht geprüft') + (r.xsd.ms !== undefined ? ' (' + r.xsd.ms + ' ms)' : '')]);
    if (r.ruleSets) rows.push(['Regelwerke', r.ruleSets.map((id) => id + ((BUILD.schemas && BUILD.schemas[id]) ? ' (' + BUILD.schemas[id].stats.asserts + ' Regeln)' : imported[id] ? ' (geladen)' : ' (fehlt)')).join(', ') || 'keine']);
    if (r.timing && r.timing.total) rows.push(['Prüfdauer', Object.entries(r.timing.rules || {}).map(([k, v]) => k + ' ' + v + ' ms').concat(r.timing.xsd !== undefined ? ['XSD ' + r.timing.xsd + ' ms'] : []).concat(r.timing.container !== undefined ? ['PDF-Container ' + r.timing.container + ' ms'] : []).join(', ') + ', gesamt ' + r.timing.total + ' ms']);
    if (r.pdf) {
      rows.push(['PDF-Anhänge', r.pdf.attachments.map((a) => a.name + ' (' + fmtBytes(a.size) + (a.mimeType ? ', ' + a.mimeType : '') + (a.afRelationship ? ', AFRelationship=' + a.afRelationship : '') + ')').join('; ') || 'keine']);
      rows.push(['PDF-Leseverfahren', r.pdf.method === 'xref' ? 'Querverweistabelle (regulär)' : 'Vollständiger Scan (Querverweistabelle unbrauchbar)']);
      if (r.pdf.xmp && r.pdf.xmp.zugferd) rows.push(['ZUGFeRD/Factur-X XMP', Object.entries(r.pdf.xmp.zugferd).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(', ')]);
      if (r.pdf.xmp && r.pdf.xmp.pdfa) rows.push(['PDF/A-Kennzeichnung (XMP)', 'PDF/A-' + r.pdf.xmp.pdfa.part + (r.pdf.xmp.pdfa.conformance || '')]);
      if (r.pdf.container) {
        const st = r.pdf.container.checks;
        rows.push(['Container-Prüfungen', st.filter((c) => c.status === 'pass').length + ' erfüllt, ' + st.filter((c) => c.status === 'fail').length + ' nicht erfüllt, ' + st.filter((c) => c.status === 'n/a').length + ' nicht anwendbar (vollständige PDF/A-3-Validierung: veraPDF)']);
      }
    }
    if (r.engineWarnings && r.engineWarnings.length) rows.push(['Hinweise der Regel-Engine', r.engineWarnings.slice(0, 5).map((w) => w.message).join(' | ')]);
    pane.append(h('table', { class: 'data' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { text: k }), h('td', { class: 'wrap' }, v))))));
    if (r.pdf && r.pdf.container) {
      pane.append(h('h3', { text: 'PDF-Container (ZUGFeRD / Factur-X, PDF/A-3)' }));
      pane.append(h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Prüfung', 'Ergebnis', 'Grundlage'].map((t) => h('th', { text: t })))), h('tbody', null, r.pdf.container.checks.map((c) => h('tr', null, h('td', null, c.title || c.id, h('div', { class: 'tiny mono muted', text: c.id })), h('td', null, c.status === 'pass' ? '✔ erfüllt' : c.status === 'fail' ? '✘ ' + LEVEL_LABEL[c.level === 'info' ? 'information' : c.level] : '– n. a.'), h('td', { class: 'tiny' }, c.reference || ''))))));
    }
  }

  function renderXml(pane, r) {
    const text = r.xml.text;
    const lines = text.split(/\r?\n/);
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
      h('thead', null, h('tr', null, ['Datei', 'Format', 'Ergebnis', 'Fehler', 'Warnungen', 'Hinweise'].map((t) => h('th', { text: t })))),
      h('tbody', null, results.map((r) => {
        const a = ASSESSMENT[r.assessment] || ASSESSMENT['not-processable'];
        return h('tr', null, h('td', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); const c = document.querySelector('section.result[data-name="' + CSS.escape(r.name) + '"]'); if (c) c.scrollIntoView({ behavior: 'smooth' }); } }, r.name)), h('td', null, r.profile ? r.profile.label : (r.kind || '')), h('td', null, h('span', { class: 'badge small ' + a.cls, text: a.short })), h('td', { class: 'num' }, r.counts ? r.counts.error : ''), h('td', { class: 'num' }, r.counts ? r.counts.warning : ''), h('td', { class: 'num' }, r.counts ? r.counts.information : ''));
      }))
    );
    box.append(h('h2', { text: 'Übersicht (' + results.length + ' Dateien)' }), table);
  }

  function csvEscape(v) { const s = String(v === null || v === undefined ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    const rows = [['Datei', 'SHA-256', 'Format', 'Profil', 'Prüfweg', 'Ergebnis', 'Stufe', 'Quelle', 'Regel', 'Regelwerk', 'Meldung', 'Stelle', 'Zeile']];
    for (const r of results) {
      const base = [r.name, r.sha256 || '', r.syntax || r.kind, r.profile ? r.profile.label : '', r.scenario ? 'KoSIT: ' + r.scenario.name : (r.rulesetFamily || ''), ASSESSMENT[r.assessment] ? ASSESSMENT[r.assessment].short : r.assessment];
      if (!r.allFindings || !r.allFindings.length) rows.push(base.concat(['', '', '', '', r.warnings.join(' | '), '', '']));
      for (const f of r.allFindings || []) rows.push(base.concat([LEVEL_LABEL[f.level], SOURCE_LABEL[f.source] || '', f.id, f.schema, f.text, f.location || '', f.line || '']));
    }
    download('E-Rechnung-Pruefbericht.csv', '\ufeff' + rows.map((row) => row.map(csvEscape).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() {
    const out = results.map((r) => ({ file: r.name, size: r.size, sha256: r.sha256, xmlSha256: r.xmlSha256 || null, kind: r.kind, xml: r.xml, syntax: r.syntax || null, profile: r.profile || null, route: r.route || null, scenario: r.scenario ? r.scenario.name : null, kositScenario: r.kositScenario || null, xsd: r.xsd ? { schema: r.xsd.schema, valid: r.xsd.valid, errorCount: r.xsd.errorCount } : null, ruleSets: r.ruleSets || [], missingRuleSets: r.missingRuleSets || [], assessment: r.assessment, legalStatus: r.legalStatus || null, counts: r.counts || null, findings: (r.allFindings || []).map((f) => ({ source: f.source, level: f.level, originalLevel: f.originalLevel, id: f.id, schema: f.schema, text: f.text, location: f.location, line: f.line })), processingErrors: r.processingErrors || [], warnings: r.warnings, pdf: r.pdf ? { attachments: r.pdf.attachments, xmp: r.pdf.xmp, method: r.pdf.method, container: r.pdf.container ? r.pdf.container.checks : null } : null, timing: r.timing }));
    download('E-Rechnung-Pruefbericht.json', JSON.stringify({ tool: BUILD.name, version: BUILD.version, fingerprint: BUILD.fingerprint || null, standards: BUILD.standards, generated: new Date().toISOString(), results: out }, null, 2), 'application/json');
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

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
    // the SHA-256 is taken over the file's bytes, as in the manifest (build/manifest.json); the text is
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
  window.PrueferApp = { analyzeFile, results, handleFiles, importRuleFile, imported };
})();
