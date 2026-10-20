/*
 * reports.js — the files the Prüfer writes, shared by the browser app and the Node tests (identical bytes for
 * identical input, time and time zone):
 *   findingsCsv(results)            Prüfbericht: one row per finding, with the umsatzsteuerliche Einordnung
 *   invoicesCsv(results)            Rechnungsdaten: one row per invoice (header, parties, totals, payment, VAT per rate)
 *   linesCsv(results)               Positionen: one row per invoice line
 *   jsonReport(results, ctx)        everything, machine-readable (including the data model)
 *   protocolPdf(result, ctx)        Prüfprotokoll of one file (PDF): what was checked with which rules, when, result
 *   invoicePdf(result, ctx)         Lesefassung (PDF): the invoice data in readable form; the XML stays authoritative
 *   attachmentFiles(result)         embedded attachments (BG-24) as {name, mime, bytes}
 * CSV: UTF-8 with byte order mark, ';', CRLF, decimal comma, dates TT.MM.JJJJ — for German spreadsheet programs.
 * ctx: { build: window.PRUEFER_BUILD, now: Date }
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pdf-writer.js'));
  else root.Reports = factory(root.PdfWriter);
})(typeof self !== 'undefined' ? self : this, function (PdfWriter) {
  'use strict';

  // ---------- code lists (labels for display; the code itself is always shown as well) ----------
  const TYPE_CODES = { 326: 'Teilrechnung', 380: 'Rechnung', 381: 'Gutschrift / Rechnungskorrektur (Credit Note)', 383: 'Belastungsanzeige', 384: 'Korrigierte Rechnung', 386: 'Vorauszahlungsrechnung', 389: 'Selbst ausgestellte Rechnung (Gutschrift nach § 14 Abs. 2 Satz 5 UStG)', 393: 'Factoring-Rechnung', 751: 'Rechnungsinformation für Buchungszwecke', 875: 'Abschlagsrechnung (Bauleistung)', 876: 'Teilschlussrechnung (Bauleistung)', 877: 'Schlussrechnung (Bauleistung)' };
  const VAT_CATEGORIES = { S: 'Normaler Steuersatz', AA: 'Ermäßigter Steuersatz', Z: 'Nullsatz', E: 'Steuerbefreit', AE: 'Steuerschuldnerschaft des Leistungsempfängers', K: 'Innergemeinschaftliche Lieferung', G: 'Ausfuhr (außerhalb der EU)', O: 'Nicht steuerbar', L: 'IGIC (Kanarische Inseln)', M: 'IPSI (Ceuta, Melilla)', B: 'Split Payment (Italien)' };
  const PAYMENT_MEANS = { 1: 'Nicht definiert', 10: 'Bargeld', 20: 'Scheck', 30: 'Überweisung', 31: 'Überweisung', 42: 'Zahlung auf Bankkonto', 48: 'Bankkarte', 49: 'Lastschrift', 54: 'Kreditkarte', 55: 'Debitkarte', 57: 'Dauerauftrag', 58: 'SEPA-Überweisung', 59: 'SEPA-Lastschrift', 68: 'Online-Zahlungsdienst', 97: 'Verrechnung', ZZZ: 'Gegenseitig vereinbart' };
  const UNITS = { C62: 'Stück', H87: 'Stück', EA: 'Stück', XPP: 'Stück', HUR: 'Std.', MIN: 'Min.', DAY: 'Tag(e)', WEE: 'Woche(n)', MON: 'Monat(e)', ANN: 'Jahr(e)', KGM: 'kg', GRM: 'g', TNE: 't', MTR: 'm', CMT: 'cm', MMT: 'mm', KMT: 'km', MTK: 'm²', MTQ: 'm³', LTR: 'l', MLT: 'ml', KWH: 'kWh', SET: 'Satz', PR: 'Paar', LS: 'Pauschale', E48: 'Leistungseinheit', P1: '%', XBX: 'Karton', XPK: 'Packung', XPA: 'Packen', XRO: 'Rolle', XBO: 'Flasche', NAR: 'Anzahl', D64: 'Block' };
  const label = (table, code) => (code && table[code] ? table[code] : '');
  const withLabel = (table, code) => (code ? (table[code] ? table[code] + ' (' + code + ')' : code) : '');

  // ---------- value formatting (exact, from the strings of the document) ----------
  /** '1234.5' -> '1234,5' (CSV) */
  const decimalComma = (v) => (v === undefined || v === null ? '' : /^[+-]?\d*\.?\d+$/.test(String(v).trim()) ? String(v).trim().replace('.', ',') : String(v));
  /** '1234.5' -> '1.234,50' (display): grouping, at least two decimals, further decimals only where they are not 0, no rounding */
  function amount(v, cur) {
    if (v === undefined || v === null || v === '') return '';
    const s = String(v).trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] || '') === '')) return s + (cur ? ' ' + cur : '');
    const int = (m[2] || '0').replace(/^0+(?=\d)/, '');
    const frac = (m[3] || '').replace(/0+$/, '').padEnd(2, '0');
    return (m[1] === '-' ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + frac + (cur ? ' ' + cur : '');
  }
  /** a decimal as a canonical string (no leading zeros, no trailing decimal zeros): '19.00' -> '19', '07.50' -> '7.5' */
  function canonicalDecimal(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] || '') === '')) return s;
    const int = (m[2] || '0').replace(/^0+(?=\d)/, '');
    const frac = (m[3] || '').replace(/0+$/, '');
    const out = int + (frac ? '.' + frac : '');
    return (m[1] === '-' && out !== '0' ? '-' : '') + out;
  }
  /** integer with thousands separators: 12345 -> '12.345' */
  const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  /** '1250.500' -> '1.250,5' (quantities, rates): grouping, decimals only where they are not 0 */
  const quantity = (v) => { if (v === undefined || v === null || v === '') return ''; const c = canonicalDecimal(v); const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(c); if (!m) return String(v); return m[1] + grouped(m[2]) + (m[3] ? ',' + m[3] : ''); };
  /** YYYY-MM-DD (also with a time-zone suffix) -> TT.MM.JJJJ; anything else unchanged */
  const date = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (v || ''); };
  const first = (model, id) => ((model && model.bt && model.bt[id]) || [])[0] || '';
  const all = (model, id) => ((model && model.bt && model.bt[id]) || []).join(' | ');

  const ASSESSMENT = { accept: 'Keine Fehler', reject: 'Fehler gefunden', 'not-processable': 'Nicht prüfbar', 'not-applicable': 'Nicht anwendbar', incomplete: 'Unvollständig' };
  const LEVEL = { error: 'Fehler', warning: 'Warnung', information: 'Hinweis' };
  const SOURCE = { encoding: 'Kodierung', pdf: 'PDF-Container', xsd: 'XML-Schema', schematron: 'Geschäftsregel' };
  /** short label of the VAT class of a finding */
  function ustLabel(f, vat) {
    const u = f.ust;
    if (!u) return '';
    if (u.klasse === 'pflicht') return 'Pflichtangabe: ' + u.angaben.map((a) => shortNorm(vat, a)).join(', ');
    return { format: 'Formatfehler', container: 'PDF-Container', zusatz: 'keine Pflichtangabe', 'ohne-bezug': 'keine Pflichtangabe', unbestimmt: 'prüfen' }[u.klasse] || u.klasse;
  }
  function shortNorm(vat, id) {
    const a = vat && vat.angaben ? vat.angaben.find((x) => x.id === id) : null;
    return a ? a.kurz + (a.id === 'nr1v' ? ' (Leistender)' : a.id === 'nr1e' ? ' (Empfänger)' : '') : id;
  }

  // ---------- CSV ----------
  const csvCell = (v) => { const s = String(v === null || v === undefined ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  const routeLabel = (r) => (r.scenario ? 'KoSIT: ' + r.scenario.name : r.rulesetFamily || '');

  function findingsCsv(results, vat) {
    const rows = [['Datei', 'SHA-256', 'Format', 'Profil', 'Prüfweg', 'Ergebnis (technisch)', 'USt-Einordnung', 'Stufe', 'Quelle', 'Regel', 'Regelwerk', 'Meldung', 'Stelle', 'Zeile', 'USt-Bedeutung der Regel', 'Geschäftsbegriffe']];
    for (const r of results) {
      const base = [r.name, r.sha256 || '', r.syntax || r.kind, r.profile ? r.profile.label : '', routeLabel(r), ASSESSMENT[r.assessment] || r.assessment, r.ust ? r.ust.kurz : ''];
      if (!r.allFindings || !r.allFindings.length) rows.push(base.concat(['', '', '', '', (r.warnings || []).join(' | '), '', '', '', '']));
      for (const f of r.allFindings || []) rows.push(base.concat([LEVEL[f.level], SOURCE[f.source] || '', f.id, f.schema, f.text, f.location || '', f.line || '', ustLabel(f, vat), f.ust ? f.ust.bt.join(' ') : '']));
    }
    return csv(rows);
  }

  const CAT_ORDER = ['S', 'AA', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M', 'B'];
  function invoicesCsv(results) {
    const withModel = results.filter((r) => r.model);
    // one pair of columns per VAT category and rate occurring in any invoice
    const keys = [];
    const vatKey = (v) => (v.cat || '?') + '|' + canonicalDecimal(v.rate);
    for (const r of withModel) for (const v of r.model.vat) { const k = vatKey(v); if (!keys.includes(k)) keys.push(k); }
    keys.sort((a, b) => { const [ca, ra] = a.split('|'), [cb, rb] = b.split('|'); const oa = CAT_ORDER.indexOf(ca), ob = CAT_ORDER.indexOf(cb); return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob) || Number(rb || 0) - Number(ra || 0); });
    const head = ['Datei', 'SHA-256', 'Ergebnis (technisch)', 'USt-Einordnung', 'Rechnungsart (BT-3)', 'Rechnungsnummer (BT-1)', 'Rechnungsdatum (BT-2)', 'Leistungsdatum (BT-72)', 'Leistungszeitraum von (BT-73)', 'Leistungszeitraum bis (BT-74)', 'Fälligkeitsdatum (BT-9)', 'Währung (BT-5)', 'Käuferreferenz/Leitweg-ID (BT-10)', 'Bestellnummer (BT-13)', 'Vertragsnummer (BT-12)', 'Projektreferenz (BT-11)', 'Vorausgegangene Rechnung (BT-25)',
      'Verkäufer Name (BT-27)', 'Verkäufer USt-IdNr. (BT-31)', 'Verkäufer Steuernummer (BT-32)', 'Verkäufer Straße (BT-35)', 'Verkäufer PLZ (BT-38)', 'Verkäufer Ort (BT-37)', 'Verkäufer Land (BT-40)', 'Verkäufer E-Mail (BT-43)',
      'Käufer Name (BT-44)', 'Käufer USt-IdNr. (BT-48)', 'Käufer Straße (BT-50)', 'Käufer PLZ (BT-53)', 'Käufer Ort (BT-52)', 'Käufer Land (BT-55)',
      'Summe Positionen netto (BT-106)', 'Summe Nachlässe (BT-107)', 'Summe Zuschläge (BT-108)', 'Gesamtbetrag netto (BT-109)', 'Umsatzsteuer (BT-110)', 'Gesamtbetrag brutto (BT-112)', 'Bereits gezahlt (BT-113)', 'Rundung (BT-114)', 'Fälliger Betrag (BT-115)',
      'Zahlungsart (BT-81)', 'IBAN (BT-84)', 'BIC (BT-86)', 'Kontoinhaber (BT-85)', 'Verwendungszweck (BT-83)', 'Zahlungsbedingungen (BT-20)', 'Skonto (BT-20, XRechnung-Format)', 'USt-Aufschlüsselung (BG-23)']
      .concat(keys.flatMap((k) => { const [c, rate] = k.split('|'); const t = c + (rate !== '' ? ' ' + decimalComma(rate) + ' %' : ''); return ['Bemessungsgrundlage ' + t + ' (BT-116)', 'Steuerbetrag ' + t + ' (BT-117)']; }));
    const rows = [head];
    for (const r of withModel) {
      const m = r.model;
      const f = (id) => first(m, id), d = (id) => date(first(m, id)), a = (id) => decimalComma(first(m, id));
      const row = [r.name, r.sha256 || '', ASSESSMENT[r.assessment] || r.assessment, r.ust ? r.ust.kurz : '', f('BT-3'), f('BT-1'), d('BT-2'), d('BT-72'), d('BT-73'), d('BT-74'), d('BT-9'), f('BT-5'), f('BT-10'), f('BT-13'), f('BT-12'), f('BT-11'), all(m, 'BT-25'),
        f('BT-27'), f('BT-31'), f('BT-32'), f('BT-35'), f('BT-38'), f('BT-37'), f('BT-40'), f('BT-43'),
        f('BT-44'), f('BT-48'), f('BT-50'), f('BT-53'), f('BT-52'), f('BT-55'),
        a('BT-106'), a('BT-107'), a('BT-108'), a('BT-109'), a('BT-110'), a('BT-112'), a('BT-113'), a('BT-114'), a('BT-115'),
        f('BT-81'), all(m, 'BT-84'), all(m, 'BT-86'), all(m, 'BT-85'), f('BT-83'), all(m, 'BT-20'), m.skonto.map((s) => (s.type === 'SKONTO' ? 'Skonto ' : 'Verzug ') + s.days + ' Tage ' + decimalComma(s.percent) + ' %' + (s.base ? ' von ' + decimalComma(s.base) : '')).join(' | '),
        m.vat.map((v) => (v.cat || '?') + (v.rate !== '' ? ' ' + decimalComma(v.rate) + ' %' : '') + ': ' + decimalComma(v.taxable) + ' / ' + decimalComma(v.tax)).join(' | ')];
      for (const k of keys) {
        const rowsK = m.vat.filter((v) => vatKey(v) === k);
        row.push(rowsK.map((v) => decimalComma(v.taxable)).join(' | '), rowsK.map((v) => decimalComma(v.tax)).join(' | '));
      }
      rows.push(row);
    }
    return csv(rows);
  }

  function linesCsv(results) {
    const rows = [['Datei', 'Rechnungsnummer (BT-1)', 'Rechnungsdatum (BT-2)', 'Verkäufer (BT-27)', 'Währung (BT-5)', 'Position (BT-126)', 'Artikelnummer Verkäufer (BT-155)', 'Artikelnummer Käufer (BT-156)', 'Bezeichnung (BT-153)', 'Beschreibung (BT-154)', 'Menge (BT-129)', 'Einheit (BT-130)', 'Einheit (Text)', 'Nettopreis (BT-146)', 'Preisbasismenge (BT-149)', 'Bruttopreis (BT-148)', 'Preisnachlass (BT-147)', 'Nachlässe/Zuschläge der Position (BG-27/28)', 'Nettobetrag (BT-131)', 'USt-Kategorie (BT-151)', 'USt-Satz (BT-152)', 'Zeitraum von (BT-134)', 'Zeitraum bis (BT-135)', 'Bestellposition (BT-132)', 'Buchungsreferenz (BT-133)', 'Bemerkung (BT-127)']];
    for (const r of results) {
      if (!r.model) continue;
      const m = r.model;
      for (const l of m.lines) {
        rows.push([r.name, first(m, 'BT-1'), date(first(m, 'BT-2')), first(m, 'BT-27'), first(m, 'BT-5'), l.id, l.sellerId, l.buyerId, l.name, l.desc, decimalComma(l.qty), l.unit, label(UNITS, l.unit), decimalComma(l.price), decimalComma(l.baseQty), decimalComma(l.grossPrice), decimalComma(l.discount),
          l.allowances.map((x) => (x.indicator === 'true' ? '+' : '-') + decimalComma(x.amount) + (x.reason || x.reasonCode ? ' (' + [x.reasonCode, x.reason].filter(Boolean).join(' ') + ')' : '')).join(' | '),
          decimalComma(l.net), l.vatCat, decimalComma(l.vatRate), date(l.period), date(l.periodEnd), l.orderLine, l.accounting, l.note]);
      }
    }
    return csv(rows);
  }

  // ---------- JSON ----------
  /** the data model without the DOM nodes (non-enumerable); the content of embedded attachments (BT-125, Base64) is
   * replaced by its length – the attachments themselves are files of their own (attachmentFiles) */
  const plainModel = (m) => {
    if (!m) return null;
    const out = JSON.parse(JSON.stringify(m));
    if (out.bt && out.bt['BT-125']) out.bt['BT-125'] = out.bt['BT-125'].map((b) => '[Base64, ' + b.length + ' Zeichen]');
    return out;
  };
  function jsonReport(results, ctx) {
    const build = (ctx && ctx.build) || {};
    const out = results.map((r) => ({ file: r.name, size: r.size, sha256: r.sha256, xmlSha256: r.xmlSha256 || null, kind: r.kind, xml: r.xml, syntax: r.syntax || null, profile: r.profile || null, route: r.route || null, scenario: r.scenario ? r.scenario.name : null, kositScenario: r.kositScenario || null, xsd: r.xsd ? { schema: r.xsd.schema, valid: r.xsd.valid, errorCount: r.xsd.errorCount } : null, ruleSets: r.ruleSets || [], missingRuleSets: r.missingRuleSets || [], assessment: r.assessment, legalStatus: r.legalStatus || null, ust: r.ust || null, counts: r.counts || null, findings: (r.allFindings || []).map((f) => ({ source: f.source, level: f.level, originalLevel: f.originalLevel, id: f.id, schema: f.schema, text: f.text, location: f.location, line: f.line, ust: f.ust || null })), processingErrors: r.processingErrors || [], warnings: r.warnings || [], pdf: r.pdf ? { attachments: r.pdf.attachments, xmp: r.pdf.xmp, method: r.pdf.method, container: r.pdf.container ? r.pdf.container.checks : null } : null, model: plainModel(r.model), timing: r.timing }));
    return JSON.stringify({ tool: build.name, version: build.version, fingerprint: build.fingerprint || null, standards: build.standards, generated: ((ctx && ctx.now) || new Date()).toISOString(), results: out }, null, 2);
  }

  // ---------- file names ----------
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 80);
  function fileName(r, kind, now) {
    const base = safe(first(r.model, 'BT-1')) || safe(String(r.name || '').replace(/\.[^.]+$/, '')) || 'Rechnung';
    const day = (now || new Date()).toISOString().slice(0, 10);
    return kind === 'protocol' ? 'Pruefprotokoll_' + base + '_' + day + '.pdf' : kind === 'invoice' ? 'Rechnung_' + base + '_Lesefassung.pdf' : base;
  }

  // ---------- attachments ----------
  function base64Bytes(b64) {
    const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of clean) {
      if (ch === '=') break;
      buf = (buf << 6) | A.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
    }
    return new Uint8Array(out);
  }
  /** the binary attachments of BG-24 (base64 in the XML) as files */
  function attachmentFiles(r) {
    if (!r.model) return [];
    return r.model.attachments.map((a, i) => (a.base64 ? { index: i, id: a.id, name: safe(a.file) || ('Anlage_' + (i + 1)), mime: a.mime || 'application/octet-stream', bytes: base64Bytes(a.base64), desc: a.desc } : null)).filter(Boolean);
  }

  // ---------- PDF documents ----------
  const C = { ok: [0.106, 0.498, 0.231], bad: [0.702, 0.149, 0.118], warn: [0.604, 0.404, 0], info: [0.122, 0.373, 0.749], neutral: [0.365, 0.42, 0.478], text: [0.1, 0.12, 0.16] };
  const BG = { ok: [0.906, 0.965, 0.925], bad: [0.992, 0.925, 0.918], warn: [1, 0.965, 0.839], info: [0.91, 0.941, 0.996], neutral: [0.933, 0.945, 0.957] };
  const VERDICT_TONE = { ok: 'ok', technisch: 'info', pflicht: 'bad', luecke: 'bad', 'nicht-pruefbar': 'warn', format: 'bad', 'kein-profil': 'bad', 'keine-xml': 'bad', unvollstaendig: 'warn' };
  const ASSESS_TONE = { accept: 'ok', reject: 'bad', 'not-processable': 'warn', 'not-applicable': 'neutral', incomplete: 'warn' };
  const ASSESS_TEXT = {
    accept: 'Keine Format- oder Geschäftsregelfehler (Prüfung wie KoSIT-Validator).',
    reject: 'Technisch fehlerhaft: Format- oder Geschäftsregelfehler (der KoSIT-Validator empfiehlt die Zurückweisung; öffentliche Auftraggeber können sie zurückweisen).',
    'not-processable': 'Nicht vollständig verarbeitbar – nicht automatisiert annehmen.',
    'not-applicable': 'Keine Geschäftsregeln anwendbar (kein unterstütztes E-Rechnungsformat).',
    incomplete: 'Keine Fehler in den geprüften Regelwerken; die Prüfung ist unvollständig (Regelwerk fehlt).',
  };
  /** local time of the machine with its UTC offset, and UTC: '20.10.2026, 19:22:05 (UTC+02:00; 2026-10-20T17:22:05Z)' –
   * formatted by hand (not Intl), so that every browser and Node write the same characters */
  function stamp(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const zone = 'UTC' + (off < 0 ? '-' : '+') + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60);
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' (' + zone + '; ' + d.toISOString().replace(/\.\d{3}Z$/, 'Z') + ')';
  }
  function footer(doc, left, text) {
    return (n, total) => {
      doc.line(left, 46, doc.page.w - left, 46, 0.4, [0.8, 0.84, 0.88]);
      doc.text(left, 34, text, 'F1', 7, C.neutral);
      const p = 'Seite ' + n + ' von ' + total;
      doc.text(doc.page.w - left - doc.width(p, 'F1', 7), 34, p, 'F1', 7, C.neutral);
    };
  }
  const metaOf = (r, ctx, title) => ({ title, subject: r.name, creator: ((ctx.build && ctx.build.name) || 'E-Rechnung Prüfer') + ' ' + ((ctx.build && ctx.build.version) || ''), producer: 'E-Rechnung Prüfer (src/pdf-writer.js)', date: ctx.now, id: (r.sha256 || '').slice(0, 32), lang: 'de-DE' });

  function protocolPdf(r, ctx) {
    ctx = ctx || {};
    const build = ctx.build || {};
    const now = ctx.now || new Date();
    const doc = PdfWriter.createDocument(metaOf(r, Object.assign({}, ctx, { now }), 'Prüfprotokoll E-Rechnung – ' + r.name));
    const fl = PdfWriter.createFlow(doc, {});
    const m = r.model;
    fl.heading('Prüfprotokoll E-Rechnung', 1);
    fl.text('Datei „' + r.name + '“ · geprüft am ' + stamp(now), { size: 9, color: C.neutral, after: 6 });

    fl.heading('Geprüfte Datei', 2);
    fl.kv([
      ['Dateiname', r.name], ['Größe', r.size !== undefined ? grouped(r.size) + ' Byte' : ''],
      ['SHA-256 der Datei', r.sha256 || '', 'F3'], ['SHA-256 der eingebetteten XML', r.xmlSha256 || '', 'F3'],
      ['Eingebettete XML (PDF)', r.pdf && r.pdf.invoiceAttachment ? r.pdf.invoiceAttachment : ''],
      ['Syntax', r.syntax || r.kind || ''], ['Spezifikationskennung (BT-24)', r.profile ? r.profile.id || '– fehlt –' : ''], ['Erkanntes Profil', r.profile ? r.profile.label : ''],
      ['Prüfweg', r.route === 'kosit' && r.scenario ? 'wie KoSIT-Validator, Szenario „' + r.scenario.name + '“' : r.ruleSets && r.ruleSets.length ? 'Profilregeln (' + (r.rulesetFamily || r.route) + ')' : '–'],
      ['XML-Schema', r.xsd ? r.xsd.schema + ': ' + (r.xsd.valid === true ? 'gültig' : r.xsd.valid === false ? r.xsd.errorCount + ' Fehler' : 'nicht geprüft') : ''],
      ['Regelwerke', (r.ruleSetsRun || r.ruleSets || []).join(', ')],
    ], { labelWidth: 140 });

    const tone = ASSESS_TONE[r.assessment] || 'neutral';
    fl.heading('Ergebnis der technischen Prüfung', 2);
    fl.box([{ text: (ASSESSMENT[r.assessment] || r.assessment) + ': ' + (ASSESS_TEXT[r.assessment] || ''), font: 'F2' }, { text: r.counts ? r.counts.error + ' Fehler, ' + r.counts.warning + ' Warnungen, ' + r.counts.information + ' Hinweise' + ((r.processingErrors || []).length ? ', ' + r.processingErrors.length + ' Verarbeitungsfehler' : '') : '' }].filter((p) => p.text), BG[tone], C[tone]);
    for (const w of r.warnings || []) fl.text('Hinweis: ' + w, { size: 8.5, color: C.warn });

    if (r.ust) {
      const t = VERDICT_TONE[r.ust.id] || 'neutral';
      fl.heading('Umsatzsteuerliche Einordnung (Deutschland)', 2);
      fl.box([{ text: r.ust.kurz, font: 'F2', size: 10.5 }, { text: r.ust.text }].concat(r.ust.angaben.length ? [{ text: 'Betroffene Pflichtangaben: ' + r.ust.angaben.map((a) => a.norm).join('; ') }] : []), BG[t], C[t]);
      for (const h of r.ust.hinweise) fl.text(h, { size: 8, color: C.neutral });
      if (r.ust.pflichtangaben) {
        fl.heading('Pflichtangaben im strukturierten Teil (Vorhandensein)', 3);
        fl.table([{ title: 'Angabe', width: 0.3 }, { title: 'Status', width: 0.12 }, { title: 'Werte / Hinweis', width: 0.58 }],
          r.ust.pflichtangaben.items.map((i) => [i.norm.replace(/ UStG$/, '') + ' – ' + i.text, i.status, i.werte.map((w) => w[0] + ': ' + w[1]).join('; ') + (i.hinweis ? (i.werte.length ? ' – ' : '') + i.hinweis : '')]),
          { size: 7.8, rowColor: (k, row) => (row[1] === 'fehlt' ? BG.bad : row[1] === 'prüfen' ? BG.warn : null) });
        fl.text('Geprüft wird nur, ob die Angaben im strukturierten Teil vorhanden sind – nicht, ob sie richtig sind. Inhaltsfehler sind auch ohne Regelverstoß möglich (BMF-Schreiben vom 15.10.2025, Rn. 35a).', { size: 7.8, color: C.neutral });
      }
    }

    fl.heading('Befunde (' + ((r.allFindings || []).length) + ')', 2);
    if (r.allFindings && r.allFindings.length) {
      fl.table([{ title: 'Stufe', width: 0.08 }, { title: 'Regel', width: 0.15 }, { title: 'USt-Bedeutung', width: 0.15 }, { title: 'Meldung', width: 0.55 }, { title: 'Zeile', width: 0.07, align: 'right' }],
        r.allFindings.map((f) => [LEVEL[f.level], f.id, ustLabel(f, ctx.vat), f.text, f.line ? String(f.line) : '']),
        { size: 7.5, rowColor: (k, row) => (row[0] === 'Fehler' ? BG.bad : null) });
    } else fl.text(r.allFindings ? 'Keine Befunde.' : 'Keine Prüfung durchgeführt.', { size: 9 });

    if (m) {
      fl.heading('Rechnung (Kurzfassung)', 2);
      const cur = first(m, 'BT-5');
      fl.kv([['Rechnungsnummer (BT-1)', first(m, 'BT-1')], ['Rechnungsdatum (BT-2)', date(first(m, 'BT-2'))], ['Rechnungsart (BT-3)', withLabel(TYPE_CODES, first(m, 'BT-3'))], ['Verkäufer (BT-27)', first(m, 'BT-27')], ['USt-IdNr. / Steuernummer', [first(m, 'BT-31'), first(m, 'BT-32')].filter(Boolean).join(' / ')], ['Käufer (BT-44)', first(m, 'BT-44')], ['Netto (BT-109)', amount(first(m, 'BT-109'), cur)], ['Umsatzsteuer (BT-110)', amount(first(m, 'BT-110'), cur)], ['Brutto (BT-112)', amount(first(m, 'BT-112'), cur)], ['Fälliger Betrag (BT-115)', amount(first(m, 'BT-115'), cur)]]);
    }

    fl.heading('Prüfwerkzeug und Regelstand', 2);
    fl.kv([['Werkzeug', (build.name || 'E-Rechnung Prüfer') + ' ' + (build.version || '') + (build.date ? ' (Build ' + build.date + ')' : '')], ['Prüfstand (Fingerprint)', build.fingerprint || '', 'F3'], ['Nachweis der Testreihen', build.verification || '']], { labelWidth: 130 });
    if (build.standards) fl.table([{ title: 'Regelwerk / Schema', width: 0.42 }, { title: 'Version', width: 0.3 }, { title: 'SHA-256 (Anfang)', width: 0.28, font: 'F3' }], build.standards.map((s) => [s.name, s.version, s.sha256 ? s.sha256.slice(0, 24) + '…' : '']), { size: 7.5 });
    fl.text('Aufbewahrung: Bewahren Sie dieses Protokoll zusammen mit der Rechnung auf; die SHA-256-Prüfsumme belegt, auf welche Datei es sich bezieht. ' + (ctx.vat && ctx.vat.hinweise && ctx.vat.hinweise.validierungsbericht ? ctx.vat.hinweise.validierungsbericht + ' ' : '') + 'Dieses Protokoll ersetzt keine steuerliche Beratung.', { size: 8, color: C.neutral });
    if (doc.stats.replaced) fl.text(doc.stats.replaced + ' Zeichen außerhalb von Windows-1252 sind in diesem PDF ersetzt; maßgeblich ist die XML.', { size: 7.5, color: C.neutral });
    return doc.finish(footer(doc, fl.left, 'Prüfprotokoll · ' + (build.name || 'E-Rechnung Prüfer') + ' ' + (build.version || '') + ' · SHA-256 ' + (r.sha256 || '').slice(0, 16) + '…'));
  }

  function invoicePdf(r, ctx) {
    ctx = ctx || {};
    const now = ctx.now || new Date();
    const m = r.model;
    if (!m) return null;
    const cur = first(m, 'BT-5');
    const typeCode = first(m, 'BT-3');
    const doc = PdfWriter.createDocument(metaOf(r, Object.assign({}, ctx, { now }), (label(TYPE_CODES, typeCode) || 'Rechnung') + ' ' + first(m, 'BT-1') + ' (Lesefassung)'));
    const fl = PdfWriter.createFlow(doc, {});
    const W = fl.width;
    fl.text('Lesefassung einer elektronischen Rechnung – rechtlich maßgeblich ist der strukturierte XML-Teil (BMF-Schreiben vom 15.10.2024, Rz. 31).', { size: 7.5, color: C.neutral, after: 6 });
    // seller | buyer side by side
    const partyLines = (list) => list.filter(Boolean);
    const sellerL = partyLines([first(m, 'BT-27'), first(m, 'BT-28') && first(m, 'BT-28') !== first(m, 'BT-27') ? first(m, 'BT-28') : '', first(m, 'BT-35'), first(m, 'BT-36'), first(m, 'BT-162'), [first(m, 'BT-38'), first(m, 'BT-37')].filter(Boolean).join(' '), first(m, 'BT-40'), first(m, 'BT-31') ? 'USt-IdNr. ' + first(m, 'BT-31') : '', first(m, 'BT-32') ? 'Steuernummer ' + first(m, 'BT-32') : '', [first(m, 'BT-41'), first(m, 'BT-42'), first(m, 'BT-43')].filter(Boolean).join(' · ')]);
    const buyerL = partyLines([first(m, 'BT-44'), first(m, 'BT-50'), first(m, 'BT-51'), first(m, 'BT-163'), [first(m, 'BT-53'), first(m, 'BT-52')].filter(Boolean).join(' '), first(m, 'BT-55'), first(m, 'BT-48') ? 'USt-IdNr. ' + first(m, 'BT-48') : '', [first(m, 'BT-56'), first(m, 'BT-57'), first(m, 'BT-58')].filter(Boolean).join(' · ')]);
    const yTop = fl.y;
    const col = (title, lines, x) => { let y = yTop; doc.text(x, y - 8, title, 'F2', 8, C.neutral); y -= 13; lines.forEach((l, i) => { for (const w of fl.wrap(l, i === 0 ? 'F2' : 'F1', 9, W / 2 - 14)) { doc.text(x, y - 9, w, i === 0 ? 'F2' : 'F1', 9, C.text); y -= 11.5; } }); return y; };
    const y1 = col('Verkäufer', sellerL, fl.left), y2 = col('Käufer', buyerL, fl.left + W / 2 + 7);
    fl.gap(yTop - Math.min(y1, y2) + 8);
    fl.heading((label(TYPE_CODES, typeCode) || 'Rechnung') + ' ' + first(m, 'BT-1'), 1);
    const period = first(m, 'BT-73') || first(m, 'BT-74') ? date(first(m, 'BT-73')) + ' – ' + date(first(m, 'BT-74')) : '';
    fl.kv([['Rechnungsnummer', first(m, 'BT-1')], ['Rechnungsdatum', date(first(m, 'BT-2'))], ['Rechnungsart', withLabel(TYPE_CODES, typeCode)], ['Liefer-/Leistungsdatum', date(first(m, 'BT-72'))], ['Leistungszeitraum', period], ['Fälligkeitsdatum', date(first(m, 'BT-9'))], ['Käuferreferenz / Leitweg-ID', first(m, 'BT-10')], ['Bestellnummer', first(m, 'BT-13')], ['Auftragsnummer', first(m, 'BT-14')], ['Vertragsnummer', first(m, 'BT-12')], ['Projektreferenz', first(m, 'BT-11')], ['Lieferscheinnummer', first(m, 'BT-16')], ['Vorausgegangene Rechnung', m.precedingInvoices.map((p) => p.id + (p.date ? ' vom ' + date(p.date) : '')).join(', ')], ['Währung', cur]], { labelWidth: 140 });
    if (m.delivery.length) fl.kv([['Lieferung an', [first(m, 'BT-70'), first(m, 'BT-75'), [first(m, 'BT-78'), first(m, 'BT-77')].filter(Boolean).join(' '), first(m, 'BT-80')].filter(Boolean).join(', ')]], { labelWidth: 140 });
    if (m.payeeParty.length) fl.kv([['Zahlungsempfänger', first(m, 'BT-59')]], { labelWidth: 140 });
    if (m.taxRep.length) fl.kv([['Steuervertreter', [first(m, 'BT-62'), first(m, 'BT-63') ? 'USt-IdNr. ' + first(m, 'BT-63') : '', [first(m, 'BT-67'), first(m, 'BT-66')].filter(Boolean).join(' ')].filter(Boolean).join(', ')]], { labelWidth: 140 });

    fl.heading('Positionen (' + m.lines.length + ')', 2);
    fl.table([{ title: 'Pos.', width: 0.06 }, { title: 'Bezeichnung', width: 0.42 }, { title: 'Menge', width: 0.13, align: 'right' }, { title: 'Einzelpreis', width: 0.14, align: 'right' }, { title: 'USt', width: 0.09, align: 'right' }, { title: 'Netto', width: 0.16, align: 'right' }],
      m.lines.map((l) => [l.id, [l.name, l.desc, l.sellerId ? 'Art.-Nr. ' + l.sellerId : '', l.period || l.periodEnd ? 'Zeitraum ' + date(l.period) + ' – ' + date(l.periodEnd) : '', l.allowances.map((x) => (x.indicator === 'true' ? 'Zuschlag ' : 'Nachlass ') + amount(x.amount, cur) + (x.reason ? ' (' + x.reason + ')' : '')).join('; '), l.note].filter(Boolean).join('\n'), quantity(l.qty) + ' ' + (label(UNITS, l.unit) || l.unit), amount(l.price, '') + (l.baseQty && l.baseQty !== '1' ? ' / ' + quantity(l.baseQty) : ''), [l.vatCat, l.vatRate !== '' ? quantity(l.vatRate) + ' %' : ''].filter(Boolean).join(' '), amount(l.net, '')]),
      { size: 8 });
    if (m.allowances.length) {
      fl.heading('Nachlässe und Zuschläge auf Rechnungsebene', 3);
      fl.table([{ title: 'Art', width: 0.15 }, { title: 'Grund', width: 0.45 }, { title: 'USt', width: 0.15, align: 'right' }, { title: 'Betrag', width: 0.25, align: 'right' }], m.allowances.map((a) => [a.indicator === 'true' ? 'Zuschlag' : 'Nachlass', [a.reasonCode, a.reason].filter(Boolean).join(' – '), [a.vatCat, a.vatRate !== '' ? quantity(a.vatRate) + ' %' : ''].filter(Boolean).join(' '), amount(a.amount, cur)]), { size: 8 });
    }
    fl.heading('Beträge', 2);
    const tot = [['Summe der Positionen (netto)', 'BT-106'], ['Summe der Nachlässe', 'BT-107'], ['Summe der Zuschläge', 'BT-108'], ['Gesamtbetrag netto', 'BT-109'], ['Umsatzsteuer', 'BT-110'], ['Umsatzsteuer in Abrechnungswährung (' + first(m, 'BT-6') + ')', 'BT-111'], ['Gesamtbetrag brutto', 'BT-112'], ['Bereits gezahlt', 'BT-113'], ['Rundungsbetrag', 'BT-114'], ['Fälliger Betrag', 'BT-115']].filter(([, id]) => first(m, id) !== '');
    fl.table([{ title: 'Betrag', width: 0.7 }, { title: cur || '', width: 0.3, align: 'right' }], tot.map(([l, id]) => [l, amount(first(m, id), id === 'BT-111' ? first(m, 'BT-6') : '')]), { size: 8.5, rowColor: (k, row) => (row[0] === 'Fälliger Betrag' ? BG.info : null) });
    if (m.vat.length) {
      fl.heading('Umsatzsteuer-Aufschlüsselung', 3);
      fl.table([{ title: 'Kategorie', width: 0.4 }, { title: 'Satz', width: 0.12, align: 'right' }, { title: 'Bemessungsgrundlage', width: 0.24, align: 'right' }, { title: 'Steuerbetrag', width: 0.24, align: 'right' }], m.vat.map((v) => [withLabel(VAT_CATEGORIES, v.cat) + (v.reason || v.reasonCode ? '\n' + [v.reasonCode, v.reason].filter(Boolean).join(' – ') : ''), v.rate !== '' ? quantity(v.rate) + ' %' : '', amount(v.taxable, ''), amount(v.tax, '')]), { size: 8 });
    }
    fl.heading('Zahlung', 2);
    fl.kv([['Zahlungsart', withLabel(PAYMENT_MEANS, first(m, 'BT-81')) + (first(m, 'BT-82') ? ' – ' + first(m, 'BT-82') : '')], ['IBAN / Konto', all(m, 'BT-84')], ['BIC', all(m, 'BT-86')], ['Kontoinhaber', all(m, 'BT-85')], ['Verwendungszweck', first(m, 'BT-83')], ['Mandatsreferenz', first(m, 'BT-89')], ['Gläubiger-ID', first(m, 'BT-90')], ['Zahlungsbedingungen', all(m, 'BT-20')], ['Skonto', m.skonto.map((s) => (s.type === 'SKONTO' ? 'Skonto ' : 'Verzugszinsen ') + s.days + ' Tage, ' + quantity(s.percent) + ' %' + (s.base ? ' auf ' + amount(s.base, cur) : '')).join('; ')]], { labelWidth: 140 });
    if (m.notes.length) { fl.heading('Bemerkungen', 2); for (const n of m.notes) fl.text(n, { size: 8.5 }); }
    if (m.attachments.length) { fl.heading('Rechnungsbegründende Unterlagen', 2); for (const a of m.attachments) fl.text([a.id, a.desc, a.file, a.uri].filter(Boolean).join(' · '), { size: 8.5 }); }
    if (doc.stats.replaced) fl.text(doc.stats.replaced + ' Zeichen außerhalb von Windows-1252 sind in dieser Lesefassung ersetzt; maßgeblich ist die XML.', { size: 7.5, color: C.neutral });
    return doc.finish(footer(doc, fl.left, 'Lesefassung von „' + r.name + '“ (SHA-256 ' + (r.sha256 || '').slice(0, 16) + '…) · erstellt am ' + now.toISOString().slice(0, 10) + ' mit ' + (((ctx.build || {}).name) || 'E-Rechnung Prüfer') + ' ' + (((ctx.build || {}).version) || '')));
  }

  return { findingsCsv, invoicesCsv, linesCsv, jsonReport, protocolPdf, invoicePdf, attachmentFiles, fileName, base64Bytes, amount, quantity, canonicalDecimal, date, decimalComma, ustLabel, stamp, TYPE_CODES, VAT_CATEGORIES, PAYMENT_MEANS, UNITS, ASSESS_TEXT };
});
