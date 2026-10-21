#!/usr/bin/env node
/*
 * run-sbom-tests.cjs — the software bill of materials dist/sbom.cdx.json (tools/make-sbom.cjs), the VEX document
 * dist/vex.cdx.json (tools/make-vex.cjs) and the bill of materials of the test environment (tools/make-test-bom.cjs):
 *
 *  1. reproducible: SBOM and VEX generated again from their inputs, byte-identical;
 *  2. BSI TR-03183-2 v2.1.0, delivery item SBOM: CycloneDX 1.6, serial number, UTC timestamp, creator of the SBOM;
 *     for every component creator (e-mail or URL), name, version, licences as declared and concluded with the
 *     effective licence, the properties executable / archive / structured; for every deliverable file in addition its
 *     file name and SHA-512; components without a file of their own are contained in such a file (dependencies);
 *     every component in the dependency graph; completeness (compositions); no vulnerability information;
 *  3. the program: version, SHA-256 / SHA-512 of the page in dist/, programSha256, manifestSha256, security contacts,
 *     VEX reference; every program file and the engine bundle with the hashes of the repository files and contained
 *     byte for byte in the page;
 *  4. complete against NOTICE part A ("contained in the program"): every A.n paragraph has a component, every
 *     component that names a paragraph is stated there with its version or commit; nothing of parts B-D;
 *  5. origin: every rule set, schema and data component carries the commit, the consumed files (SHA-256) of the
 *     manifest and the SHA-256 of the files compiled from them; patched engine components carry their patch;
 *  6. module dependencies of the program files, checked against the references in their code;
 *  7. VEX: every statement of security/vex.json, refers to a component of this SBOM by BOM-Link, decoupled from it;
 *  8. the official CycloneDX 1.6 JSON schema (CycloneDX/specification, pinned in the manifest) with the Python package
 *     jsonschema (test/sbom-oracle/validate_cdx.py) for SBOM, VEX and the environment BOM – and a broken document as a
 *     negative control; every action of the workflows pinned to a commit.
 * Usage: node test/run-sbom-tests.cjs <CycloneDX specification checkout, e.g. ext/cyclonedx-specification>
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const specDir = process.argv[2];
const { makeSbom, OWN_FILES, DATA, ENGINE_FILE, GLOBALS } = require(path.join(root, 'tools', 'make-sbom.cjs'));
const { makeVex } = require(path.join(root, 'tools', 'make-vex.cjs'));
const sha = (b, alg) => crypto.createHash(alg || 'sha256').update(b).digest('hex');
const read = (f) => fs.readFileSync(path.join(root, f));
let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' – ' + String(detail).slice(0, 300) : '')); } };

const info = JSON.parse(read('dist/BUILD_INFO.json'));
const manifest = JSON.parse(read('build/STANDARDS_MANIFEST.json'));
const sec = JSON.parse(read('legal/security.json'));
const sbomFile = path.join(root, 'dist', 'sbom.cdx.json');
const vexFile = path.join(root, 'dist', 'vex.cdx.json');
const text = fs.readFileSync(sbomFile, 'utf8');
const vexText = fs.readFileSync(vexFile, 'utf8');
const bom = JSON.parse(text);
const vex = JSON.parse(vexText);
const vexSource = JSON.parse(read('security/vex.json'));
const page = read(path.join('dist', info.file));
const pageText = page.toString('utf8');
const prop = (c, n) => ((c.properties || []).find((p) => p.name === n) || {}).value;
const props = (c, n) => (c.properties || []).filter((p) => p.name === n).map((p) => p.value);
const hash = (c, alg) => ((c.hashes || []).find((h) => h.alg === alg) || {}).content;

// ---- 1. reproducible ----
check('SBOM reproducible: generated again, byte-identical', makeSbom(info, manifest) === text);
check('VEX reproducible: generated again from the SBOM and security/vex.json, byte-identical', makeVex(text, vexSource.statements) === vexText);

// ---- 2. BSI TR-03183-2 ----
const top = bom.metadata.component;
const all = [top].concat(bom.components);
check('CycloneDX 1.6 (TR 4: CycloneDX 1.6 or later)', bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.6');
check('serial number: RFC 4122 URN', /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(bom.serialNumber), bom.serialNumber);
check('timestamp of the SBOM: ISO 8601 in UTC (TR 5.2.1)', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(bom.metadata.timestamp), bom.metadata.timestamp);
const creatorOk = (m) => !!m && !!m.name && ((m.contact || []).some((c) => /^[^@\s]+@[^@\s]+$/.test(c.email || '')) || (m.url || []).some((u) => /^https:\/\//.test(u)));
check('creator of the SBOM: e-mail address (TR 5.2.1)', creatorOk(bom.metadata.manufacturer) && bom.metadata.manufacturer.contact[0].email === sec.contactEmail);
check('no vulnerability information in the SBOM (TR 3.1)', !('vulnerabilities' in bom));
const ACK = (c) => { const l = c.licenses || []; return l.some((x) => x.license && x.license.acknowledgement === 'declared') && l.some((x) => x.license && x.license.acknowledgement === 'concluded'); };
const VALUES = { 'bsi:component:executable': ['executable', 'non-executable'], 'bsi:component:archive': ['archive', 'no archive'], 'bsi:component:structured': ['structured', 'unstructured'] };
const delivered = all.filter((c) => c.type !== 'platform');
for (const c of all) {
  const n = 'component ' + (c['bom-ref'] || c.name).slice(0, 48) + ': ';
  check(n + 'creator with e-mail or URL (TR 5.2.2)', creatorOk(c.manufacturer), JSON.stringify(c.manufacturer));
  check(n + 'name and version', !!c.name && !!c.version);
  for (const [k, v] of Object.entries(VALUES)) check(n + k, v.includes(prop(c, k)), prop(c, k));
  if (c.type !== 'platform') {
    check(n + 'licences as declared (original) and concluded (distribution) (TR 8.2)', ACK(c), JSON.stringify(c.licenses));
    const eff = prop(c, 'bsi:component:effectiveLicence');
    check(n + 'effective licence = concluded licence', !!eff && (c.licenses || []).some((x) => x.license && x.license.acknowledgement === 'concluded' && (x.license.id || x.license.name) === eff), eff);
    for (const l of c.licenses || []) if (l.license && l.license.name) check(n + 'licence without SPDX id: ScanCode LicenseDB identifier with its URL', /^LicenseRef-scancode-[a-z0-9.-]+$/.test(l.license.name) && l.license.url === 'https://scancode-licensedb.aboutcode.org/' + l.license.name.slice(20) + '.html', l.license.name);
  }
}
// deliverable files: own files, the engine bundle, the legal table, the page itself
const files = all.filter((c) => prop(c, 'bsi:component:filename'));
for (const c of files) check('file ' + prop(c, 'bsi:component:filename') + ': SHA-512 (TR 5.2.2 hash of the deployable component)', /^[0-9a-f]{128}$/.test(hash(c, 'SHA-512') || ''));
const deps = new Map(bom.dependencies.map((d) => [d.ref, d.dependsOn || []]));
check('every component has an entry in the dependency graph (TR 5.2.2 dependencies)', all.every((c) => deps.has(c['bom-ref'])), all.filter((c) => !deps.has(c['bom-ref'])).map((c) => c['bom-ref']).join(' '));
check('every dependency points to a component of the SBOM', Array.from(deps.values()).flat().every((r) => all.some((c) => c['bom-ref'] === r)));
check('the program contains every delivered component and runs on the browser', JSON.stringify((deps.get(top['bom-ref']) || []).slice().sort()) === JSON.stringify(bom.components.map((c) => c['bom-ref']).sort()));
// a component without a file of its own is contained in a delivered file: reachable from a file component through
// "dependsOn" without passing the program (resolution of the delivery item, TR 5.1)
const fileRefs = new Set(files.filter((c) => c !== top).map((c) => c['bom-ref']));
const reach = new Set();
(function walk(list) { for (const r of list) if (!reach.has(r)) { reach.add(r); walk(deps.get(r) || []); } })(Array.from(fileRefs));
const inner = bom.components.filter((c) => !prop(c, 'bsi:component:filename') && c.type !== 'platform');
for (const c of inner) check('component ' + c['bom-ref'] + ' (no file of its own): contained in a delivered file', reach.has(c['bom-ref']));
const comp = bom.compositions || [];
check('compositions: complete for the program and every delivered component, unknown for the browser (TR 5.1)', comp.some((x) => x.aggregate === 'complete' && delivered.every((c) => x.dependencies.includes(c['bom-ref']))) && comp.some((x) => x.aggregate === 'unknown' && x.dependencies.includes('web-browser')));
check('the browser: first component outside the scope of delivery, identified (platform)', bom.components.some((c) => c.type === 'platform' && c['bom-ref'] === 'web-browser' && prop(c, 'e-rechnung-pruefer:scope-of-delivery')));

// ---- 3. the program ----
check('program: version ' + info.version, top.version === info.version);
check('program: SHA-256 and SHA-512 of the page in dist/ (= BUILD_INFO)', hash(top, 'SHA-256') === sha(page) && sha(page) === info.sha256 && hash(top, 'SHA-512') === sha(page, 'sha512'));
check('program: programSha256 and manifestSha256 as in BUILD_INFO', prop(top, 'e-rechnung-pruefer:programSha256') === info.programSha256 && prop(top, 'e-rechnung-pruefer:manifestSha256') === info.manifestSha256 && info.manifestSha256 === sha(read('build/STANDARDS_MANIFEST.json')));
check('program: licence EUPL-1.2, purl of the release tag', top.licenses.every((l) => l.license.id === 'EUPL-1.2') && top.purl === 'pkg:github/serhiiakhnazarov/e-rechnung-pruefer@v' + info.version);
const ext = (t) => (top.externalReferences || []).filter((r) => r.type === t).map((r) => r.url);
check('program: security contacts (report form, e-mail), security.txt, advisories (GitHub, CSAF), VEX', ext('security-contact').includes(sec.reportForm) && ext('security-contact').includes('mailto:' + sec.contactEmail) && ext('rfc-9116').includes(sec.site + '.well-known/security.txt') && ext('advisories').includes(sec.advisories) && ext('advisories').includes(sec.site + '.well-known/csaf/provider-metadata.json') && ext('exploitability-statement').includes(sec.site + 'vex.cdx.json'));
check('program: end of support ' + sec.supportEnd + ' (Art. 13 Abs. 19 CRA)', prop(top, 'e-rechnung-pruefer:supportEnd') === sec.supportEnd);
for (const [f] of OWN_FILES) {
  const c = bom.components.find((x) => x['bom-ref'] === 'file:' + f);
  const bytes = read(f);
  check('program file ' + f + ': in the SBOM with the hashes of the repository file', !!c && hash(c, 'SHA-256') === sha(bytes) && hash(c, 'SHA-512') === sha(bytes, 'sha512'));
  check('program file ' + f + ': contained byte for byte in the page', pageText.includes(bytes.toString('utf8')));
}
const eng = bom.components.find((c) => c['bom-ref'] === 'engine-bundle');
check('engine bundle: hashes of ' + ENGINE_FILE + ', contained byte for byte in the page', !!eng && hash(eng, 'SHA-512') === sha(read(ENGINE_FILE), 'sha512') && pageText.includes(read(ENGINE_FILE).toString('utf8')));
const js = fs.readdirSync(path.join(root, 'src')).filter((f) => /\.(js|css)$/.test(f)).map((f) => 'src/' + f);
check('every file of src/ is a component of the SBOM (' + js.length + ')', js.every((f) => OWN_FILES.some(([g]) => g === f)), js.filter((f) => !OWN_FILES.some(([g]) => g === f)).join(' '));

// ---- 4. NOTICE part A ----
const notice = read('NOTICE').toString('utf8');
const partA = notice.slice(notice.indexOf('\nA. '), notice.indexOf('\nB. '));
const paragraphs = {};
for (const m of partA.matchAll(/\n(A\.\d+)\s+([\s\S]*?)(?=\nA\.\d+\s|$)/g)) paragraphs[m[1]] = m[2].replace(/\s+/g, ' ');
const ids = Object.keys(paragraphs);
check('NOTICE part A: paragraphs A.1 … A.' + ids.length, ids.length >= 12 && ids.every((id, i) => id === 'A.' + (i + 1)), ids.join(' '));
const noticeOf = (c) => (prop(c, 'e-rechnung-pruefer:notice') || '').split(/,\s*/).filter(Boolean);
for (const id of ids) check('NOTICE ' + id + ': a component of the SBOM names it', bom.components.some((c) => noticeOf(c).includes(id)));
for (const c of bom.components.filter((x) => noticeOf(x).length)) {
  const p = paragraphs[noticeOf(c)[0]] || '';
  const commit = ((c.pedigree && c.pedigree.commits) || [])[0];
  const v = String(c.version).replace(/^matplotlib v/, '').replace(/\+pruefer\.[0-9a-f]{8}$/, '');
  const ancestor = c.pedigree && c.pedigree.ancestors && c.pedigree.ancestors[0];
  const states = p.includes(v) || (commit && p.includes(commit.uid.slice(0, 12))) || (ancestor && p.includes(ancestor.version));
  check('component ' + c['bom-ref'] + ': NOTICE ' + noticeOf(c)[0] + ' states its version or commit (' + v + ')', !!p && !!states);
}
for (const forbidden of ['slimdom', 'Saxon', 'Playwright', 'pdf.js', 'veraPDF', 'qpdf', 'poppler', 'OpenPeppol', 'Peppol BIS']) check('not in the program, not in the SBOM: ' + forbidden, !bom.components.some((c) => c.name.includes(forbidden)));

