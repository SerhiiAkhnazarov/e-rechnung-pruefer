#!/usr/bin/env node
/*
 * run-vat-tests.cjs — tests of the umsatzsteuerliche Einordnung (src/vat-relevance.js with legal/ust-pflichtangaben.json):
 *
 *   1. the legal table: every business term exists in the syntax binding (build/bt-paths.json), every rule override
 *      names a rule of the compiled rule sets, every Angabe/verdict/hint the code uses is defined;
 *   2. classification of findings: expected classes written down by hand from the rule texts and the law (each case
 *      with its reason), for message-based rules with the real message of the compiled rule set, for position-based
 *      rules with the real finding (node) of the CEN unit test document;
 *   3. checklist and verdict: hand-made invoices for every status and every verdict (Kleinbetrag, Kleinunternehmer,
 *      Endrechnung, Gutschrift, § 14a, § 22c, § 31 Abs. 5 UStDV, Nr. 6a from 2028, foreign currency …);
 *   4. the whole corpus (build/corpus): every finding classified, every verdict consistent with its findings and
 *      checklist — summary of classes and verdicts.
 *
 * Usage: node test/run-vat-tests.cjs [--no-corpus] [--corpus-dirs a,b]
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { createEnv, vatPaths } = require(path.join(root, 'tools', 'node-env.cjs'));
const VatRelevance = require(path.join(root, 'src', 'vat-relevance.js'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const legal = JSON.parse(fs.readFileSync(path.join(root, 'legal', 'ust-pflichtangaben.json'), 'utf8'));
const paths = vatPaths();
const vat = VatRelevance.create({ legal, paths });
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => a.slice().sort();

// ---------------------------------------------------------------------------------------------------------------
// 1. the legal table
// ---------------------------------------------------------------------------------------------------------------
const known = new Set();
for (const m of Object.values(paths.syntax)) for (const v of Object.values(m)) v.forEach((x) => known.add(x));
for (const [g, mem] of Object.entries(paths.groups)) { known.add(g); mem.forEach((x) => known.add(x)); }
const angabeIds = new Set(legal.angaben.map((a) => a.id));
check('legal: version 2', legal.version === 2);
check('legal: Angabe ids unique', angabeIds.size === legal.angaben.length);
for (const a of legal.angaben) {
  check('legal: Angabe ' + a.id + ' complete', ['id', 'kurz', 'norm', 'text'].every((k) => typeof a[k] === 'string' && a[k]) && Array.isArray(a.bt) && typeof a.kleinbetrag === 'boolean');
  for (const bt of a.bt) check('legal: ' + a.id + ' ' + bt + ' in the syntax binding', known.has(bt));
  if (a.gueltigAb) check('legal: ' + a.id + ' gueltigAb is a date', /^\d{4}-\d{2}-\d{2}$/.test(a.gueltigAb));
}
// the rule ids of all compiled rule sets (Peppol: compiled locally from the pinned source, never shipped)
const ruleIds = new Set();
const schemaDir = path.join(root, 'build', 'schemas');
const ruleSetFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.json'));
(function collect(x) { if (Array.isArray(x)) x.forEach(collect); else if (x && typeof x === 'object') { if (x.kind && x.id && (x.kind === 'assert' || x.kind === 'report')) ruleIds.add(x.id); Object.values(x).forEach(collect); } })(ruleSetFiles.map((f) => JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8'))));
const havePeppol = ruleSetFiles.some((f) => /^PEPPOL-/.test(f));
let peppolUnchecked = 0;
for (const [id, r] of Object.entries(legal.regeln)) {
  if (id === '_comment') continue;
  const peppol = /^(PEPPOL-|DE-R-)/.test(id);
  if (peppol && !havePeppol) peppolUnchecked++;
  else check('legal: rule ' + id + ' exists in the compiled rule sets', ruleIds.has(id));
  check('legal: rule ' + id + ' has bt and grund', Array.isArray(r.bt) && r.bt.length > 0 && typeof r.grund === 'string' && r.grund.length > 10);
  for (const bt of r.bt) check('legal: rule ' + id + ' ' + bt + ' known', known.has(bt));
  for (const a of r.angaben || []) check('legal: rule ' + id + ' Angabe ' + a + ' defined', angabeIds.has(a));
  for (const w of r.wenn || []) {
    check('legal: rule ' + id + ' condition complete', known.has(w.vorhanden) && Array.isArray(w.bt) && typeof w.grund === 'string');
    for (const a of (w.angaben || []).concat(w.nurAngaben || [])) check('legal: rule ' + id + ' condition Angabe ' + a + ' defined', angabeIds.has(a));
  }
}
for (const k of ['format', 'pflicht', 'unbestimmt', 'ohne-bezug', 'zusatz', 'container']) check('legal: class ' + k, !!(legal.klassen[k] && legal.klassen[k].kurz && legal.klassen[k].text));
for (const k of ['keine-xml', 'nicht-pruefbar', 'format', 'kein-profil', 'pflicht', 'luecke', 'technisch', 'ok', 'unvollstaendig']) check('legal: verdict ' + k, !!(legal.urteile[k] && legal.urteile[k].kurz && legal.urteile[k].text));
check('legal: verdict texts luecke.zusatzTechnisch, ok.zusatzPruefen', !!(legal.urteile.luecke.zusatzTechnisch && legal.urteile.ok.zusatzPruefen));
for (const k of ['geltung', 'uebergang', 'ausnahmen', 'ausland', 'kaeuferAusland', 'kleinbetrag', 'kleinunternehmer', 'reverseCharge', 'hybrid', 'kodierung', 'validierungsbericht']) check('legal: hint ' + k, typeof legal.hinweise[k] === 'string' && legal.hinweise[k].length > 20);
const qids = legal.quellen.map((q) => q.id);
check('legal: source ids unique', new Set(qids).size === qids.length);
for (const q of legal.quellen) check('legal: source ' + q.id + ' has title and https URL', !!q.titel && /^https:\/\//.test(q.url));
// every BMF reference in the texts names a letter that is listed as a source
const texts = JSON.stringify([legal.klassen, legal.urteile, legal.hinweise, legal.regeln]);
for (const m of new Set(texts.match(/BMF-Schreiben vom \d{2}\.\d{2}\.\d{4}/g))) check('legal: ' + m + ' listed as a source', legal.quellen.some((q) => q.titel.includes(m)));

// ---------------------------------------------------------------------------------------------------------------
// 2. classification
// ---------------------------------------------------------------------------------------------------------------
// the message of a rule as compiled (text parts; value-of parts as '…')
const messages = {};
(function collect(x) { if (Array.isArray(x)) x.forEach(collect); else if (x && typeof x === 'object') { if (x.kind && x.id && Array.isArray(x.msg) && !messages[x.id]) messages[x.id] = x.msg.map((p) => (p.t === 'text' ? p.v : '…')).join(''); Object.values(x).forEach(collect); } })(ruleSetFiles.map((f) => JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8'))));
const finding = (id, extra) => Object.assign({ source: 'schematron', level: 'error', id, text: messages[id] || '' }, extra || {});
const model = (bt, more) => Object.assign({ bt, lines: [], vat: [], skonto: [] }, more || {});
// [rule, expected class, expected Angaben (sorted) or null = any, reason, model?]
const CASES = [
  ['BR-01', 'ohne-bezug', [], 'Spezifikationskennung (BT-24) ist keine Pflichtangabe'],
  ['BR-02', 'pflicht', ['nr4'], 'Rechnungsnummer (BT-1): § 14 Abs. 4 Satz 1 Nr. 4'],
  ['BR-03', 'pflicht', ['nr3'], 'Ausstellungsdatum (BT-2): Nr. 3'],
  ['BR-04', 'pflicht', ['nr10'], 'Rechnungsart (BT-3): ohne sie ist eine Gutschrift nicht erkennbar (Nr. 10) – vorsichtig zugeordnet'],
  ['BR-05', 'pflicht', ['nr7'], 'Währung (BT-5): Entgelt'],
  ['BR-06', 'pflicht', ['nr1v'], 'Name des Verkäufers (BT-27): Nr. 1'],
  ['BR-07', 'pflicht', ['nr1e'], 'Name des Käufers (BT-44): Nr. 1'],
  ['BR-08', 'pflicht', ['nr1v'], 'Anschrift des Verkäufers (BG-5): Nr. 1'],
  ['BR-09', 'pflicht', ['nr1v'], 'Land des Verkäufers (BT-40): Anschrift'],
  ['BR-10', 'pflicht', ['nr1e'], 'Anschrift des Käufers (BG-8): Nr. 1'],
  ['BR-11', 'pflicht', ['nr1e'], 'Land des Käufers (BT-55)'],
  ['BR-12', 'pflicht', ['nr7'], 'Summe der Nettobeträge (BT-106): Entgelt'],
  ['BR-13', 'pflicht', ['nr7'], 'Gesamtbetrag ohne Umsatzsteuer (BT-109): Entgelt'],
  ['BR-14', 'pflicht', ['nr7', 'nr8'], 'Gesamtbetrag mit Umsatzsteuer (BT-112)'],
  ['BR-15', 'ohne-bezug', [], 'Zahlbetrag (BT-115) ist keine Pflichtangabe'],
  ['BR-CO-16', 'ohne-bezug', [], 'Zahlbetrag ohne bereits gezahlten Betrag: keine Pflichtangabe'],
  ['BR-CO-16', 'pflicht', ['14-5'], 'mit bereits gezahltem Betrag (BT-113): Endrechnung, § 14 Abs. 5 Satz 2 UStG', model({ 'BT-113': ['500.00'] })],
  ['BR-CO-16', 'ohne-bezug', [], 'bereits gezahlter Betrag 0: keine Endrechnung', model({ 'BT-113': ['0.00'] })],
  ['BR-CO-25', 'ohne-bezug', [], 'Fälligkeitsdatum oder Zahlungsbedingungen: keine Pflichtangabe'],
  ['BR-DE-15', 'ohne-bezug', [], 'Käuferreferenz/Leitweg-ID (BT-10): Anforderung öffentlicher Auftraggeber, keine Pflichtangabe'],
  ['BR-DE-16', 'pflicht', ['14a', '22c', 'nr2'], 'USt-IdNr./Steuernummer des Verkäufers oder Steuervertreter (die USt-IdNr. trägt auch § 14a)'],
  ['BR-DE-18', 'pflicht', ['nr7'], 'Skonto in BT-20: im Voraus vereinbarte Minderung (Nr. 7)'],
  ['BR-DE-22', 'ohne-bezug', [], 'Dateinamen der Anlagen'],
  ['BR-G-02', 'pflicht', ['14a', '22c', 'nr2'], 'Ausfuhr ohne USt-IdNr. des Verkäufers und ohne Steuernummer'],
  ['BR-G-02', 'ohne-bezug', [], 'Ausfuhr mit Steuernummer (BT-32): das UStG verlangt nicht mehr', model({ 'BT-32': ['123/456/78901'] })],
  ['BR-O-02', 'pflicht', ['nr7', 'nr8'], 'Kategorie O mit USt-IdNr.: Steuerkategorie und Steuerangaben passen nicht zusammen'],
  ['BR-S-02', 'pflicht', ['14a', '22c', 'nr2'], 'Normalsatz ohne USt-IdNr./Steuernummer'],
  ['BR-AE-02', 'pflicht', ['14a', '22c', 'nr2'], 'Reverse charge ohne die Kennungen'],
  ['BR-IC-12', 'ohne-bezug', [], 'Lieferland bei innergemeinschaftlicher Lieferung ist keine Pflichtangabe'],
  ['BR-IC-11', 'pflicht', ['nr6'], 'Liefer- oder Abrechnungsdatum bei innergemeinschaftlicher Lieferung'],
  ['BR-CO-03', 'pflicht', ['nr6', 'nr6a'], 'BT-7 und BT-8 schließen sich aus; ohne Rechnungsdatum gilt Nr. 6a vorsichtshalber'],
  ['BR-CO-03', 'pflicht', ['nr6'], 'Rechnung von 2027: Nr. 6a gilt erst ab 1.1.2028', model({ 'BT-2': ['2027-12-31'] })],
  ['BR-CO-03', 'pflicht', ['nr6', 'nr6a'], 'Rechnung von 2028: Nr. 6a gilt', model({ 'BT-2': ['2028-01-01'] })],
];
for (const [rule, klasse, angaben, reason, m] of CASES) {
  if (!messages[rule]) { check('classification ' + rule + ': message in the compiled rule sets', false, 'not found'); continue; }
  const u = vat.classify(finding(rule), 'UBL-Invoice', m || null);
  check('classification ' + rule + (m ? ' (' + JSON.stringify(m.bt) + ')' : '') + ': ' + reason, u.klasse === klasse && (angaben === null || same(sorted(u.angaben), sorted(angaben))), 'got ' + u.klasse + ' ' + JSON.stringify(u.angaben));
}
// an override whose reason says "keine Pflichtangabe" must have that effect (without a condition of the invoice)
for (const [id, r] of Object.entries(legal.regeln)) {
  if (id === '_comment' || !/keine Pflichtangabe/.test(r.grund)) continue;
  const u = vat.classify({ source: 'schematron', level: 'error', id, text: messages[id] || '' }, 'UBL-Invoice', null);
  check('classification ' + id + ': reason "keine Pflichtangabe" = ohne-bezug', u.klasse === 'ohne-bezug', JSON.stringify(u.angaben));
}
check('classification: XML Schema finding = Formatfehler', vat.classify({ source: 'xsd', level: 'error', id: 'cvc-complex-type.2.4.a', text: '' }, 'UBL-Invoice').klasse === 'format');
check('classification: encoding finding = Formatfehler', vat.classify({ source: 'encoding', level: 'error', id: 'XR-ENCODING', text: '' }, 'UBL-Invoice').klasse === 'format');
check('classification: PDF container finding = PDF-Container', vat.classify({ source: 'pdf', level: 'error', id: 'PDFA3-AF', text: '' }, 'CII').klasse === 'container');
check('classification: UBL-CR "should not include" = zusatz', vat.classify(finding('UBL-CR-001'), 'UBL-Invoice').klasse === 'zusatz', JSON.stringify(vat.classify(finding('UBL-CR-001'), 'UBL-Invoice')));
check('classification: only extension terms (BT-X-…) = unbestimmt', vat.classify({ source: 'schematron', level: 'error', id: 'X-1', text: 'The element (BT-X-14) must …' }, 'CII').klasse === 'unbestimmt');
check('classification: no message terms, no position = unbestimmt', vat.classify({ source: 'schematron', level: 'error', id: 'X-2', text: 'Something is wrong' }, 'CII').klasse === 'unbestimmt');
// position-based: the real findings of CEN unit test documents (EN16931-UBL rules applied directly)
{
  const env = createEnv({ exclude: /^PEPPOL-/ });
  const runner = env.SchematronRunner.create(env.fontoxpath, env.ruleSet('EN16931-UBL'));
  // the CEN unit test documents of a rule (…__<rule>__t<n>.xml): the ones that violate it
  const POS = [
    ['BR-CL-01', 'pflicht', ['nr10'], 'Code der Rechnungsart (cbc:InvoiceTypeCode = BT-3)'],
    ['BR-CL-06', 'pflicht', ['nr6a'], 'Code des Steuerfälligkeitsdatums (BT-8): Nr. 6a, ohne Rechnungsdatum vorsichtshalber'],
  ];
  const cenDir = path.join(root, 'build', 'corpus', 'cen-ubl');
  for (const [rule, klasse, angaben, reason] of POS) {
    const files = fs.existsSync(cenDir) ? fs.readdirSync(cenDir).filter((f) => f.startsWith('Invoice-unit-UBL__' + rule + '__t')) : [];
    const fs2 = [];
    for (const file of files) fs2.push(...runner.validate(env.parseXml(fs.readFileSync(path.join(cenDir, file), 'utf8')).doc).findings.filter((f) => f.id === rule));
    check('classification by position ' + rule + ': finding present in the CEN unit tests (' + files.length + ' documents)', fs2.length > 0);
    for (const f of fs2) {
      const g = Object.assign({ source: 'schematron' }, f, { node: f.node, test: f.test }); // node: not enumerable
      const u = vat.classify(g, 'UBL-Invoice', null);
      check('classification by position ' + rule + ': ' + reason, u.klasse === klasse && u.basis === 'stelle' && same(sorted(u.angaben), sorted(angaben)), JSON.stringify(u));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 3. checklist and verdict on hand-made invoices
// ---------------------------------------------------------------------------------------------------------------
const BASE = {
  'BT-1': ['R-2026-001'], 'BT-2': ['2026-10-01'], 'BT-3': ['380'], 'BT-5': ['EUR'],
  'BT-27': ['Muster GmbH'], 'BT-35': ['Hauptstraße 1'], 'BT-38': ['10115'], 'BT-37': ['Berlin'], 'BT-40': ['DE'], 'BT-31': ['DE123456789'],
  'BT-44': ['Kunde AG'], 'BT-50': ['Nebenweg 2'], 'BT-53': ['80331'], 'BT-52': ['München'], 'BT-55': ['DE'],
  'BT-72': ['2026-09-30'], 'BT-109': ['1000.00'], 'BT-110': ['190.00'], 'BT-112': ['1190.00'], 'BT-115': ['1190.00'],
};
const LINE = { id: '1', name: 'Beratung', qty: '10', unit: 'HUR', net: '1000.00', vatCat: 'S', vatRate: '19', allowances: [], attributes: [] };
const VAT_S = { cat: 'S', rate: '19', taxable: '1000.00', tax: '190.00', reason: '', reasonCode: '' };
function inv(changes, more) {
  const bt = Object.assign({}, BASE);
  for (const [k, v] of Object.entries(changes || {})) { if (v === null) delete bt[k]; else bt[k] = v; }
  const vatRows = (more && more.vat) || [VAT_S];
  bt['BT-118'] = vatRows.map((v) => v.cat);
  return Object.assign({ bt, lines: [LINE], vat: vatRows, skonto: [] }, more || {}, { vat: vatRows });
}
const statusOf = (m, id) => { const it = vat.checklist(m).items.find((i) => i.id === id); return it ? it.status : '(fehlt in der Liste)'; };
const S = (name, m, id, expected) => check('checklist ' + id + ': ' + name, statusOf(m, id) === expected, 'got ' + statusOf(m, id) + ' – ' + ((vat.checklist(m).items.find((i) => i.id === id) || {}).hinweis || ''));
// complete invoice: every item present or not applicable
{
  const c = vat.checklist(inv());
  const bad = c.items.filter((i) => !['vorhanden', 'nicht zutreffend'].includes(i.status));
  check('checklist: complete invoice has only vorhanden / nicht zutreffend', bad.length === 0, JSON.stringify(bad.map((i) => i.id + ':' + i.status)));
  check('checklist: all Angaben of the table listed', same(sorted(c.items.map((i) => i.id)), sorted(legal.angaben.map((a) => a.id))));
  check('checklist: complete invoice is no Kleinbetrag / Kleinunternehmer', !c.kleinbetrag && !c.kleinunternehmer);
}
// Nr. 1
S('seller name missing', inv({ 'BT-27': null }), 'nr1v', 'fehlt');
S('seller trading name instead of name', inv({ 'BT-27': null, 'BT-28': ['Muster'] }), 'nr1v', 'vorhanden');
S('seller place and postcode missing', inv({ 'BT-37': null, 'BT-38': null }), 'nr1v', 'fehlt');
S('seller street missing (§ 31 Abs. 2 UStDV)', inv({ 'BT-35': null }), 'nr1v', 'prüfen');
S('seller place missing, postcode present', inv({ 'BT-37': null }), 'nr1v', 'prüfen');
S('buyer address missing', inv({ 'BT-50': null, 'BT-53': null, 'BT-52': null }), 'nr1e', 'fehlt');
// Kleinbetrag (§ 33 UStDV)
{
  const kb = inv({ 'BT-44': null, 'BT-50': null, 'BT-53': null, 'BT-52': null, 'BT-31': null, 'BT-1': null, 'BT-72': null, 'BT-109': ['100.00'], 'BT-110': ['19.00'], 'BT-112': ['119.00'] });
  check('checklist: total 119.00 EUR is a Kleinbetragsrechnung', vat.checklist(kb).kleinbetrag === true);
  S('Kleinbetrag: buyer not required', kb, 'nr1e', 'entfällt');
  S('Kleinbetrag: tax number not required', kb, 'nr2', 'entfällt');
  S('Kleinbetrag: invoice number not required', kb, 'nr4', 'entfällt');
  S('Kleinbetrag: time of supply not required', kb, 'nr6', 'entfällt');
  S('Kleinbetrag: seller still required', inv({ 'BT-27': null, 'BT-112': ['119.00'] }), 'nr1v', 'fehlt');
  check('checklist: correction of -12000 EUR is no Kleinbetragsrechnung', vat.checklist(inv({ 'BT-112': ['-12000.00'] })).kleinbetrag === false);
  check('checklist: -50 EUR (|Gesamtbetrag| ≤ 250) is a Kleinbetragsrechnung', vat.checklist(inv({ 'BT-112': ['-50.00'] })).kleinbetrag === true);
  check('checklist: 251 EUR is no Kleinbetragsrechnung', vat.checklist(inv({ 'BT-112': ['250.01'] })).kleinbetrag === false);
  check('checklist: 119 USD is no Kleinbetragsrechnung', vat.checklist(inv({ 'BT-112': ['119.00'], 'BT-5': ['USD'] })).kleinbetrag === false);
  check('checklist: 119 EUR reverse charge (§ 13b) is no Kleinbetragsrechnung', vat.checklist(inv({ 'BT-112': ['119.00'] }, { vat: [{ cat: 'AE', rate: '0', taxable: '119.00', tax: '0.00', reason: 'Steuerschuldnerschaft des Leistungsempfängers', reasonCode: 'VATEX-EU-AE' }] })).kleinbetrag === false);
}
// Kleinunternehmer (§ 34a UStDV)
{
  const ku = inv({ 'BT-1': null, 'BT-72': null, 'BT-110': ['0.00'], 'BT-112': ['1000.00'] }, { vat: [{ cat: 'E', rate: '0', taxable: '1000.00', tax: '0.00', reason: 'Kleinunternehmer gemäß § 19 UStG', reasonCode: '' }] });
  check('checklist: category E with § 19 UStG = Kleinunternehmer', vat.checklist(ku).kleinunternehmer === true);
  S('Kleinunternehmer: invoice number not required', ku, 'nr4', 'entfällt');
  S('Kleinunternehmer: time of supply not required', ku, 'nr6', 'entfällt');
  S('Kleinunternehmer: buyer still required', inv({ 'BT-44': null }, { vat: [{ cat: 'E', rate: '0', taxable: '1000.00', tax: '0.00', reason: 'Kleinunternehmer gemäß § 19 UStG', reasonCode: '' }] }), 'nr1e', 'fehlt');
}
// Nr. 2
S('only the tax representative VAT id', inv({ 'BT-31': null, 'BT-63': ['DE999999999'], 'BT-62': ['Fiskal GmbH'] }), 'nr2', 'prüfen');
S('neither VAT id nor tax number', inv({ 'BT-31': null }), 'nr2', 'fehlt');
S('only category O, no number', inv({ 'BT-31': null }, { vat: [{ cat: 'O', rate: '', taxable: '1000.00', tax: '0.00', reason: 'Nicht steuerbar', reasonCode: 'VATEX-EU-O' }] }), 'nr2', 'prüfen');
S('tax number instead of VAT id', inv({ 'BT-31': null, 'BT-32': ['27/123/45678'] }), 'nr2', 'vorhanden');
// Nr. 3, 4, 5
S('issue date missing', inv({ 'BT-2': null }), 'nr3', 'fehlt');
S('invoice number missing', inv({ 'BT-1': null }), 'nr4', 'fehlt');
S('no invoice line', inv({}, { lines: [] }), 'nr5', 'fehlt');
S('line without quantity', inv({}, { lines: [Object.assign({}, LINE, { qty: '' })] }), 'nr5', 'fehlt');
// Nr. 6
S('delivery date', inv(), 'nr6', 'vorhanden');
S('invoicing period', inv({ 'BT-72': null, 'BT-73': ['2026-09-01'], 'BT-74': ['2026-09-30'] }), 'nr6', 'vorhanden');
S('period in every line', inv({ 'BT-72': null }, { lines: [Object.assign({}, LINE, { period: '2026-09-01', periodEnd: '2026-09-30' })] }), 'nr6', 'vorhanden');
S('no time of supply (BFH XI R 62/07 vs. V R 18/17)', inv({ 'BT-72': null }), 'nr6', 'prüfen');
S('only BT-7 (VAT point date) on a normal invoice', inv({ 'BT-72': null, 'BT-7': ['2026-09-30'] }), 'nr6', 'prüfen');
S('only BT-8 (code) – no date', inv({ 'BT-72': null, 'BT-8': ['3'] }), 'nr6', 'prüfen');
S('advance payment invoice with BT-7 (Vereinnahmung)', inv({ 'BT-72': null, 'BT-3': ['386'], 'BT-7': ['2026-09-15'] }), 'nr6', 'vorhanden');
// Nr. 6a
S('invoice of 2026: not yet in force', inv(), 'nr6a', 'nicht zutreffend');
S('invoice of 2028 with the note', inv({ 'BT-2': ['2028-02-01'], 'BT-22': ['Versteuerung nach vereinnahmten Entgelten'] }), 'nr6a', 'vorhanden');
S('invoice of 2028 with BT-8 "paid to date" (UBL 432) without the note', inv({ 'BT-2': ['2028-02-01'], 'BT-8': ['432'] }), 'nr6a', 'prüfen');
S('invoice of 2028 with BT-8 "paid to date" (CII 72) without the note', inv({ 'BT-2': ['2028-02-01'], 'BT-8': ['72'] }), 'nr6a', 'prüfen');
S('invoice of 2028 without any indication', inv({ 'BT-2': ['2028-02-01'] }), 'nr6a', 'nicht zutreffend');
// Nr. 7, 8
S('no VAT breakdown', inv({}, { vat: [] }), 'nr7', 'fehlt');
check('checklist nr7: late-payment interest (VERZUG) is not shown as Skonto', !JSON.stringify(vat.checklist(inv({}, { skonto: [{ type: 'VERZUG', days: '30', percent: '5.00', base: null }] })).items.find((i) => i.id === 'nr7').werte).includes('Skonto'));
check('checklist nr7: Skonto shown', JSON.stringify(vat.checklist(inv({}, { skonto: [{ type: 'SKONTO', days: '14', percent: '2.00', base: null }] })).items.find((i) => i.id === 'nr7').werte).includes('Skonto: 14 Tage 2.00 %'));
S('exemption without reason', inv({}, { vat: [{ cat: 'E', rate: '0', taxable: '1000.00', tax: '0.00', reason: '', reasonCode: '' }] }), 'nr8', 'fehlt');
S('standard rate without tax amount', inv({}, { vat: [Object.assign({}, VAT_S, { tax: '' })] }), 'nr8', 'fehlt');
S('invoice in USD without VAT in EUR (Art. 230 MwStSystRL)', inv({ 'BT-5': ['USD'] }), 'nr8', 'prüfen');
S('invoice in USD with VAT in EUR (BT-6, BT-111)', inv({ 'BT-5': ['USD'], 'BT-6': ['EUR'], 'BT-111': ['175.00'] }), 'nr8', 'vorhanden');
// Nr. 9, 10
S('no retention note', inv(), 'nr9', 'nicht zutreffend');
S('retention note present', inv({ 'BT-22': ['Der Leistungsempfänger ist verpflichtet, die Rechnung zwei Jahre aufzubewahren.'] }), 'nr9', 'vorhanden');
S('self-billed invoice 389 with "Gutschrift"', inv({ 'BT-3': ['389'], 'BT-22': ['Gutschrift'] }), 'nr10', 'vorhanden');
S('self-billed invoice 389 without "Gutschrift"', inv({ 'BT-3': ['389'] }), 'nr10', 'prüfen');
S('self-billed credit note 261 without "Gutschrift"', inv({ 'BT-3': ['261'] }), 'nr10', 'prüfen');
S('self-billed corrective invoice 471 without "Gutschrift"', inv({ 'BT-3': ['471'] }), 'nr10', 'prüfen');
S('credit note 381 without "Gutschrift"', inv({ 'BT-3': ['381'] }), 'nr10', 'nicht zutreffend');
S('credit note 381 with "Gutschrift"', inv({ 'BT-3': ['381'], 'BT-22': ['Gutschrift Nr. 5'] }), 'nr10', 'vorhanden');
S('type code missing', inv({ 'BT-3': null }), 'nr10', 'prüfen');
S('commercial invoice 380', inv(), 'nr10', 'nicht zutreffend');
// § 14 Abs. 5 Satz 2
S('paid amount (possible final invoice)', inv({ 'BT-113': ['500.00'] }), '14-5', 'prüfen');
S('final construction invoice 877', inv({ 'BT-3': ['877'] }), '14-5', 'prüfen');
S('paid amount 0', inv({ 'BT-113': ['0.00'] }), '14-5', 'nicht zutreffend');
// § 14a
const AE = { cat: 'AE', rate: '0', taxable: '1000.00', tax: '0.00', reason: 'Steuerschuldnerschaft des Leistungsempfängers', reasonCode: 'VATEX-EU-AE' };
const K = { cat: 'K', rate: '0', taxable: '1000.00', tax: '0.00', reason: 'Steuerfreie innergemeinschaftliche Lieferung', reasonCode: 'VATEX-EU-IC' };
S('no special case', inv(), '14a', 'nicht zutreffend');
S('reverse charge with hint (domestic § 13b)', inv({ 'BT-48': ['DE987654321'] }, { vat: [AE] }), '14a', 'vorhanden');
S('reverse charge without hint', inv({}, { vat: [Object.assign({}, AE, { reason: '', reasonCode: '' })] }), '14a', 'fehlt');
S('reverse charge, buyer in AT without VAT id', inv({ 'BT-55': ['AT'] }, { vat: [AE] }), '14a', 'prüfen');
S('intra-community supply complete', inv({ 'BT-48': ['FR12345678901'], 'BT-55': ['FR'] }, { vat: [K] }), '14a', 'vorhanden');
S('intra-community supply without buyer VAT id', inv({ 'BT-55': ['FR'] }, { vat: [K] }), '14a', 'fehlt');
S('intra-community supply with only the representative VAT id', inv({ 'BT-31': null, 'BT-63': ['DE999999999'], 'BT-62': ['Vertreter'], 'BT-48': ['FR12345678901'] }, { vat: [K] }), '14a', 'prüfen');
S('margin scheme (VATEX-EU-F)', inv({}, { vat: [{ cat: 'E', rate: '0', taxable: '1000.00', tax: '0.00', reason: 'Gebrauchtgegenstände/Sonderregelung', reasonCode: 'VATEX-EU-F' }] }), '14a', 'prüfen');
// § 22c
S('no tax representative', inv(), '22c', 'nicht zutreffend');
S('tax representative of a German seller', inv({ 'BT-62': ['Vertreter GmbH'], 'BT-63': ['DE999999999'] }), '22c', 'prüfen');
S('foreign seller, German fiscal representative complete', inv({ 'BT-40': ['CH'], 'BT-62': ['Fiskal GmbH'], 'BT-63': ['DE999999999'], 'BT-66': ['Hamburg'], 'BT-67': ['20095'], 'BT-69': ['DE'] }), '22c', 'prüfen');
S('foreign seller, German fiscal representative without address', inv({ 'BT-40': ['CH'], 'BT-62': ['Fiskal GmbH'], 'BT-63': ['DE999999999'], 'BT-69': ['DE'] }), '22c', 'fehlt');
S('foreign seller, representative for another member state', inv({ 'BT-40': ['CH'], 'BT-62': ['Fiscal SARL'], 'BT-63': ['FR12345678901'], 'BT-69': ['FR'] }), '22c', 'prüfen');
// § 31 Abs. 5 UStDV
S('corrected invoice 384 with reference', inv({ 'BT-3': ['384'], 'BT-25': ['R-2026-000'] }), '31-5', 'vorhanden');
S('corrected invoice 384 without reference', inv({ 'BT-3': ['384'] }), '31-5', 'prüfen');
S('credit note 381 with reference', inv({ 'BT-3': ['381'], 'BT-25': ['R-2026-000'] }), '31-5', 'vorhanden');
S('invoice 380 referring to earlier invoices (final invoice)', inv({ 'BT-25': ['A-1'] }), '31-5', 'nicht zutreffend');

// verdicts
const R = (o) => Object.assign({ kind: 'xml', xml: { encoding: 'UTF-8' }, syntax: 'UBL-Invoice', profile: { family: 'XRechnung', en16931: true }, legalStatus: 'e-invoice', allFindings: [], processingErrors: [], missingRuleSets: [], model: inv() }, o);
const err = (id, klasse, angaben, source) => ({ source: source || 'schematron', level: 'error', id, text: '', ust: { klasse, basis: 'meldung', bt: [], angaben: angaben || [] } });
const V = (name, r, expected, test) => { const v = vat.verdict(r); check('verdict ' + expected + ': ' + name, v.id === expected && (!test || test(v)), 'got ' + v.id + ' ' + v.kurz); };
V('PDF without invoice XML', R({ kind: 'pdf', xml: null, syntax: undefined, model: null }), 'keine-xml', (v) => v.hinweise.includes(legal.hinweise.uebergang));
V('ZIP archive (not unpacked)', R({ kind: 'zip', xml: null, model: null }), 'nicht-pruefbar');
V('XML of another format', R({ syntax: null, model: null }), 'nicht-pruefbar');
V('unknown specification identifier', R({ profile: { family: 'unknown', en16931: false }, legalStatus: 'not-e-invoice' }), 'nicht-pruefbar');
V('not well-formed', R({ xml: { encoding: 'UTF-8', parseError: 'x' }, syntax: undefined, model: null }), 'format');
V('XML Schema error', R({ allFindings: [err('cvc-x', 'format', [], 'xsd')], schematronSkipped: 'xsd-invalid' }), 'format');
V('XRechnung not UTF-8 (tool assessment)', R({ allFindings: [err('XR-ENCODING', 'format', [], 'encoding')] }), 'format', (v) => v.hinweise.includes(legal.hinweise.kodierung));
V('ZUGFeRD MINIMUM', R({ profile: { family: 'ZUGFeRD', en16931: false }, legalStatus: 'not-e-invoice' }), 'kein-profil');
V('ZUGFeRD 1.0', R({ syntax: 'CII-ZUGFeRD1', profile: { family: 'ZUGFeRD1', en16931: false } }), 'kein-profil');
V('error on a Pflichtangabe', R({ allFindings: [err('BR-02', 'pflicht', ['nr4'])] }), 'pflicht', (v) => v.angaben.some((a) => a.id === 'nr4'));
V('undetermined error', R({ allFindings: [err('X', 'unbestimmt')] }), 'pflicht');
V('only VAT-irrelevant errors', R({ allFindings: [err('BR-DE-15', 'ohne-bezug')] }), 'technisch');
V('no errors', R({}), 'ok');
V('no errors, an item to check', R({ model: inv({ 'BT-72': null }) }), 'ok', (v) => v.text.includes(legal.urteile.ok.zusatzPruefen) && v.zuPruefen.includes('nr6'));
V('no errors, a Pflichtangabe missing in the structured part', R({ model: inv({ 'BT-31': null }) }), 'luecke', (v) => v.angaben.some((a) => a.id === 'nr2'));
V('technical errors and a missing Pflichtangabe', R({ allFindings: [err('BR-DE-15', 'ohne-bezug')], model: inv({ 'BT-31': null }) }), 'luecke', (v) => v.text.includes(legal.urteile.luecke.zusatzTechnisch));
V('missing rule set', R({ missingRuleSets: [{ id: 'PEPPOL-UBL' }] }), 'unvollstaendig');
V('warnings only', R({ allFindings: [Object.assign(err('BR-DE-TMP-32', 'pflicht', ['nr6']), { level: 'warning' })] }), 'ok');
V('reverse charge: hint on § 15 Abs. 1 Satz 1 Nr. 4', R({ allFindings: [err('BR-02', 'pflicht', ['nr4'])], model: inv({ 'BT-48': ['DE987654321'] }, { vat: [AE] }) }), 'pflicht', (v) => v.hinweise.includes(legal.hinweise.reverseCharge));
V('foreign seller: hint', R({ model: inv({ 'BT-40': ['FR'] }) }), 'ok', (v) => v.hinweise.includes(legal.hinweise.ausland));
V('foreign buyer: hint', R({ model: inv({ 'BT-55': ['AT'] }) }), 'ok', (v) => v.hinweise.includes(legal.hinweise.kaeuferAusland));
V('hybrid invoice: hint', R({ kind: 'pdf' }), 'ok', (v) => v.hinweise.includes(legal.hinweise.hybrid));
V('Kleinbetrag: hint', R({ model: inv({ 'BT-112': ['119.00'] }) }), 'ok', (v) => v.hinweise.includes(legal.hinweise.kleinbetrag));

// ---------------------------------------------------------------------------------------------------------------
// 4. the corpus
// ---------------------------------------------------------------------------------------------------------------
let corpusLine = 'corpus: not run (--no-corpus)';
(async () => {
  if (!args.includes('--no-corpus')) {
    const env = createEnv({ exclude: /^PEPPOL-/ });
    const dirs = (opt('--corpus-dirs') || 'xr-ubl,xr-cii,extra-ubl,extra-cii,zugferd-ubl,zugferd-cii,cen-ubl,cen-cii,encoding').split(',');
    const klassen = {}, urteile = {}, bases = {};
    let docs = 0, findings = 0;
    for (const d of dirs) {
      const dir = path.join(root, 'build', 'corpus', d);
      if (!fs.existsSync(dir)) { check('corpus: directory ' + d, false, 'missing (node test/build-corpus.cjs)'); continue; }
      for (const f of fs.readdirSync(dir).sort()) {
        const r = await PrueferCore.analyzeBytes(env, new Uint8Array(fs.readFileSync(path.join(dir, f))), f);
        docs++;
        const where = d + '/' + f;
        if (!r.ust) { check('corpus: verdict for ' + where, false); continue; }
        urteile[r.ust.id] = (urteile[r.ust.id] || 0) + 1;
        const errors = r.allFindings.filter((x) => x.level === 'error');
        for (const x of r.allFindings) {
          findings++;
          if (!x.ust) { check('corpus: classification of ' + x.id + ' in ' + where, false); continue; }
          klassen[x.ust.klasse] = (klassen[x.ust.klasse] || 0) + 1;
          bases[x.ust.basis] = (bases[x.ust.basis] || 0) + 1;
          const expectFormat = x.source === 'xsd' || x.source === 'encoding', expectContainer = x.source === 'pdf';
          if (expectFormat !== (x.ust.klasse === 'format') || expectContainer !== (x.ust.klasse === 'container')) check('corpus: class of ' + x.id + ' (' + x.source + ') in ' + where, false, x.ust.klasse);
          if (x.ust.klasse === 'pflicht' && !(x.ust.angaben.length && x.ust.angaben.every((a) => angabeIds.has(a)))) check('corpus: Angaben of ' + x.id + ' in ' + where, false, JSON.stringify(x.ust.angaben));
        }
        const cls = (k) => errors.filter((x) => x.ust && x.ust.klasse === k).length;
        const liste = r.ust.pflichtangaben;
        const ok = {
          ok: () => errors.length === 0 && !(liste && liste.items.some((i) => i.status === 'fehlt')),
          technisch: () => errors.length > 0 && !cls('pflicht') && !cls('unbestimmt') && !cls('format') && !(liste && liste.items.some((i) => i.status === 'fehlt')),
          pflicht: () => cls('pflicht') + cls('unbestimmt') > 0 && !cls('format'),
          luecke: () => !cls('pflicht') && !cls('unbestimmt') && !cls('format') && liste && liste.items.some((i) => i.status === 'fehlt'),
          format: () => cls('format') > 0 || r.schematronSkipped === 'xsd-invalid' || !!(r.xml && r.xml.parseError),
          'kein-profil': () => r.legalStatus === 'not-e-invoice' || r.syntax === 'CII-ZUGFeRD1',
          'nicht-pruefbar': () => r.kind === 'zip' || !r.syntax || (r.profile && r.profile.family === 'unknown'),
          'keine-xml': () => !r.xml,
          unvollstaendig: () => (r.processingErrors || []).length + (r.missingRuleSets || []).length > 0,
        }[r.ust.id];
        if (!ok || !ok()) check('corpus: verdict ' + r.ust.id + ' consistent for ' + where, false, 'errors ' + errors.length + ', classes ' + JSON.stringify({ pflicht: cls('pflicht'), unbestimmt: cls('unbestimmt'), format: cls('format') }));
        else pass++;
      }
    }
    corpusLine = 'corpus: ' + docs + ' documents, ' + findings + ' findings classified (' + Object.entries(klassen).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') + '; basis ' + Object.entries(bases).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') + '), verdicts ' + Object.entries(urteile).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ');
  }
  for (const f of failures.slice(0, 60)) console.log('FAIL ' + f);
  if (failures.length > 60) console.log('… ' + (failures.length - 60) + ' more');
  console.log(corpusLine);
  if (peppolUnchecked) console.log('note: ' + peppolUnchecked + ' Peppol rule overrides not checked against the rule sets (build/schemas/PEPPOL-*.json not compiled here)');
  console.log('VAT relevance tests: ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (legal table, classification, checklist, verdicts' + (args.includes('--no-corpus') ? '' : ', corpus') + ')');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
