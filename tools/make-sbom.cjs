#!/usr/bin/env node
/*
 * make-sbom.cjs — the software bill of materials of the program (dist/E-Rechnung-Pruefer.html): CycloneDX 1.6 JSON,
 * dist/sbom.cdx.json, according to BSI TR-03183-2 v2.1.0 (2025-08-20) "Software Bill of Materials" and the NTIA
 * minimum elements; the SBOM of Annex I Part II No. 1 of Regulation (EU) 2024/2847. Called by
 * tools/build-standalone.cjs after the page is written; published with the page (job pages of verify.yml) and every release.
 *
 * Level of detail: "delivery item SBOM" (TR 8.3.4, the minimum of TR 5.1): every component of the scope of delivery
 * (everything inside the HTML file) fully described and resolved recursively, the first component outside the scope of
 * delivery – the web browser that runs the page – identified. Components:
 *   - the program (metadata.component): creator, name, version, file name, SHA-512 of the page (TR 5.2.2), licences
 *     (original = "declared", distribution = "concluded", effective = bsi:component:effectiveLicence), executable /
 *     archive / structured, source code URI, URIs of the deployable form (GitHub Pages, release asset), security.txt;
 *   - the first-party program files, embedded byte for byte as <script>/<style> elements (SHA-512 of each file);
 *   - the XPath engine bundle (vendor/fontoxpath.iife.min.js, embedded byte for byte) and the components built into
 *     it: fontoxpath and xspattern as modified by the Prüfer's patches (TR 8.1.8: the maintainer of a modified
 *     component becomes its creator; the upstream release is the pedigree ancestor with its purl), whynot, prsc,
 *     the esbuild helper code and the Unicode tables;
 *   - the rule sets, schemas and data compiled into the page (NOTICE part A), with the commit and the SHA-256 of
 *     every consumed source file (build/STANDARDS_MANIFEST.json);
 *   - the web browser (platform, outside the scope of delivery, identified: TR 5.1, 3.2.4).
 * Dependencies: the program contains every component; the module dependencies of the program files (from their
 * references to the globals of the other files), of the engine (package.json of the pinned commits) and the
 * derivations; completeness in "compositions" (complete for everything delivered, unknown for the browser).
 * No vulnerability information (TR 3.1): that is vex.cdx.json (tools/make-vex.cjs).
 * Deterministic: the same inputs give the same bytes (serial number from the page, timestamp = commit time).
 * Checked by test/run-sbom-tests.cjs (official CycloneDX 1.6 schema, BSI TR-03183-2 fields, NOTICE, manifest).
 *
 * Usage: node tools/make-sbom.cjs [--out dist/sbom.cdx.json]   (reads dist/BUILD_INFO.json)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const REPO = 'https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer';
const sha = (s, alg) => crypto.createHash(alg || 'sha256').update(s).digest('hex');
const readBytes = (f) => fs.readFileSync(path.join(root, f));

// ------------------------------------------------------------------------------------------------
// creators (TR 5.2.2 "Component creator": e-mail address, otherwise URL)
// ------------------------------------------------------------------------------------------------
const security = () => JSON.parse(fs.readFileSync(path.join(root, 'legal', 'security.json'), 'utf8'));
const OWN = () => { const s = security(); return { name: s.manufacturer, contact: [{ name: s.manufacturer, email: s.contactEmail }] }; };
const ORG = (name, url) => ({ name, url: [url] });
const CREATORS = {
  fontoxml: ORG('FontoXML (Fonto Group BV)', 'https://github.com/FontoXML/fontoxpath'),
  bwrrp: ORG('Stef Busking (bwrrp)', 'https://github.com/bwrrp'),
  whynot: { name: 'Stef Busking', contact: [{ name: 'Stef Busking', email: 'stef.busking@gmail.com' }] }, // package.json "author" of whynot 5.0.0
  esbuild: ORG('Evan Wallace (esbuild)', 'https://github.com/evanw/esbuild'),
  unicode: ORG('Unicode, Inc.', 'https://www.unicode.org/'),
  asf: ORG('The Apache Software Foundation (Apache Xerces)', 'https://xerces.apache.org/'),
  cen: ORG('CEN/TC 434 (European Committee for Standardization), maintained in ConnectingEurope/eInvoicing-EN16931', 'https://github.com/ConnectingEurope/eInvoicing-EN16931'),
  kosit: ORG('Koordinierungsstelle für IT-Standards (KoSIT)', 'https://github.com/itplr-kosit'),
  ferd: ORG('FNFE-MPE / FeRD (Forum elektronische Rechnung Deutschland)', 'https://www.ferd-net.de/'),
  oasis: ORG('OASIS Universal Business Language (UBL) TC', 'https://www.oasis-open.org/committees/ubl/'),
  uncefact: ORG('UN/CEFACT', 'https://unece.org/trade/uncefact'),
  adobe: ORG('Adobe Systems Incorporated', 'https://www.adobe.com/'),
  whatwg: ORG('WHATWG / Ecma International (TC39) – HTML Living Standard and ECMAScript', 'https://html.spec.whatwg.org/'),
};

// ------------------------------------------------------------------------------------------------
// first-party program files: embedded byte for byte (tools/build-standalone.cjs), in the order of the page
// ------------------------------------------------------------------------------------------------
const OWN_FILES = [
  ['src/app.css', 'style sheet of the page'],
  ['src/xml-parse.js', 'XML parsing (DOMParser, Trusted Types policy)'],
  ['src/schematron.js', 'Schematron runner (ISO 19757-3 on fontoxpath)'],
  ['src/pdf-embedded.js', 'PDF reader for embedded files and XMP (ZUGFeRD / Factur-X)'],
  ['src/invoice-model.js', 'invoice data model (EN 16931 business terms)'],
  ['src/sha256.js', 'SHA-256 (FIPS 180-4)'],
  ['src/xml-encoding.js', 'character encoding detection (XML 1.0 §4.3.3)'],
  ['src/xsd-validator.js', 'XML Schema 1.0 validator (verdicts identical to the JDK 21 Xerces)'],
  ['src/pdfa3-checks.js', 'PDF/A-3 and ZUGFeRD / Factur-X container checks, active content'],
  ['src/sch-compiler.js', 'Schematron compiler (rule sets loaded by the user)'],
  ['src/vat-relevance.js', 'umsatzsteuerliche Einordnung (VAT relevance of findings, Germany)'],
  ['src/pdf-fonts.js', 'character widths of the PDF standard fonts (from the Adobe Core14 AFM files)'],
  ['src/pdf-writer.js', 'PDF writer (Prüfprotokoll, Lesefassung)'],
  ['src/file-safety.js', 'classification of downloadable files, safe file names'],
  ['src/reports.js', 'reports: CSV, JSON, PDF'],
  ['src/pruefer-core.js', 'check pipeline (KoSIT scenarios, XSD, Schematron)'],
  ['src/app.js', 'user interface'],
];
// the global name each program file defines (its references in other files are its dependants)
const GLOBALS = { 'src/xml-parse.js': 'PrueferXml', 'src/file-safety.js': 'FileSafety', 'src/sha256.js': 'Sha256', 'src/xml-encoding.js': 'XmlEncoding', 'src/pdf-embedded.js': 'PdfEmbedded', 'src/pdfa3-checks.js': 'PdfA3Checks', 'src/pdf-fonts.js': 'PdfFonts', 'src/pdf-writer.js': 'PdfWriter', 'src/reports.js': 'Reports', 'src/invoice-model.js': 'InvoiceModel', 'src/schematron.js': 'SchematronRunner', 'src/sch-compiler.js': 'SchCompiler', 'src/xsd-validator.js': 'XsdValidator', 'src/vat-relevance.js': 'VatRelevance', 'src/pruefer-core.js': 'PrueferCore' };
const ENGINE_FILE = 'vendor/fontoxpath.iife.min.js';

// ------------------------------------------------------------------------------------------------
// third-party components (NOTICE part A); `source` = key of build/STANDARDS_MANIFEST.json (repository, commit,
// consumed files), `repo` = path of a repository listed under a source
// ------------------------------------------------------------------------------------------------
const DATA = [
  { notice: 'A.1', ref: 'cen-en16931', source: 'CEN eInvoicing-EN16931 (validation artefacts 1.3.16)', creator: 'cen', name: 'eInvoicing-EN16931 validation artefacts (Schematron, code lists)', version: '1.3.16', licence: 'EUPL-1.2', compiled: ['build/schemas/EN16931-UBL.json', 'build/schemas/EN16931-CII.json'], modification: 'compiled from Schematron to JSON (tools/compile-sch.cjs); rules, tests and messages unchanged' },
  { notice: 'A.2', ref: 'kosit-xrechnung-schematron', source: 'KoSIT xrechnung-schematron (v2.6.0)', creator: 'kosit', name: 'xrechnung-schematron (XRechnung 3.0.2, with the Peppol rules merged by KoSIT)', version: '2.6.0', licence: 'Apache-2.0', compiled: ['build/schemas/XRechnung-UBL.json', 'build/schemas/XRechnung-CII.json'], modification: 'compiled to JSON; rules unchanged' },
  { notice: 'A.3', ref: 'kosit-validator-configuration', source: 'KoSIT validator-configuration-xrechnung (2026-08-31)', creator: 'kosit', name: 'validator-configuration-xrechnung (scenarios, XML schemas, levels, report logic)', version: '2026-08-31', licence: 'Apache-2.0', compiled: ['build/scenarios.json'], modification: 'scenarios compiled to JSON; the report logic of default-report.xsl re-implemented in src/pruefer-core.js' },
  { notice: 'A.4', ref: 'ferd-facturx', source: 'Mustangproject ("ZF_250" = Factur-X 1.09.2 / ZUGFeRD 2.5.2 Schematron, code DBs and XSDs)', creator: 'ferd', name: 'Factur-X / ZUGFeRD Schematron, code lists and XML schemas (ZF_250)', version: 'Factur-X 1.09.2 / ZUGFeRD 2.5.2', licence: 'Apache-2.0', compiled: ['build/schemas/FACTUR-X-MINIMUM.json', 'build/schemas/FACTUR-X-BASIC-WL.json', 'build/schemas/FACTUR-X-BASIC.json', 'build/schemas/FACTUR-X-EN16931.json', 'build/schemas/FACTUR-X-EXTENDED.json', 'build/xsd/FACTUR-X-MINIMUM.json', 'build/xsd/FACTUR-X-BASIC-WL.json', 'build/xsd/FACTUR-X-BASIC.json', 'build/xsd/FACTUR-X-EN16931.json', 'build/xsd/FACTUR-X-EXTENDED.json', 'build/rulesets.json'], modification: 'compiled to JSON; rules and schema content unchanged; the XML schemas derive from UN/CEFACT CII D16B (A.6)', derivedFrom: ['uncefact-cii-d16b'] },
  { notice: 'A.5', ref: 'oasis-ubl-21', source: 'OASIS UBL 2.1 (os-UBL-2.1, xsdrt; from phax/ph-ubl docs/UBL-2.1.zip) — XSD validation', creator: 'oasis', name: 'Universal Business Language 2.1 XML schemas (os-UBL-2.1, xsdrt)', version: 'os-UBL-2.1', licence: 'LicenseRef-scancode-oasis-ipr-2013', compiled: ['build/xsd/UBL-Invoice-2.1.json', 'build/xsd/UBL-CreditNote-2.1.json'], modification: 'compiled to validation models (tools/compile-xsd.cjs)' },
  { notice: 'A.6', ref: 'uncefact-cii-d16b', source: 'UN/CEFACT CII D16B (from phax/ph-cii) — XSD validation', creator: 'uncefact', name: 'Cross Industry Invoice D16B XML schemas (100pD16B, uncoupled)', version: 'D16B', licence: 'LicenseRef-scancode-un-cefact-2016', compiled: ['build/xsd/CII-D16B.json'], modification: 'compiled to a validation model' },
  { notice: 'A.11', ref: 'kosit-xrechnung-visualization', source: 'KoSIT xrechnung-visualization (v2026-08-31)', creator: 'kosit', name: 'xrechnung-visualization (syntax binding of the business terms)', version: '2026-08-31', licence: 'Apache-2.0', compiled: ['build/bt-paths.json'], modification: 'the path of every business term extracted into build/bt-paths.json (tools/build-bt-paths.cjs); the stylesheets are not contained' },
  { notice: 'A.12', ref: 'adobe-core14-afm', source: 'Adobe Core14 font metrics (AFM, via matplotlib v3.10.7) — widths for the PDF writer', creator: 'adobe', name: 'Core14 font metrics (AFM) of Helvetica, Helvetica-Bold and Courier', version: 'matplotlib v3.10.7', licence: 'APAFML', modification: 'character widths extracted into src/pdf-fonts.js (tools/gen-pdf-fonts.cjs), copyright notices retained' },
];
const LEGAL_TABLE = 'legal/ust-pflichtangaben.json';

/** pkg:github purl of a GitHub repository at a commit */
function githubPurl(remote, commit) {
  const m = /github\.com\/([^/]+)\/([^/.]+(?:\.[^/.]+)*?)(?:\.git)?$/.exec(remote || '');
  return m ? 'pkg:github/' + m[1].toLowerCase() + '/' + m[2].toLowerCase() + '@' + commit : null;
}
const repoUrl = (remote) => String(remote || '').replace(/\.git$/, '');
/** RFC 4122 name-based UUID (version 5 layout) from a SHA-256: deterministic serial number */
function uuidFrom(hex) {
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20, 32);
}
/** licences as BSI TR-03183-2 8.2 maps them: original = declared, distribution = concluded (CycloneDX 1.6). An SPDX
 * identifier goes into license.id; a licence without one (ScanCode LicenseDB identifier LicenseRef-scancode-…, as the TR
 * recommends) into license.name with the URL of its LicenseDB entry – license.id admits only the SPDX list */
