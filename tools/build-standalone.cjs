#!/usr/bin/env node
/*
 * build-standalone.cjs — assembles the single-file application dist/E-Rechnung-Pruefer.html
 * (everything inlined: engine, rule sets, XML Schema models, UI) and writes dist/BUILD_INFO.json.
 *
 * Embedded: every rule set of build/schemas/ EXCEPT those whose licence does not allow redistribution
 * (PEPPOL-*: OpenPeppol, no licence; the user loads the official files in the app, see
 * docs/RULESETS.md), every XSD model of build/xsd/, build/scenarios.json, build/rulesets.json, the
 * copyright notices of legal/ and NOTICE, and the verification fingerprint (tools/fingerprint.cjs:
 * the version axis — which inputs the published test results belong to).
 *
 * Security (docs/SICHERHEIT.md): the Content-Security-Policy of the page allows exactly the inline scripts and the
 * style of the page – their SHA-256 hashes are computed here after assembling – and enforces Trusted Types; the build
 * note is a JSON data block (not executed), so the policy and the program (programSha256) do not depend on it.
 * Also written: the static pages of the site and security.txt (tools/build-site-pages.cjs, dist/site-pages/).
 *
 * Usage: node build-standalone.cjs [--version 0.2.0]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const vi = args.indexOf('--version');
const VERSION = vi >= 0 ? args[vi + 1] : '0.2.0';
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const NOT_REDISTRIBUTABLE = /^PEPPOL-/;
const { execFileSync } = require('child_process');
const sitePages = require('./build-site-pages.cjs');

// engine bundle: built by tools/build-engine.sh from the patched fontoxpath checkout
const fx = read('vendor/fontoxpath.iife.min.js');

// rule sets, XSD models, routing tables
const schemas = {};
for (const f of fs.readdirSync(path.join(root, 'build', 'schemas')).filter((x) => x.endsWith('.json')).sort()) {
  const id = f.replace(/\.json$/, '');
  if (NOT_REDISTRIBUTABLE.test(id)) continue;
  schemas[id] = JSON.parse(read('build/schemas/' + f));
}
const xsd = {};
for (const f of fs.readdirSync(path.join(root, 'build', 'xsd')).filter((x) => x.endsWith('.json')).sort()) xsd[f.replace(/\.json$/, '')] = JSON.parse(read('build/xsd/' + f));
const scenarios = JSON.parse(read('build/scenarios.json'));
const rulesets = JSON.parse(read('build/rulesets.json'));
// umsatzsteuerliche Einordnung: legal table + syntax binding (only the parts the program uses)
const vatLegal = JSON.parse(read('legal/ust-pflichtangaben.json'));
/** the dates of the BMF letters among the sources of the legal table: '15.10.2024, 15.10.2025 und 15.10.2026' */
function vatLetters(legal) {
  const dates = legal.quellen.map((q) => (/^BMF-Schreiben vom (\d{2}\.\d{2}\.\d{4})/.exec(q.titel) || [])[1]).filter(Boolean);
  if (!dates.length) throw new Error('legal/ust-pflichtangaben.json: no BMF letter among the sources');
  return dates.length === 1 ? dates[0] : dates.slice(0, -1).join(', ') + ' und ' + dates[dates.length - 1];
}
const btPaths = JSON.parse(read('build/bt-paths.json'));
const vat = { legal: vatLegal, paths: { syntax: btPaths.syntax, groups: btPaths.groups } };
const manifest = JSON.parse(read('build/STANDARDS_MANIFEST.json'));