// ---- 5. origin ----
for (const d of DATA) {
  const c = bom.components.find((x) => x['bom-ref'] === d.ref);
  const s = manifest.sources[d.source];
  check('origin ' + d.ref + ': component and manifest entry', !!c && !!s);
  if (!c || !s) continue;
  if (s.commit) check('origin ' + d.ref + ': purl and pedigree carry the commit of the manifest (' + s.commit.slice(0, 12) + ')', c.purl && c.purl.endsWith('@' + s.commit) && c.pedigree.commits[0].uid === s.commit);
  const consumed = (s.files || []).concat(s.merged || []);
  if (consumed.length) check('origin ' + d.ref + ': every consumed file with its SHA-256 (' + consumed.length + ')', consumed.every((f) => props(c, 'e-rechnung-pruefer:source-file').includes(f.file + ' sha256:' + f.sha256)));
  for (const f of d.compiled || []) check('origin ' + d.ref + ': compiled file ' + f + ' with its SHA-256', props(c, 'e-rechnung-pruefer:compiled-file').includes(f + ' sha256:' + sha(read(f))));
}
for (const [ref, patch] of [['fontoxpath', 'patches/fontoxpath-pruefer.patch'], ['xspattern', 'patches/xspattern-pruefer.patch']]) {
  const c = bom.components.find((x) => x['bom-ref'] === ref);
  const ps = sha(read(patch));
  check(ref + ': modified by ' + patch + ' (version suffix and property carry its SHA-256), creator = the Prüfer (TR 8.1.8), upstream release as pedigree ancestor', !!c && c.version.endsWith('+pruefer.' + ps.slice(0, 8)) && prop(c, 'e-rechnung-pruefer:patch') === patch + ' sha256:' + ps && c.manufacturer.name === sec.manufacturer && /^pkg:npm\//.test(c.pedigree.ancestors[0].purl));
}
const xv = bom.components.find((c) => c['bom-ref'] === 'file:src/xsd-validator.js');
check('src/xsd-validator.js: derived from Apache Xerces-J (pedigree ancestor with purl, NOTICE A.9)', !!xv && xv.pedigree && xv.pedigree.ancestors[0].purl === 'pkg:maven/xerces/xercesImpl@2.12.2' && prop(xv, 'e-rechnung-pruefer:notice') === 'A.9');

// ---- 6. module dependencies ----
const codeOf = (f) => read(f).toString('utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
for (const [f] of OWN_FILES.filter(([x]) => x.endsWith('.js'))) {
  const edges = (deps.get('file:' + f) || []).filter((r) => r.startsWith('file:')).map((r) => r.slice(5));
  const textF = read(f).toString('utf8');
  for (const g of edges) if (GLOBALS[g]) check('dependency ' + f + ' -> ' + g + ': ' + GLOBALS[g] + ' is referenced in ' + f, new RegExp('\\b' + GLOBALS[g] + '\\b').test(textF));
  for (const [g, name] of Object.entries(GLOBALS)) if (g !== f && new RegExp('\\b' + name + '\\.\\w').test(codeOf(f))) check('dependency ' + f + ' -> ' + g + ' (' + name + '.… used) recorded', edges.includes(g));
}
for (const [a, b] of [['src/app.js', 'src/pruefer-core.js'], ['src/app.js', 'src/reports.js'], ['src/app.js', 'src/xml-parse.js'], ['src/reports.js', 'src/pdf-writer.js'], ['src/reports.js', 'src/file-safety.js'], ['src/pdf-writer.js', 'src/pdf-fonts.js']]) check('dependency ' + a + ' -> ' + b, (deps.get('file:' + a) || []).includes('file:' + b));
check('the engine bundle contains fontoxpath, xspattern, whynot, prsc, the esbuild helpers and the Unicode tables', ['fontoxpath', 'xspattern', 'whynot', 'prsc', 'esbuild-runtime', 'unicode-ucd'].every((r) => (deps.get('engine-bundle') || []).includes(r)));

// ---- 7. VEX ----
const link = 'urn:cdx:' + bom.serialNumber.replace(/^urn:uuid:/, '') + '/' + bom.version + '#';
check('VEX: CycloneDX 1.6, own serial number, decoupled from the SBOM (no components)', vex.bomFormat === 'CycloneDX' && vex.specVersion === '1.6' && vex.serialNumber !== bom.serialNumber && !('components' in vex));
check('VEX: describes the program of this SBOM (bom-ref, version, purl) and names the SBOM', vex.metadata.component['bom-ref'] === top['bom-ref'] && vex.metadata.component.version === top.version && vex.metadata.component.purl === top.purl && prop(vex.metadata, 'e-rechnung-pruefer:sbom') === link.slice(0, -1));
check('VEX: every statement of security/vex.json (' + vexSource.statements.length + ')', vex.vulnerabilities.length === vexSource.statements.length && vexSource.statements.every((s) => vex.vulnerabilities.some((v) => v.id === s.id && v.analysis.state === s.state && (v.analysis.justification || null) === (s.justification || null) && v.analysis.lastUpdated === s.lastUpdated)));
for (const v of vex.vulnerabilities) {
  check('VEX ' + v.id + ': affects a component of this SBOM by BOM-Link', v.affects.length > 0 && v.affects.every((a) => a.ref.startsWith(link) && all.some((c) => c['bom-ref'] === a.ref.slice(link.length))), JSON.stringify(v.affects));
  check('VEX ' + v.id + ': state with justification and detail', !!v.analysis.state && (v.analysis.state !== 'not_affected' || !!v.analysis.justification) && v.analysis.detail.length > 40);
}

// ---- 8. official schema, environment BOM ----
const envFile = path.join(os.tmpdir(), 'test-environment-' + process.pid + '.cdx.json');
const env = spawnSync(process.execPath, [path.join(root, 'tools', 'make-test-bom.cjs'), '--static', '--out', envFile], { encoding: 'utf8' });
check('environment BOM (static) generated', env.status === 0 && fs.existsSync(envFile), (env.stderr || env.stdout || '').slice(0, 300));
if (fs.existsSync(envFile)) {
  const eb = JSON.parse(fs.readFileSync(envFile, 'utf8'));
  const actions = eb.components.filter((c) => c['bom-ref'].startsWith('action:'));
  check('environment BOM: every action of the workflows pinned to a commit (' + actions.length + ')', actions.length > 0 && actions.every((c) => /^[0-9a-f]{40}$/.test(prop(c, 'e-rechnung-pruefer:pinned-commit') || '')), actions.filter((c) => !/^[0-9a-f]{40}$/.test(prop(c, 'e-rechnung-pruefer:pinned-commit') || '')).map((c) => c['bom-ref']).join(' '));
  const wf = fs.readdirSync(path.join(root, '.github', 'workflows')).map((f) => fs.readFileSync(path.join(root, '.github', 'workflows', f), 'utf8')).join('\n');
  const usesLines = wf.split('\n').filter((l) => /^\s*(-\s+)?uses:/.test(l));
  check('workflows: every "uses:" pinned to a full commit SHA with its version as comment (' + usesLines.length + ')', usesLines.every((l) => /@[0-9a-f]{40} # v\d/.test(l)), usesLines.filter((l) => !/@[0-9a-f]{40} # v\d/.test(l)).join(' | '));
  const checkouts = wf.split(/\n\s*- /).filter((s2) => /uses: actions\/checkout@/.test(s2));
  check('workflows: every checkout without persisted credentials (' + checkouts.length + ')', checkouts.every((s2) => /persist-credentials: false/.test(s2)));
  check('test tools: exact versions in package.json (no ranges)', Object.values(JSON.parse(read('package.json')).devDependencies).every((v) => /^\d+\.\d+\.\d+$/.test(v)));
}
if (!specDir || !fs.existsSync(path.join(specDir, 'schema', 'bom-1.6.schema.json'))) check('CycloneDX specification checkout given', false, String(specDir));
else {
  const broken = JSON.parse(text);
  delete broken.components[0].name;           // name is required
  broken.components[1].licenses = [{ license: { id: 'Not-An-SPDX-Id' } }];
  // in a directory of its own (fs.mkdtempSync: unique name, permissions of the user only)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-broken-'));
  const tmp = path.join(tmpDir, 'sbom-broken.json');
  fs.writeFileSync(tmp, JSON.stringify(broken));
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const docs = [sbomFile, vexFile].concat(fs.existsSync(envFile) ? [envFile] : []);
  const r = spawnSync(py, ['-I', path.join(__dirname, 'sbom-oracle', 'validate_cdx.py'), path.join(specDir, 'schema')].concat(docs, [tmp]), { encoding: 'utf8' });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(out.trim().split('\n').slice(0, 8).map((l) => '  ' + l).join('\n'));
  for (const d of docs) check('official CycloneDX 1.6 schema: ' + path.basename(d) + ' valid', out.includes(d + ': valid'), out.slice(0, 300));
  check('negative control: the broken document is rejected (missing name, unknown SPDX id)', out.includes(tmp + ': INVALID') && /'name' is a required property/.test(out), out.slice(-300));
}
fs.rmSync(envFile, { force: true });

for (const f of failures) console.log('FAIL ' + f);
console.log('SBOM tests: ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (CycloneDX 1.6 / BSI TR-03183-2, ' + bom.components.length + ' components, NOTICE part A, VEX ' + vex.vulnerabilities.length + ' statements, official schema)');
process.exit(fail ? 1 : 0);
