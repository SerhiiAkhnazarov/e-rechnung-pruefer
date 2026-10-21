#!/usr/bin/env node
/*
 * make-sbom.cjs — software bill of materials of the program (dist/E-Rechnung-Pruefer.html) as CycloneDX 1.6 JSON:
 * dist/sbom.cdx.json. Called by tools/build-standalone.cjs after the page is written; published with the page
 * (.github/workflows/pages.yml) and attached to every release (release.yml).
 *
 * Content: the program (version, SHA-256 of the page and of the program without its build note, licence, source
 * repository, security contact) and every third-party component it contains – exactly the components of part A of
 * NOTICE, each with version, licence, origin (repository and commit from build/STANDARDS_MANIFEST.json), the
 * SHA-256 of every source file consumed, and the modifications (compiled to JSON, translated, patched). Components
 * used only for building and testing (NOTICE part D) are not part of the program and are not listed.
 * Deterministic: the same inputs give the same bytes (no random serial number; timestamp = build date).
 * Checked by test/run-sbom-tests.cjs (official CycloneDX 1.6 schema, cross-checks against NOTICE and the manifest).
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
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// part A of NOTICE: the components contained in the program. `source` = key of build/STANDARDS_MANIFEST.json
// (repository, commit, consumed files); everything else is stated here and checked against NOTICE by the test.
const COMPONENTS = [
  { notice: 'A.1', source: 'CEN eInvoicing-EN16931 (validation artefacts 1.3.16)', type: 'data', group: 'CEN', name: 'eInvoicing-EN16931 validation artefacts (Schematron, code lists)', version: '1.3.16', licenses: ['EUPL-1.2'], modification: 'compiled from Schematron to JSON (build/schemas/EN16931-*.json); rules, tests and messages unchanged' },
  { notice: 'A.2', source: 'KoSIT xrechnung-schematron (v2.6.0)', type: 'data', group: 'KoSIT', name: 'xrechnung-schematron (XRechnung 3.0.2, with the Peppol rules merged by KoSIT)', version: '2.6.0', licenses: ['Apache-2.0'], modification: 'compiled to JSON (build/schemas/XRechnung-*.json); rules unchanged' },
  { notice: 'A.3', source: 'KoSIT validator-configuration-xrechnung (2026-08-31)', type: 'data', group: 'KoSIT', name: 'validator-configuration-xrechnung (scenarios, XML schemas, levels, report logic)', version: '2026-08-31', licenses: ['Apache-2.0'], modification: 'scenarios compiled to JSON (build/scenarios.json); the report logic of default-report.xsl re-implemented in src/pruefer-core.js' },
  { notice: 'A.4', source: 'Mustangproject ("ZF_250" = Factur-X 1.09.2 / ZUGFeRD 2.5.2 Schematron, code DBs and XSDs)', type: 'data', group: 'FNFE-MPE / FeRD (via Mustangproject)', name: 'Factur-X / ZUGFeRD Schematron, code lists and XML schemas (ZF_250)', version: 'Factur-X 1.09.2 / ZUGFeRD 2.5.2', licenses: ['Apache-2.0'], modification: 'compiled to JSON (build/schemas/FACTUR-X-*.json, build/xsd/FACTUR-X-*.json); rules and schema content unchanged' },
  { notice: 'A.5', source: 'OASIS UBL 2.1 (os-UBL-2.1, xsdrt; from phax/ph-ubl docs/UBL-2.1.zip) — XSD validation', type: 'data', group: 'OASIS', name: 'Universal Business Language 2.1 XML schemas (os-UBL-2.1, xsdrt)', version: 'os-UBL-2.1', licenseName: 'OASIS IPR Policy (legal/OASIS-NOTICE.txt)', modification: 'compiled to validation models (build/xsd/UBL-*.json)' },
  { notice: 'A.6', source: 'UN/CEFACT CII D16B (from phax/ph-cii) — XSD validation', type: 'data', group: 'UN/CEFACT', name: 'Cross Industry Invoice D16B XML schemas (100pD16B, uncoupled)', version: 'D16B', licenseName: 'UN/CEFACT (legal/UNCEFACT-NOTICE.txt)', modification: 'compiled to a validation model (build/xsd/CII-D16B.json)' },
  { notice: 'A.7', source: 'fontoxpath (XPath 3.1 engine, built from source + Prüfer patch: exact decimals, document index, path rewrites)', type: 'library', group: 'FontoXML', name: 'fontoxpath', version: '3.34.0-2-g7506ae0', licenses: ['MIT'], modification: 'built from source with patches/fontoxpath-pruefer.patch into vendor/fontoxpath.iife.min.js', patches: ['patches/fontoxpath-pruefer.patch'] },
  { notice: 'A.7', repo: 'xspattern.js', type: 'library', group: 'bwrrp', name: 'xspattern', version: '3.1.0-2-g953c958', licenses: ['MIT'], modification: 'bundled into vendor/fontoxpath.iife.min.js with patches/xspattern-pruefer.patch', patches: ['patches/xspattern-pruefer.patch'] },
  { notice: 'A.7', repo: 'whynot.js', type: 'library', group: 'bwrrp', name: 'whynot', version: '5.0.0', licenses: ['MIT'], modification: 'bundled into vendor/fontoxpath.iife.min.js' },
  { notice: 'A.7', repo: 'prsc.js', type: 'library', group: 'bwrrp', name: 'prsc', version: '4.0.0', licenses: ['MIT'], modification: 'bundled into vendor/fontoxpath.iife.min.js' },
  { notice: 'A.8', type: 'data', group: 'Unicode', name: 'Unicode Character Database (general categories and blocks, packed into the tables of xspattern)', version: '15.0.0', licenses: ['Unicode-3.0'], website: 'https://www.unicode.org/Public/15.0.0/ucd/', modification: 'packed into the tables of xspattern' },
  { notice: 'A.9', type: 'library', group: 'Apache Software Foundation', name: 'Apache Xerces-J (as contained in OpenJDK 21, module java.xml)', version: '2.12.2', licenses: ['Apache-2.0'], website: 'https://xerces.apache.org/xerces2-j/', modification: 'parts of src/xsd-validator.js are JavaScript translations of, or follow closely, Xerces classes (NOTICE A.9)' },
  { notice: 'A.10', type: 'library', group: '', name: 'esbuild (module wrapper and helper code in the bundles)', version: '0.28.2', licenses: ['MIT'], purl: 'pkg:npm/esbuild@0.28.2', website: 'https://github.com/evanw/esbuild', modification: 'inserted by the bundler into vendor/fontoxpath.iife.min.js' },
  { notice: 'A.11', source: 'KoSIT xrechnung-visualization (v2026-08-31)', type: 'data', group: 'KoSIT', name: 'xrechnung-visualization (syntax binding of the business terms)', version: '2026-08-31', licenses: ['Apache-2.0'], modification: 'the path of every business term extracted into build/bt-paths.json (tools/build-bt-paths.cjs); the stylesheets are not contained' },
  { notice: 'A.12', source: 'Adobe Core14 font metrics (AFM, via matplotlib v3.10.7) — widths for the PDF writer', type: 'data', group: 'Adobe', name: 'Core14 font metrics (AFM) of Helvetica, Helvetica-Bold and Courier', version: 'matplotlib v3.10.7', licenseName: 'Adobe AFM permission (copyright notices retained in src/pdf-fonts.js)', modification: 'character widths extracted into src/pdf-fonts.js (tools/gen-pdf-fonts.cjs)' },
];

/** pkg:github purl of a GitHub repository at a commit */
function githubPurl(remote, commit) {
  const m = /github\.com\/([^/]+)\/([^/.]+(?:\.[^/.]+)*?)(?:\.git)?$/.exec(remote || '');
  return m ? 'pkg:github/' + m[1].toLowerCase() + '/' + m[2].toLowerCase() + '@' + commit : null;
}
/** RFC 4122 name-based UUID (version 5 layout) from a SHA-256: deterministic serial number */
function uuidFrom(hex) {
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20, 32);
}