function safeJson(obj) {
  // JSON inside <script>: the '<' of "</", "<!--" and "<script" as \u003c (nothing the HTML parser reads as the end of the
  // element or as a nested script; HTML Living Standard, "Restrictions for contents of script elements") and U+2028/2029
  // escaped; the values are unchanged
  return JSON.stringify(obj).replace(/<(?=\/|!--|script)/gi, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function safeJs(code, name) {
  // inside a script element the HTML parser ends the element at "</script", and after "<!--" it treats "<script" followed
  // by white space, "/" or ">" as a nested script whose end does not end the element (HTML Living Standard,
  // "Restrictions for contents of script elements"): neither may occur in embedded code
  if (/<\/script/i.test(code)) throw new Error(name + ' contains </script');
  if (/<script[\s/>]/i.test(code)) throw new Error(name + ' contains <script');
  return code;
}

const src = (prefix) => { const k = Object.keys(manifest.sources).find((x) => x.startsWith(prefix)); return k ? manifest.sources[k] : {}; };
const cen = src('CEN eInvoicing-EN16931'), xr = src('KoSIT xrechnung-schematron'), cfg = src('KoSIT validator-configuration'), pep = src('OpenPeppol peppol-bis-invoice-3');
const mus = src('Mustangproject'), ubl = src('OASIS UBL 2.1'), cii = src('UN/CEFACT CII D16B'), xrv = src('KoSIT xrechnung-visualization');
const c8 = (s) => (s && s.commit ? s.commit.slice(0, 8) : '?');

// verification fingerprint: the inputs of the published test results (build/reports/VERIFICATION.json)
function notRunReason(list) {
  const browsers = [...new Set(list.map((x) => (/browser (\w+)/.exec(x.reason || '') || [])[1]).filter(Boolean))];
  return browsers.length === list.length || list.every((x) => /browser \w+ not installed/.test(x.reason || ''))
    ? 'Browser ' + browsers.map((b) => ({ webkit: 'WebKit', firefox: 'Firefox', chromium: 'Chromium' })[b] || b).join(', ') + ' nicht installiert'
    : 'Gründe in VERIFICATION.json';
}
let fingerprint = null, verification = null;
try {
  const { compute } = require('./fingerprint.cjs');
  const current = compute();
  fingerprint = current.id;
  const vf = path.join(root, 'build', 'reports', 'VERIFICATION.json');
  if (fs.existsSync(vf)) {
    const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
    const suites = Object.values(v.suites);
    // the report belongs to this build when the file inputs are identical (filesId); the toolchain it ran
    // with (Node, Java, browsers) is the one recorded in the report, not the one of this build machine
    const same = v.fingerprint && (v.fingerprint.id === current.id || (v.fingerprint.filesId && v.fingerprint.filesId === current.filesId));
    if (same) {
      const pass = suites.filter((x) => x.status === 'pass').length;
      const failed = suites.filter((x) => x.status !== 'pass' && x.status !== 'not-run').length;
      const notRun = suites.filter((x) => x.status === 'not-run');
      verification = pass + ' von ' + suites.length + ' Testreihen bestanden, ' + failed + ' fehlgeschlagen' +
        (notRun.length ? ', ' + notRun.length + ' nicht gelaufen (' + notRunReason(notRun) + ')' : '') +
        ' – ' + (!v.environment || v.environment === 'local' ? 'lokal' : v.environment.replace(' run ', ' Lauf ')) + ', ' + v.generated.slice(0, 10);
      fingerprint = v.fingerprint.id;
    } else {
      verification = 'Testergebnisse gehören zu einem anderen Stand – vor Veröffentlichung tools/verify-all.cjs ausführen';
    }
  }
} catch (e) { verification = 'Fingerprint nicht berechenbar: ' + e.message; }

const peppolFiles = (pep.files || []);
const importable = {};
// SHA-256 of the rule sets compiled from the official files (tools/importable-hashes.cjs): integrity of stored rule sets
const importableHashes = JSON.parse(read('build/importable.json')).ruleSets;
for (const [id, base] of [['PEPPOL-UBL', 'PEPPOL-EN16931-UBL.sch'], ['PEPPOL-CII', 'PEPPOL-EN16931-CII.sch']]) {
  const f = peppolFiles.find((x) => x.file.endsWith(base));
  const hashes = importableHashes[id] || {};
  if (!f || hashes.sourceSha256 !== f.sha256) throw new Error('build/importable.json does not belong to the Peppol files of the manifest (' + id + '): node tools/importable-hashes.cjs');
  importable[id] = { file: base, title: 'Peppol BIS Billing 3.0 (' + (id.endsWith('UBL') ? 'UBL' : 'CII') + ')', version: '3.0.21, Commit ' + c8(pep), sha256: f.sha256, compiledSha256: hashes.compiledSha256, source: 'https://docs.peppol.eu/poacc/billing/3.0/ bzw. github.com/OpenPEPPOL/peppol-bis-invoice-3 (rules/sch/' + base + ')' };
}
// the commit of the sources (identification of the build, Anhang II Nr. 3 CRA); not part of the program
let commit = process.env.GITHUB_SHA || null, commitDate = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || commit;
  commitDate = execFileSync('git', ['log', '-1', '--format=%cI', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
} catch (e) { /* not a git checkout */ }

const build = {
  name: 'E-Rechnung Prüfer',
  version: VERSION,
  date: new Date().toISOString().slice(0, 10),
  commit,
  commitDate,
  fontoxpath: '3.34.0 (aus dem Quelltext, mit Prüfer-Patch)',
  fingerprint,
  verification,
  standards: [
    { name: 'EN 16931 – CEN-Schematron', version: '1.3.16', detail: 'UBL 2.1 und CII D16B, Codelisten; Commit ' + c8(cen), licence: 'EUPL-1.2', sha256: schemas['EN16931-UBL'].sources[0].sha256 },
    { name: 'XRechnung-Schematron (KoSIT)', version: scenarios.properties['xr.schematron.version.full'] + ' (XRechnung ' + scenarios.properties['xrechnung.version'] + ')', detail: 'inkl. der von der KoSIT übernommenen Peppol-Regeln; Commit ' + c8(xr), licence: 'Apache-2.0', sha256: (xr.merged && xr.merged[0] && xr.merged[0].sha256) || null },
    { name: 'KoSIT Validator-Konfiguration XRechnung', version: scenarios.properties['validator.configuration.version.full'], detail: 'Szenarien, XML-Schemata, Fehlerstufen (customLevel), Bewertung; Commit ' + c8(cfg), licence: 'Apache-2.0', sha256: scenarios.source.sha256 },
    { name: 'Factur-X / ZUGFeRD', version: 'Factur-X 1.09.2 / ZUGFeRD 2.5.2', detail: 'Profile MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED: Schematron, Codelisten, XML-Schemata (FNFE-MPE / FeRD, über Mustangproject Commit ' + c8(mus) + ')', licence: 'Apache-2.0 (FeRD: technische Artefakte)', sha256: schemas['FACTUR-X-EN16931'] ? schemas['FACTUR-X-EN16931'].sources[0].sha256 : null },
    { name: 'OASIS UBL 2.1 – XML-Schemata', version: 'os-UBL-2.1 (2013-11-04)', detail: 'Variante xsdrt wie im KoSIT-Build; über phax/ph-ubl Commit ' + c8(ubl), licence: 'OASIS-Hinweis (siehe Lizenzen)', sha256: xsd['UBL-Invoice-2.1'] ? xsd['UBL-Invoice-2.1'].sources[0].sha256 : null },
    { name: 'UN/CEFACT Cross Industry Invoice – XML-Schemata', version: 'D16B (100pD16B, „uncoupled“)', detail: 'über phax/ph-cii Commit ' + c8(cii), licence: 'UN/CEFACT-Hinweis (siehe Lizenzen)', sha256: xsd['CII-D16B'] ? xsd['CII-D16B'].sources[0].sha256 : null },
    { name: 'Peppol BIS Billing 3.0 (vollständig)', version: '3.0.21', detail: 'nicht eingebettet (keine Weitergabelizenz) – vom Benutzer zu laden; geprüfte Fassung: Commit ' + c8(pep), licence: 'OpenPeppol AISBL', sha256: importable['PEPPOL-UBL'].sha256 },
    { name: 'KoSIT XRechnung-Visualisierung – Syntaxbindung der Geschäftsbegriffe', version: xrv.describe || c8(xrv), detail: 'Pfad jedes BT/BG in UBL und CII, abgeleitet aus den KoSIT-Stylesheets über den Testkorpus (build/bt-paths.json); Commit ' + c8(xrv), licence: 'Apache-2.0', sha256: sha(read('build/bt-paths.json')) },
    { name: 'Umsatzsteuerliche Einordnung (Deutschland)', version: 'Stand ' + vatLegal.stand, detail: '§§ 14, 14a, 15, 22c UStG; §§ 31, 33, 34a UStDV; BMF-Schreiben vom ' + vatLetters(vatLegal) + '; Zuordnungstabelle KoSIT/FeRD (legal/ust-pflichtangaben.json, docs/UST-EINORDNUNG.md)', licence: 'EUPL-1.2', sha256: sha(read('legal/ust-pflichtangaben.json')) },
  ],
  importable,
  schemas: Object.fromEntries(Object.keys(schemas).map((id) => [id, { stats: schemas[id].stats, sources: schemas[id].sources }])),
  manifestSha256: sha(read('build/STANDARDS_MANIFEST.json')),
};

// licence texts shown in the app
const notices = [
  { title: 'E-Rechnung Prüfer – NOTICE (Drittkomponenten)', text: read('NOTICE') },
  { title: 'OASIS UBL 2.1 – Hinweise (Notices)', text: read('legal/OASIS-NOTICE.txt') },
  { title: 'UN/CEFACT Cross Industry Invoice D16B – Copyright', text: read('legal/UNCEFACT-NOTICE.txt') },
  { title: 'Factur-X / ZUGFeRD (FNFE-MPE / FeRD) – Nutzungsrechte', text: read('legal/FERD-FACTURX-NOTICE.txt') },
  { title: 'Lizenz des E-Rechnung Prüfers (EUPL-1.2)', text: read('LICENSE') },
];

// provider identification (legal/impressum.json) and privacy notice (legal/datenschutz.txt: paragraphs separated by
// blank lines, the first one is the title, {{Verantwortlicher}} = name, address and e-mail of the provider);
// both are shown only when the provider has filled in legal/impressum.json
let impressumHtml = '';
const imp = JSON.parse(read('legal/impressum.json'));
if (imp.name) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = ['Medieninhaber: ' + imp.name, imp.address ? 'Wohnort: ' + imp.address : '', imp.email ? 'E-Mail: ' + imp.email : '', imp.phone ? 'Telefon: ' + imp.phone : '', imp.uid ? 'UID: ' + imp.uid : '', imp.business, imp.authority ? 'Aufsichtsbehörde: ' + imp.authority : '', imp.chamber, imp.mediaOwnerPurpose ? 'Grundlegende Richtung (§ 25 MedienG): ' + imp.mediaOwnerPurpose : ''].filter(Boolean);
  impressumHtml = '<br><details class="impressum"><summary>Impressum / Offenlegung</summary><p>' + lines.map(esc).join('<br>') + '</p></details>';
  const controller = [imp.name, imp.address, imp.email ? 'E-Mail: ' + imp.email : ''].filter(Boolean).join(', ');
  const [title, ...paras] = read('legal/datenschutz.txt').replace(/\r\n/g, '\n').split(/\n[ \t]*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  impressumHtml += ' <details class="datenschutz"><summary>' + esc(title) + '</summary>' + paras.map((p) => '<p>' + esc(p.split('{{Verantwortlicher}}').join(controller)) + '</p>').join('') + '</details>';
}

// security data of the program (legal/security.json) and the section "Sicherheit, Unterstützung und Herstellerangaben"
// (docs/BENUTZERINFORMATION.md, the same text as the static page benutzerinformation/)
const security = JSON.parse(read('legal/security.json'));
const securityData = { product: security.product, manufacturer: security.manufacturer, contactEmail: security.contactEmail, reportForm: security.reportForm, site: security.site, releases: security.releases, supportEnd: security.supportEnd, securityContact: security.site + 'security-contact/', cvdPolicy: security.site + 'cvd-policy/' };
const securityInfoHtml = sitePages.renderMarkdown(read('docs/BENUTZERINFORMATION.md'), { headingOffset: 1, resolve: sitePages.resolver(security) }).replace(/^<h2[^>]*>.*?<\/h2>\n?/, '');
const footerLinks = [['security-contact/', 'Schwachstelle melden'], ['cvd-policy/', 'Richtlinie zur Offenlegung von Schwachstellen'], ['benutzerinformation/', 'Informationen für Nutzer'], ['impressum/', 'Impressum'], ['datenschutz/', 'Datenschutz']]
  .map(([p, t]) => '<a href="' + security.site + p + '" rel="noopener noreferrer">' + t + '</a>').join(' · ');

let html = read('src/index.template.html');
const parts = {
  '/*__CSS__*/': read('src/app.css'),
  '/*__XMLPARSE__*/': safeJs(read('src/xml-parse.js'), 'xml-parse.js'),
  '/*__FILESAFETY__*/': safeJs(read('src/file-safety.js'), 'file-safety.js'),
  '/*__SECURITYJSON__*/': safeJson(securityData),
  '__SECURITY_INFO__': securityInfoHtml,
  '__FOOTER_LINKS__': footerLinks,
  '/*__VENDOR_FONTOXPATH__*/': safeJs(fx, 'fontoxpath'),
  '/*__SCHEMATRON__*/': safeJs(read('src/schematron.js'), 'schematron.js'),
  '/*__PDF__*/': safeJs(read('src/pdf-embedded.js'), 'pdf-embedded.js'),
  '/*__MODEL__*/': safeJs(read('src/invoice-model.js'), 'invoice-model.js'),
  '/*__SHA256__*/': safeJs(read('src/sha256.js'), 'sha256.js'),
  '/*__ENCODING__*/': safeJs(read('src/xml-encoding.js'), 'xml-encoding.js'),
  '/*__XSD__*/': safeJs(read('src/xsd-validator.js'), 'xsd-validator.js'),
  '/*__PDFA3__*/': safeJs(read('src/pdfa3-checks.js'), 'pdfa3-checks.js'),
  '/*__SCHCOMPILER__*/': safeJs(read('src/sch-compiler.js'), 'sch-compiler.js'),
  '/*__VATJS__*/': safeJs(read('src/vat-relevance.js'), 'vat-relevance.js'),
  '/*__PDFFONTS__*/': safeJs(read('src/pdf-fonts.js'), 'pdf-fonts.js'),
  '/*__PDFWRITER__*/': safeJs(read('src/pdf-writer.js'), 'pdf-writer.js'),
  '/*__REPORTS__*/': safeJs(read('src/reports.js'), 'reports.js'),
  '/*__CORE__*/': safeJs(read('src/pruefer-core.js'), 'pruefer-core.js'),
  '/*__SCHEMAS__*/': safeJson(schemas),
  '/*__SCENARIOS__*/': safeJson(scenarios),
  '/*__RULESETS__*/': safeJson(rulesets),
  '/*__XSDMODELS__*/': safeJson(xsd),
  '/*__NOTICES__*/': safeJson(notices),
  '/*__VAT__*/': safeJson(vat),
  '/*__BUILD__*/': safeJson(build),
  '/*__APP__*/': safeJs(read('src/app.js'), 'app.js'),
  '__VERSION__': VERSION,
  '__RULES_DATE__': 'CEN 1.3.16 · XRechnung ' + scenarios.properties['xrechnung.version'] + ' (KoSIT ' + scenarios.properties['validator.configuration.version.full'] + ') · Factur-X 1.09.2 / ZUGFeRD 2.5.2',
  '__IMPRESSUM__': impressumHtml,
};
// the build note (window.PRUEFER_BUILD: version, date, fingerprint, verification status) is inserted last;
// programSha256 = SHA-256 of the page with the placeholder instead of the note, i.e. of the program itself.
// Two builds of the same sources have the same programSha256 on every machine and day (CI: the page tested in
// the job verify, the Windows build, the published page).
const BUILD_KEY = '/*__BUILD__*/';
for (const [k, v] of Object.entries(parts)) {
  if (!html.includes(k)) throw new Error('placeholder missing: ' + k);
  if (k !== BUILD_KEY && k !== '__CSP__') html = html.split(k).join(v);
}
// Content-Security-Policy: the SHA-256 of every inline script (data blocks of type application/json are not scripts)
// and of the inline style; nothing else may run or style the page, no connection, no form, no plug-in; Trusted Types
const scriptHashes = [], styleHashes = [];
const b64 = (t) => "'sha256-" + crypto.createHash('sha256').update(t, 'utf8').digest('base64') + "'";
// (case-insensitive, end tags with white space or attributes: as the HTML parser reads them; embedded code and JSON
// contain neither "<script" nor "</script" – safeJs, safeJson – so every start tag is one of the matched elements)
const scripts = Array.from(html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script[^>]*>/gi));
const styles = Array.from(html.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style[^>]*>/gi));
if ((html.match(/<script[\s>]/gi) || []).length !== scripts.length || (html.match(/<style[\s>]/gi) || []).length !== styles.length) throw new Error('script or style elements the Content-Security-Policy hashes cannot be determined for');
for (const m of scripts) {
  const attrs = m[1] || '';
  if (/^\s+type="application\/json"(\s+id="[a-z-]+")?\s*$/.test(attrs)) continue;
  if (attrs.trim()) throw new Error('inline script with attributes other than type="application/json": ' + attrs);
  scriptHashes.push(b64(m[2]));
}
for (const m of styles) {
  if ((m[1] || '').trim()) throw new Error('inline style element with attributes: ' + m[1]);
  styleHashes.push(b64(m[2]));
}
// the markup outside script and style elements: no style attribute, no event handler attribute
let markup = '', last = 0;
for (const m of scripts.concat(styles).sort((a, b) => a.index - b.index)) { markup += html.slice(last, m.index); last = m.index + m[0].length; }
markup += html.slice(last);
if (/\sstyle\s*=/i.test(markup) || /\son[a-z]+\s*=/i.test(markup)) throw new Error('inline style attribute or event handler attribute in the page (not allowed by the Content-Security-Policy)');
const CSP = "default-src 'none'; script-src " + scriptHashes.join(' ') + '; style-src ' + styleHashes.join(' ') + "; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types pruefer-xml";
html = html.split('__CSP__').join(CSP);
const programSha256 = sha(html);
html = html.split(BUILD_KEY).join(parts[BUILD_KEY]);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outFile = path.join(root, 'dist', 'E-Rechnung-Pruefer.html');
fs.writeFileSync(outFile, html);
const comps = {};
for (const f of ['src/xml-parse.js', 'vendor/fontoxpath.iife.min.js', 'src/file-safety.js', 'src/schematron.js', 'src/pdf-embedded.js', 'src/invoice-model.js', 'src/sha256.js', 'src/xml-encoding.js', 'src/xsd-validator.js', 'src/pdfa3-checks.js', 'src/sch-compiler.js', 'src/vat-relevance.js', 'src/pdf-fonts.js', 'src/pdf-writer.js', 'src/reports.js', 'src/pruefer-core.js', 'src/app.js', 'legal/ust-pflichtangaben.json', 'build/bt-paths.json']) comps[path.basename(f)] = { bytes: fs.statSync(path.join(root, f)).size, sha256: sha(read(f)) };
const info = Object.assign({}, build, { file: path.basename(outFile), bytes: Buffer.byteLength(html), sha256: sha(html), programSha256, contentSecurityPolicy: { scripts: scriptHashes.length, styles: styleHashes.length, policy: CSP.replace(/'sha256-[^']+'( 'sha256-[^']+')*/g, (x) => x.split(' ').length + ' SHA-256-Prüfsummen') }, embeddedRuleSets: Object.keys(schemas), embeddedXsdModels: Object.keys(xsd), components: comps });
fs.writeFileSync(path.join(root, 'dist', 'BUILD_INFO.json'), JSON.stringify(info, null, 2));
// software bill of materials of this page (CycloneDX 1.6, tools/make-sbom.cjs; published with the page and the release)
const sbomText = require('./make-sbom.cjs').makeSbom(info, JSON.parse(read('build/STANDARDS_MANIFEST.json')));
fs.writeFileSync(path.join(root, 'dist', 'sbom.cdx.json'), sbomText);
// assessment of the known vulnerabilities of its components (CycloneDX 1.6 VEX, a document of its own, BOM-Links to the SBOM)
const vexText = require('./make-vex.cjs').makeVex(sbomText, JSON.parse(read('security/vex.json')).statements);
fs.writeFileSync(path.join(root, 'dist', 'vex.cdx.json'), vexText);
// static pages of the site (no JavaScript) and security.txt
fs.rmSync(path.join(root, 'dist', 'site-pages'), { recursive: true, force: true });
const pages = sitePages.buildPages(path.join(root, 'dist', 'site-pages'), info);
console.log(`${outFile}: ${(info.bytes / 1024 / 1024).toFixed(2)} MB, SHA-256 ${info.sha256}, program SHA-256 ${programSha256}; rule sets ${Object.keys(schemas).join(', ')}; XSD ${Object.keys(xsd).join(', ')}; CSP ${scriptHashes.length} script and ${styleHashes.length} style hashes; SBOM ${JSON.parse(sbomText).components.length} components, VEX ${JSON.parse(vexText).vulnerabilities.length} statements; site pages ${Object.keys(pages).length}`);
