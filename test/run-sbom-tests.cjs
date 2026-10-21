#!/usr/bin/env node
/*
 * run-sbom-tests.cjs — the software bill of materials dist/sbom.cdx.json (tools/make-sbom.cjs):
 *  1. reproducible: generated again from dist/BUILD_INFO.json and build/STANDARDS_MANIFEST.json, byte-identical;
 *  2. the program: version, SHA-256 of the page (= the file in dist/), programSha256, manifest SHA-256 as in BUILD_INFO;
 *  3. complete against NOTICE part A ("contained in the program"): every A.n paragraph has a component, every
 *     component names an A.n paragraph that states its version or commit; nothing of parts B-D (not in the program);
 *  4. origin: every GitHub component carries the commit and the consumed files (SHA-256) of the manifest;
 *  5. the official CycloneDX 1.6 JSON schema (CycloneDX/specification, pinned in the manifest) with the Python package
 *     jsonschema (test/sbom-oracle/validate_cdx.py) – and a broken document as a negative control.
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
const { makeSbom, COMPONENTS } = require(path.join(root, 'tools', 'make-sbom.cjs'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' – ' + detail : '')); } };

const info = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'BUILD_INFO.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
const file = path.join(root, 'dist', 'sbom.cdx.json');
const text = fs.readFileSync(file, 'utf8');
const bom = JSON.parse(text);

// 1. reproducible
check('reproducible: generated again, byte-identical', makeSbom(info, manifest) === text);
// 2. the program
const top = bom.metadata && bom.metadata.component;
check('program: CycloneDX 1.6', bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.6');
check('program: version ' + info.version, top && top.version === info.version);
const page = fs.readFileSync(path.join(root, 'dist', info.file));
check('program: SHA-256 of the page in dist/ = SBOM = BUILD_INFO', top && top.hashes && top.hashes[0].alg === 'SHA-256' && top.hashes[0].content === sha(page) && sha(page) === info.sha256);
const prop = (c, n) => ((c.properties || []).find((p) => p.name === n) || {}).value;
check('program: programSha256 and manifestSha256 as in BUILD_INFO', prop(top, 'e-rechnung-pruefer:programSha256') === info.programSha256 && prop(top, 'e-rechnung-pruefer:manifestSha256') === info.manifestSha256 && info.manifestSha256 === sha(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'))));
check('program: licence EUPL-1.2, security contact', JSON.stringify(top.licenses) === JSON.stringify([{ license: { id: 'EUPL-1.2' } }]) && (top.externalReferences || []).some((r) => r.type === 'security-contact' && /\/security\/advisories\/new$/.test(r.url)));
check('dependencies: the program depends on every component', JSON.stringify((bom.dependencies[0] || {}).dependsOn) === JSON.stringify(bom.components.map((c) => c['bom-ref'])));
// 3. NOTICE part A
const notice = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
const partA = notice.slice(notice.indexOf('\nA. '), notice.indexOf('\nB. '));
const paragraphs = {};
for (const m of partA.matchAll(/\n(A\.\d+)\s+([\s\S]*?)(?=\nA\.\d+\s|$)/g)) paragraphs[m[1]] = m[2];
const ids = Object.keys(paragraphs);
check('NOTICE part A has paragraphs A.1 … A.' + ids.length, ids.length >= 12 && ids.every((id, i) => id === 'A.' + (i + 1)), ids.join(' '));
for (const id of ids) check('NOTICE ' + id + ': a component in the SBOM', bom.components.some((c) => prop(c, 'e-rechnung-pruefer:notice') === id));
for (const c of bom.components) {
  const id = prop(c, 'e-rechnung-pruefer:notice');
  const p = paragraphs[id] || '';
  const commit = ((c.pedigree && c.pedigree.commits) || [])[0];
  const states = p.includes(String(c.version).split('-')[0].replace(/^matplotlib v/, '')) || (commit && p.includes(commit.uid.slice(0, 12)));
  check('component ' + c.name.slice(0, 40) + ': NOTICE ' + id + ' states its version or commit', !!p && states, 'version ' + c.version);
}
for (const forbidden of ['slimdom', 'Saxon', 'Playwright', 'pdf.js', 'veraPDF', 'qpdf', 'poppler', 'OpenPeppol', 'Peppol BIS']) check('not in the program, not in the SBOM: ' + forbidden, !bom.components.some((c) => c.name.includes(forbidden)));
// 4. origin
for (const c of bom.components) {
  const commit = ((c.pedigree && c.pedigree.commits) || [])[0];
  if (!c.purl || !c.purl.startsWith('pkg:github/')) continue;
  const at = c.purl.split('@')[1];
  const src = Object.values(manifest.sources).flatMap((s) => (s.repos || [s])).find((r) => r.commit === at);
  check('origin ' + c.name.slice(0, 40) + ': commit of the manifest (' + at.slice(0, 12) + ')', !!src && commit && commit.uid === at);
  const files = (c.properties || []).filter((p) => p.name === 'e-rechnung-pruefer:source-file');
  const s = Object.values(manifest.sources).find((x) => x.commit === at);
  if (s && (s.files || []).length) check('origin ' + c.name.slice(0, 40) + ': every consumed file with SHA-256 (' + s.files.length + ')', s.files.every((f) => files.some((p) => p.value === f.file + ' sha256:' + f.sha256)));
}
check('every component of tools/make-sbom.cjs is in the SBOM', bom.components.length === COMPONENTS.length);
// 5. official schema (and a negative control)
if (!specDir || !fs.existsSync(path.join(specDir, 'schema', 'bom-1.6.schema.json'))) check('CycloneDX specification checkout given', false, String(specDir));
else {
  const broken = JSON.parse(text);
  broken.specVersion = '1.6';
  delete broken.components[0].name;           // name is required
  broken.components[1].licenses = [{ license: { id: 'Not-An-SPDX-Id' } }];
  const tmp = path.join(os.tmpdir(), 'sbom-broken-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify(broken));
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(py, ['-I', path.join(__dirname, 'sbom-oracle', 'validate_cdx.py'), path.join(specDir, 'schema'), file, tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(out.trim().split('\n').slice(0, 8).map((l) => '  ' + l).join('\n'));
  check('official CycloneDX 1.6 schema: dist/sbom.cdx.json valid', new RegExp(file.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + ': valid').test(out), out.slice(0, 300));
  check('negative control: the broken document is rejected (missing name, unknown SPDX id)', /INVALID \(\d+ errors\)/.test(out) && /'name' is a required property/.test(out), out.slice(0, 300));
}

for (const f of failures) console.log('FAIL ' + f);
console.log('SBOM tests: ' + (pass + fail) + ' checks, ' + pass + ' passed, ' + fail + ' failed (CycloneDX 1.6, ' + bom.components.length + ' components = NOTICE part A, reproducible, official schema)');
process.exit(fail ? 1 : 0);