function makeSbom(info, manifest) {
  const sources = manifest.sources;
  const repoOf = (c) => {
    if (c.source) { const s = sources[c.source]; if (!s) throw new Error('make-sbom: source missing in the manifest: ' + c.source); return s; }
    if (c.repo) { for (const s of Object.values(sources)) for (const r of s.repos || []) if (r.path === c.repo) return r; throw new Error('make-sbom: repository missing in the manifest: ' + c.repo); }
    return null;
  };
  const components = COMPONENTS.map((c, i) => {
    const s = repoOf(c);
    const ref = 'component-' + String(i + 1).padStart(2, '0');
    const comp = { type: c.type, 'bom-ref': ref };
    if (c.group) comp.group = c.group;
    comp.name = c.name;
    comp.version = c.version;
    comp.licenses = c.licenses ? c.licenses.map((id) => ({ license: { id } })) : [{ license: { name: c.licenseName } }];
    const purl = c.purl || (s && githubPurl(s.remote, s.commit));
    if (purl) comp.purl = purl;
    const ext = [];
    if (s && s.remote) ext.push({ type: 'vcs', url: s.remote.replace(/\.git$/, '') });
    if (c.website) ext.push({ type: 'website', url: c.website });
    if (ext.length) comp.externalReferences = ext;
    const pedigree = {};
    if (s && s.commit) pedigree.commits = [{ uid: s.commit, url: s.remote.replace(/\.git$/, '') + '/commit/' + s.commit }];
    if (c.patches) pedigree.patches = c.patches.map((p) => ({ type: 'unofficial', diff: { url: REPO + '/blob/main/' + p } }));
    pedigree.notes = 'NOTICE ' + c.notice + '. Modification: ' + c.modification + '.';
    comp.pedigree = pedigree;
    const props = [{ name: 'e-rechnung-pruefer:notice', value: c.notice }];
    const files = (s && (s.files || []).concat(s.merged || [])) || [];
    for (const f of files) props.push({ name: 'e-rechnung-pruefer:source-file', value: f.file + ' sha256:' + f.sha256 });
    if (s && s.archive) props.push({ name: 'e-rechnung-pruefer:source-archive', value: s.archive.file + ' sha256:' + s.archive.sha256 });
    comp.properties = props;
    return comp;
  });
  const top = {
    type: 'application', 'bom-ref': 'e-rechnung-pruefer', group: 'SerhiiAkhnazarov', name: 'E-Rechnung Prüfer', version: info.version,
    description: 'Offline-Prüfung elektronischer Rechnungen (XRechnung, ZUGFeRD / Factur-X, EN 16931) im Browser; eine HTML-Datei ohne Netzwerkzugriff (Content-Security-Policy connect-src \'none\')',
    licenses: [{ license: { id: 'EUPL-1.2' } }],
    purl: 'pkg:github/serhiiakhnazarov/e-rechnung-pruefer@v' + info.version,
    hashes: [{ alg: 'SHA-256', content: info.sha256 }],
    externalReferences: [
      { type: 'vcs', url: REPO },
      { type: 'website', url: 'https://serhiiakhnazarov.github.io/e-rechnung-pruefer/' },
      { type: 'security-contact', url: REPO + '/security/advisories/new' },
      { type: 'license', url: REPO + '/blob/main/LICENSE' },
    ],
    properties: [
      { name: 'e-rechnung-pruefer:file', value: info.file },
      { name: 'e-rechnung-pruefer:programSha256', value: info.programSha256 },
      { name: 'e-rechnung-pruefer:manifestSha256', value: info.manifestSha256 },
      { name: 'e-rechnung-pruefer:fingerprint', value: info.fingerprint || '' },
    ],
  };
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:' + uuidFrom(sha('E-Rechnung Prüfer ' + info.version + ' ' + info.sha256)),
    version: 1,
    metadata: {
      timestamp: info.date + 'T00:00:00Z',
      lifecycles: [{ phase: 'build' }],
      tools: { components: [{ type: 'application', name: 'tools/make-sbom.cjs', version: info.version, externalReferences: [{ type: 'vcs', url: REPO }] }] },
      component: top,
      manufacturer: { name: 'Serhii Akhnazarov', url: ['https://github.com/SerhiiAkhnazarov'] },
      licenses: [{ license: { id: 'EUPL-1.2' } }],
    },
    components,
    dependencies: [{ ref: 'e-rechnung-pruefer', dependsOn: components.map((c) => c['bom-ref']) }].concat(components.map((c) => ({ ref: c['bom-ref'] }))),
  };
  return JSON.stringify(bom, null, 2) + '\n';
}

module.exports = { makeSbom, COMPONENTS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(root, 'dist', 'sbom.cdx.json'));
  const info = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'BUILD_INFO.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
  const text = makeSbom(info, manifest);
  fs.writeFileSync(out, text);
  console.log(out + ': CycloneDX 1.6, ' + COMPONENTS.length + ' components, SHA-256 ' + sha(text));
}