const licences = (id) => ['declared', 'concluded'].map((acknowledgement) => ({ license: /^LicenseRef-scancode-/.test(id)
  ? { name: id, acknowledgement, url: 'https://scancode-licensedb.aboutcode.org/' + id.replace(/^LicenseRef-scancode-/, '') + '.html' }
  : { id, acknowledgement } }));
/** BSI properties (taxonomy BSI-Bund/tr-03183-cyclonedx-property-taxonomy v0.1.2) */
const bsi = (o) => [
  o.filename ? { name: 'bsi:component:filename', value: o.filename } : null,
  { name: 'bsi:component:executable', value: o.executable ? 'executable' : 'non-executable' },
  { name: 'bsi:component:archive', value: o.archive ? 'archive' : 'no archive' },
  { name: 'bsi:component:structured', value: o.structured ? 'structured' : 'unstructured' },
  { name: 'bsi:component:effectiveLicence', value: o.effective },
].filter(Boolean);
/** a module's source without its comment lines and trailing " // " comments (references to other modules, not
 * mentions in comments; a full tokenizer is not needed for the comment style of this repository: block comments start
 * their lines with /* or *, XPath expressions in strings contain /* and //, so these are not stripped inside lines) */
const code = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');

function makeSbom(info, manifest) {
  const sec = security();
  const own = OWN();
  const sources = manifest.sources;
  const commit = info.commit || null;
  const at = (f) => (commit ? REPO + '/blob/' + commit + '/' + f : REPO + '/blob/main/' + f);
  const rawAt = (f) => 'https://raw.githubusercontent.com/SerhiiAkhnazarov/e-rechnung-pruefer/' + (commit || 'main') + '/' + f;
  const srcOf = (key) => { const s = sources[key]; if (!s) throw new Error('make-sbom: source missing in the manifest: ' + key); return s; };
  const repoOf = (p) => { for (const s of Object.values(sources)) for (const r of s.repos || []) if (r.path === p) return r; throw new Error('make-sbom: repository missing in the manifest: ' + p); };
  const fontoxpath = srcOf('fontoxpath (XPath 3.1 engine, built from source + Prüfer patch: exact decimals, document index, path rewrites)');
  const xspattern = repoOf('xspattern.js'), whynot = repoOf('whynot.js'), prsc = repoOf('prsc.js');
  const fxPatch = 'patches/fontoxpath-pruefer.patch', xsPatch = 'patches/xspattern-pruefer.patch';
  const patchVersion = (base, p) => base + '+pruefer.' + sha(readBytes(p)).slice(0, 8);
  const sourceFiles = (s) => ((s.files || []).concat(s.merged || [])).map((f) => ({ name: 'e-rechnung-pruefer:source-file', value: f.file + ' sha256:' + f.sha256 })).concat(s.archive ? [{ name: 'e-rechnung-pruefer:source-archive', value: s.archive.file + ' sha256:' + s.archive.sha256 }] : []);
  const vcsRefs = (s) => (s && s.remote ? [{ type: 'vcs', url: repoUrl(s.remote) }, { type: 'source-distribution', url: repoUrl(s.remote) + '/tree/' + s.commit }] : []);
  const secTxt = { type: 'rfc-9116', url: sec.site + '.well-known/security.txt' };

  const components = [];
  const deps = new Map(); // bom-ref -> Set of bom-refs
  const dep = (from, to) => { if (!deps.has(from)) deps.set(from, new Set()); if (to) deps.get(from).add(to); };

  // ---- first-party program files ----
  const fileRef = (f) => 'file:' + f;
  for (const [f, desc] of OWN_FILES) {
    const bytes = readBytes(f);
    const c = {
      type: 'file', 'bom-ref': fileRef(f), manufacturer: own, name: path.basename(f), version: info.version, description: desc,
      hashes: [{ alg: 'SHA-512', content: sha(bytes, 'sha512') }, { alg: 'SHA-256', content: sha(bytes) }],
      licenses: licences('EUPL-1.2'),
      externalReferences: [{ type: 'distribution', url: rawAt(f), hashes: [{ alg: 'SHA-512', content: sha(bytes, 'sha512') }] }, { type: 'source-distribution', url: at(f) }, { type: 'vcs', url: REPO }, secTxt],
      properties: bsi({ filename: path.basename(f), executable: f.endsWith('.js'), archive: false, structured: false, effective: 'EUPL-1.2' }).concat([{ name: 'e-rechnung-pruefer:embedding', value: 'embedded byte for byte as a ' + (f.endsWith('.css') ? '<style>' : '<script>') + ' element of ' + info.file }]),
    };
    if (f === 'src/xsd-validator.js') {
      c.pedigree = { ancestors: [{ type: 'library', 'bom-ref': 'ancestor:xerces-j', manufacturer: CREATORS.asf, name: 'Apache Xerces-J (as contained in OpenJDK 21, module java.xml)', version: '2.12.2', licenses: licences('Apache-2.0'), purl: 'pkg:maven/xerces/xercesImpl@2.12.2', externalReferences: [{ type: 'website', url: 'https://xerces.apache.org/xerces2-j/' }, { type: 'vcs', url: 'https://github.com/openjdk/jdk21u' }] }],
        notes: 'NOTICE A.9: parts are JavaScript translations of, or follow closely, Xerces classes (impl.dv.xs.*DV, impl.dv.util.Base64, util.URI, util.XMLChar, impl.xs.models.CMBuilder, XSDFACM, impl.xs.XMLSchemaValidator). Only validation logic, no XML parser and no schema loading.' };
      c.properties.push({ name: 'e-rechnung-pruefer:notice', value: 'A.9' });
    }
    if (f === 'src/pdf-fonts.js') c.properties.push({ name: 'e-rechnung-pruefer:derived-data', value: 'A.12 (character widths of the Adobe Core14 AFM files)' });
    components.push(c);
  }
  // module dependencies (references to the globals of the other files; fontoxpath = the engine bundle)
  for (const [f] of OWN_FILES) {
    if (!f.endsWith('.js')) { dep(fileRef(f)); continue; }
    const text = code(fs.readFileSync(path.join(root, f), 'utf8'));
    dep(fileRef(f));
    for (const [g, name] of Object.entries(GLOBALS)) if (g !== f && new RegExp('\\b' + name + '\\b').test(text)) dep(fileRef(f), fileRef(g));
    // the engine: used by name or through the instance passed in (evaluateXPath… of fontoxpath's API)
    if (/\bfontoxpath\b|\.evaluateXPath\w*\(/.test(text)) dep(fileRef(f), 'engine-bundle');
  }
  dep(fileRef('src/pdf-fonts.js'), 'adobe-core14-afm');
  for (const d of DATA) dep(fileRef('src/app.js'), d.ref);
  dep(fileRef('src/app.js'), 'legal-vat-table');
  dep(fileRef('src/app.js'), fileRef('src/app.css'));

  // ---- the engine bundle and its components ----
  const engineBytes = readBytes(ENGINE_FILE);
  const fxVersion = patchVersion('3.34.0', fxPatch), xsVersion = patchVersion('3.1.0', xsPatch);
  components.push({
    type: 'library', 'bom-ref': 'engine-bundle', manufacturer: own, name: 'fontoxpath engine bundle (fontoxpath with xspattern, whynot, prsc)', version: fxVersion,
    description: 'built by tools/check-engine.sh from the pinned sources and the patches with esbuild 0.28.2; reproduced byte for byte in every CI run (suite engine-reproducible)',
    hashes: [{ alg: 'SHA-512', content: sha(engineBytes, 'sha512') }, { alg: 'SHA-256', content: sha(engineBytes) }],
    licenses: [{ license: { id: 'MIT', acknowledgement: 'declared' } }, { license: { id: 'MIT', acknowledgement: 'concluded' } }],
    externalReferences: [{ type: 'distribution', url: rawAt(ENGINE_FILE), hashes: [{ alg: 'SHA-512', content: sha(engineBytes, 'sha512') }] }, { type: 'source-distribution', url: at('tools/check-engine.sh') }, { type: 'vcs', url: REPO }, secTxt],
    properties: bsi({ filename: path.basename(ENGINE_FILE), executable: true, archive: false, structured: false, effective: 'MIT' }).concat([{ name: 'e-rechnung-pruefer:notice', value: 'A.7, A.8, A.10' }, { name: 'e-rechnung-pruefer:embedding', value: 'embedded byte for byte as a <script> element of ' + info.file }]),
  });
  const upstream = (ref, creator, name, version, purl, s) => ({ type: 'library', 'bom-ref': ref, manufacturer: creator, name, version, licenses: licences('MIT'), purl, externalReferences: vcsRefs(s) });
  const patched = (ref, name, version, up, patch, s, notice, note) => ({
    type: 'library', 'bom-ref': ref, manufacturer: own, name, version,
    description: 'modified by patches/' + path.basename(patch) + ' (TR-03183-2 8.1.8: the maintainer of a modified component is its creator); upstream: ' + up.name + ' ' + up.version,
    licenses: licences('MIT'),
    externalReferences: [{ type: 'source-distribution', url: at(patch) }].concat(vcsRefs(s)),
    pedigree: { ancestors: [up], commits: [{ uid: s.commit, url: repoUrl(s.remote) + '/commit/' + s.commit }], patches: [{ type: 'unofficial', diff: { url: at(patch) } }], notes: 'NOTICE ' + notice + '. ' + note },
    properties: bsi({ executable: true, archive: false, structured: false, effective: 'MIT' }).concat([{ name: 'e-rechnung-pruefer:notice', value: notice }, { name: 'e-rechnung-pruefer:patch', value: patch + ' sha256:' + sha(readBytes(patch)) }]),
  });
  components.push(patched('fontoxpath', 'fontoxpath', fxVersion, upstream('ancestor:fontoxpath', CREATORS.fontoxml, 'fontoxpath', '3.34.0', 'pkg:npm/fontoxpath@3.34.0', fontoxpath), fxPatch, fontoxpath, 'A.7', 'Built from upstream commit ' + fontoxpath.commit + ' (' + fontoxpath.describe + ', package.json version 3.34.0) with the patch: exact decimals, document index, path rewrites.'));
  components.push(patched('xspattern', 'xspattern', xsVersion, upstream('ancestor:xspattern', CREATORS.bwrrp, 'xspattern', '3.1.0', 'pkg:npm/xspattern@3.1.0', xspattern), xsPatch, xspattern, 'A.7', 'Built from upstream commit ' + xspattern.commit + ' (' + xspattern.describe + ', package.json version 3.1.0) with the patch: general category Cn (unassigned code points).'));
  for (const [ref, creator, s, version] of [['whynot', CREATORS.whynot, whynot, '5.0.0'], ['prsc', CREATORS.bwrrp, prsc, '4.0.0']]) {
    components.push({ type: 'library', 'bom-ref': ref, manufacturer: creator, name: ref, version, licenses: licences('MIT'), purl: 'pkg:npm/' + ref + '@' + version,
      externalReferences: vcsRefs(s), pedigree: { commits: [{ uid: s.commit, url: repoUrl(s.remote) + '/commit/' + s.commit }], notes: 'NOTICE A.7. Built from the commit of the release ' + version + ' (unchanged).' },
      properties: bsi({ executable: true, archive: false, structured: false, effective: 'MIT' }).concat([{ name: 'e-rechnung-pruefer:notice', value: 'A.7' }]) });
  }
  components.push({ type: 'library', 'bom-ref': 'esbuild-runtime', manufacturer: CREATORS.esbuild, name: 'esbuild (module wrapper and helper code in the bundle)', version: '0.28.2', licenses: licences('MIT'), purl: 'pkg:npm/esbuild@0.28.2',
    externalReferences: [{ type: 'vcs', url: 'https://github.com/evanw/esbuild' }, { type: 'source-distribution', url: 'https://github.com/evanw/esbuild/tree/v0.28.2' }],
    pedigree: { notes: 'NOTICE A.10. Inserted by the bundler into ' + ENGINE_FILE + '.' },
    properties: bsi({ executable: true, archive: false, structured: false, effective: 'MIT' }).concat([{ name: 'e-rechnung-pruefer:notice', value: 'A.10' }]) });
  components.push({ type: 'data', 'bom-ref': 'unicode-ucd', manufacturer: CREATORS.unicode, name: 'Unicode Character Database (general categories and blocks, packed into the tables of xspattern)', version: '15.0.0', licenses: licences('Unicode-3.0'),
    externalReferences: [{ type: 'website', url: 'https://www.unicode.org/Public/15.0.0/ucd/' }, { type: 'source-distribution', url: 'https://www.unicode.org/Public/15.0.0/ucd/' }],
    pedigree: { notes: 'NOTICE A.8. UnicodeData.txt and Blocks.txt packed by xspattern\'s scripts (SHA-256 of the packed tables checked by tools/check-engine.sh).' },
    properties: bsi({ executable: false, archive: false, structured: false, effective: 'Unicode-3.0' }).concat([{ name: 'e-rechnung-pruefer:notice', value: 'A.8' }]) });
  dep('engine-bundle', 'fontoxpath'); dep('engine-bundle', 'xspattern'); dep('engine-bundle', 'whynot'); dep('engine-bundle', 'prsc'); dep('engine-bundle', 'esbuild-runtime'); dep('engine-bundle', 'unicode-ucd');
  // package.json "dependencies" at the pinned commits: fontoxpath -> prsc, xspattern; xspattern -> whynot (+ the packed UCD tables)
  dep('fontoxpath', 'prsc'); dep('fontoxpath', 'xspattern'); dep('xspattern', 'whynot'); dep('xspattern', 'unicode-ucd');
  for (const r of ['whynot', 'prsc', 'esbuild-runtime', 'unicode-ucd']) dep(r);

  // ---- rule sets, schemas, data ----
  for (const d of DATA) {
    const s = srcOf(d.source);
    const props = bsi({ executable: false, archive: false, structured: false, effective: d.licence }).concat([{ name: 'e-rechnung-pruefer:notice', value: d.notice }])
      .concat((d.compiled || []).map((f) => ({ name: 'e-rechnung-pruefer:compiled-file', value: f + ' sha256:' + sha(readBytes(f)) })))
      .concat(sourceFiles(s));
    const c = { type: 'data', 'bom-ref': d.ref, manufacturer: CREATORS[d.creator], name: d.name, version: d.version, licenses: licences(d.licence) };
    const purl = githubPurl(s.remote, s.commit);
    if (purl) c.purl = purl;
    c.externalReferences = vcsRefs(s);
    c.pedigree = { commits: s.commit ? [{ uid: s.commit, url: repoUrl(s.remote) + '/commit/' + s.commit }] : undefined, notes: 'NOTICE ' + d.notice + '. Modification: ' + d.modification + '.' };
    if (!c.pedigree.commits) delete c.pedigree.commits;
    c.properties = props;
    components.push(c);
    dep(d.ref);
    for (const x of d.derivedFrom || []) dep(d.ref, x);
  }
  const legalBytes = readBytes(LEGAL_TABLE);
  components.push({ type: 'data', 'bom-ref': 'legal-vat-table', manufacturer: own, name: 'Rechnungspflichtangaben und Zuordnungstabelle (umsatzsteuerliche Einordnung)', version: JSON.parse(legalBytes.toString('utf8')).stand || info.version,
    hashes: [{ alg: 'SHA-512', content: sha(legalBytes, 'sha512') }, { alg: 'SHA-256', content: sha(legalBytes) }], licenses: licences('EUPL-1.2'),
    externalReferences: [{ type: 'source-distribution', url: at(LEGAL_TABLE) }, { type: 'vcs', url: REPO }, secTxt],
    properties: bsi({ filename: path.basename(LEGAL_TABLE), executable: false, archive: false, structured: false, effective: 'EUPL-1.2' }).concat([{ name: 'e-rechnung-pruefer:embedding', value: 'embedded as JSON data of ' + info.file + ' (window.PRUEFER_VAT)' }]) });
  dep('legal-vat-table');

  // ---- the web browser: first component outside the scope of delivery (identified, TR 5.1 / 3.2.4) ----
  components.push({ type: 'platform', 'bom-ref': 'web-browser', manufacturer: CREATORS.whatwg, name: 'Web browser (HTML Living Standard, ECMAScript)', version: 'ECMAScript 2020',
    description: 'not delivered: the browser of the user runs the page; tested in every CI run with Chromium, Firefox and WebKit (Playwright) and with Microsoft Edge and Google Chrome on Windows. Requires DOMParser, Blob/URL, TextDecoder, DecompressionStream; uses Trusted Types and Web Crypto where available.',
    externalReferences: [{ type: 'documentation', url: 'https://html.spec.whatwg.org/' }, { type: 'documentation', url: 'https://tc39.es/ecma262/2020/' }],
    properties: bsi({ executable: true, archive: false, structured: false, effective: 'NOASSERTION' }).filter((p) => p.name !== 'bsi:component:effectiveLicence').concat([{ name: 'e-rechnung-pruefer:scope-of-delivery', value: 'outside (identified component, BSI TR-03183-2 5.1)' }]) });

  // ---- the program ----
  const pageBytes = readBytes(path.join('dist', info.file));
  const page512 = sha(pageBytes, 'sha512');
  const releaseUrl = REPO + '/releases/download/v' + info.version + '/' + info.file;
  const top = {
    type: 'application', 'bom-ref': 'e-rechnung-pruefer', manufacturer: own, name: 'E-Rechnung Prüfer', version: info.version,
    description: 'Offline-Prüfung elektronischer Rechnungen (XRechnung, ZUGFeRD / Factur-X, EN 16931) im Browser; eine HTML-Datei ohne Netzwerkzugriff (Content-Security-Policy connect-src \'none\')',
    hashes: [{ alg: 'SHA-512', content: page512 }, { alg: 'SHA-256', content: info.sha256 }],
    licenses: licences('EUPL-1.2'),
    purl: 'pkg:github/serhiiakhnazarov/e-rechnung-pruefer@v' + info.version,
    externalReferences: [
      { type: 'distribution', url: sec.site + 'E-Rechnung-Pruefer.html', hashes: [{ alg: 'SHA-512', content: page512 }] },
      { type: 'distribution', url: releaseUrl, hashes: [{ alg: 'SHA-512', content: page512 }] },
      { type: 'source-distribution', url: commit ? REPO + '/tree/' + commit : REPO },
      { type: 'vcs', url: REPO },
      { type: 'website', url: sec.site },
      { type: 'security-contact', url: sec.reportForm },
      { type: 'security-contact', url: 'mailto:' + sec.contactEmail },
      secTxt,
      { type: 'advisories', url: sec.advisories },
      { type: 'advisories', url: sec.site + '.well-known/csaf/provider-metadata.json', comment: 'OASIS CSAF 2.0 provider metadata (security advisories and VEX)' },
      { type: 'exploitability-statement', url: sec.site + 'vex.cdx.json', comment: 'CycloneDX VEX of this version (tools/make-vex.cjs); CSAF VEX: .well-known/csaf/white/' },
      { type: 'license', url: REPO + '/blob/main/LICENSE' },
      { type: 'documentation', url: sec.site + 'benutzerinformation/' },
    ],
    properties: bsi({ filename: info.file, executable: true, archive: false, structured: true, effective: 'EUPL-1.2' }).concat([
      { name: 'e-rechnung-pruefer:programSha256', value: info.programSha256 },
      { name: 'e-rechnung-pruefer:manifestSha256', value: info.manifestSha256 },
      { name: 'e-rechnung-pruefer:fingerprint', value: info.fingerprint || '' },
      { name: 'e-rechnung-pruefer:commit', value: commit || '' },
      { name: 'e-rechnung-pruefer:supportEnd', value: sec.supportEnd },
    ]),
  };
  const delivered = components.filter((c) => c.type !== 'platform').map((c) => c['bom-ref']);
  dep('e-rechnung-pruefer');
  for (const r of delivered) dep('e-rechnung-pruefer', r);
  dep('e-rechnung-pruefer', 'web-browser');
  dep('web-browser');

  const timestamp = info.commitDate ? new Date(info.commitDate).toISOString().replace(/\.\d{3}Z$/, 'Z') : info.date + 'T00:00:00Z';
  const bom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:' + uuidFrom(sha('E-Rechnung Prüfer SBOM ' + info.version + ' ' + info.sha256)),
    version: 1,
    metadata: {
      timestamp,
      lifecycles: [{ phase: 'build' }],
      tools: { components: [{ type: 'application', name: 'tools/make-sbom.cjs (E-Rechnung Prüfer)', version: info.version, manufacturer: own, externalReferences: [{ type: 'vcs', url: REPO }] }] },
      manufacturer: own,
      component: top,
      licenses: [{ license: { id: 'EUPL-1.2' } }],
      properties: [
        { name: 'e-rechnung-pruefer:sbom-standard', value: 'BSI TR-03183-2 v2.1.0 (delivery item SBOM, 8.3.4); NTIA minimum elements (2021)' },
        { name: 'e-rechnung-pruefer:vex', value: sec.site + 'vex.cdx.json' },
      ],
    },
    components,
    dependencies: Array.from(deps.entries()).sort((a, b) => (a[0] === 'e-rechnung-pruefer' ? -1 : b[0] === 'e-rechnung-pruefer' ? 1 : 0)).map(([ref, set]) => ({ ref, dependsOn: Array.from(set) })),
    compositions: [
      { aggregate: 'complete', assemblies: ['e-rechnung-pruefer', 'engine-bundle'], dependencies: ['e-rechnung-pruefer'].concat(delivered) },
      { aggregate: 'unknown', dependencies: ['web-browser'] },
    ],
  };
  return JSON.stringify(bom, null, 2) + '\n';
}

module.exports = { makeSbom, OWN_FILES, DATA, ENGINE_FILE, GLOBALS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(root, 'dist', 'sbom.cdx.json'));
  const info = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'BUILD_INFO.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
  const text = makeSbom(info, manifest);
  fs.writeFileSync(out, text);
  console.log(out + ': CycloneDX 1.6, ' + JSON.parse(text).components.length + ' components, SHA-256 ' + sha(text));
}
