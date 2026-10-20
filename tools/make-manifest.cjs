#!/usr/bin/env node
/*
 * make-manifest.cjs — Stage 0: freezes the standards corpus. Records for every source repository
 * the remote URL, checked-out commit/tag and SHA-256 of the files this project consumes, plus the
 * SHA-256 of the derived artefacts (merged Schematron, compiled JSON, engine bundles).
 *
 * All paths are logical: '<repository>/<path inside the repository>' with the repository names of the
 * CI layout (.github/workflows/verify.yml, tools/verify-all.cjs), so the manifest is independent of the
 * machine it was made on and tools/verify-manifest.cjs can check any checkout against it.
 * Rule sets that are not shipped (PEPPOL-*, no redistribution licence) are recorded under `localOnly`.
 *
 * Usage: node tools/make-manifest.cjs <ext-dir> [out.json]
 *   <ext-dir>  the sources at their versions, as prepared by node tools/fetch-sources.cjs <ext-dir> (repository
 *              names = logical names); the merged XRechnung Schematron must exist (sh tools/merge-xrechnung-sch.sh)
 *   out.json   default build/STANDARDS_MANIFEST.json
 * The Saxon-HE repository (only the release zip is fetched) is recorded from <ext-dir>/Saxon-HE when present,
 * otherwise its entry is kept from the current manifest; the pin of tools/fetch-sources.cjs governs the download.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const size = (f) => fs.statSync(f).size;
function git(dir, args) { try { return execSync('git ' + args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return null; } }
function repoInfo(dir) {
  return { path: dir, remote: git(dir, 'config --get remote.origin.url'), commit: git(dir, 'rev-parse HEAD'), describe: git(dir, 'describe --tags --always'), commitDate: git(dir, 'log -1 --format=%cI') };
}
function fileEntry(f) { return { file: f, sha256: sha(f), bytes: size(f) }; }

const ext = path.resolve(process.argv[2] || path.join(root, 'ext'));
if (!fs.existsSync(path.join(ext, 'einvoicing-en16931'))) { console.error('make-manifest: ' + ext + ' does not contain the sources (node tools/fetch-sources.cjs ' + ext + ')'); process.exit(2); }
const E = (name) => path.join(ext, name);
const previous = fs.existsSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8')) : null;
// absolute path -> logical path ('<repository>/<path>' below <ext-dir>, '<path>' inside this repository)
function logical(p) {
  const inExt = path.relative(ext, p);
  if (!inExt.startsWith('..') && !path.isAbsolute(inExt)) return inExt.split(path.sep).join('/');
  const inRoot = path.relative(root, p);
  if (!inRoot.startsWith('..') && !path.isAbsolute(inRoot)) return inRoot.split(path.sep).join('/');
  throw new Error('no logical name for ' + p);
}
// Saxon-HE: tools/fetch-sources.cjs takes only the release zip from the repository; its commit metadata is recorded
// from a clone at <ext-dir>/Saxon-HE when present, otherwise kept from the current manifest
function saxonRepo() {
  if (fs.existsSync(path.join(E('Saxon-HE'), '.git'))) return repoInfo(E('Saxon-HE'));
  const key = Object.keys((previous && previous.sources) || {}).find((k) => /^Saxon HE 12\.8/.test(k));
  if (!key || !previous.sources[key].repo) throw new Error('make-manifest: no Saxon-HE clone in ' + ext + ' and no recorded entry');
  return Object.assign({}, previous.sources[key].repo, { path: E('Saxon-HE') });
}
function relativize(o) {
  if (Array.isArray(o)) return o.map(relativize);
  if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = (k === 'file' || k === 'path') && typeof v === 'string' && v.startsWith('/') ? logical(v) : relativize(v); return r; }
  return o;
}
const sources = {
  'CEN eInvoicing-EN16931 (validation artefacts 1.3.16)': Object.assign(repoInfo(E('einvoicing-en16931')), {
    licence: 'EUPL-1.2',
    files: [
      E('einvoicing-en16931') + '/ubl/schematron/preprocessed/EN16931-UBL-validation-preprocessed.sch',
      E('einvoicing-en16931') + '/cii/schematron/preprocessed/EN16931-CII-validation-preprocessed.sch',
      E('einvoicing-en16931') + '/ubl/xslt/EN16931-UBL-validation.xslt',
      E('einvoicing-en16931') + '/cii/xslt/EN16931-CII-validation.xslt',
    ].map(fileEntry),
  }),
  'KoSIT xrechnung-schematron (v2.6.0)': Object.assign(repoInfo(E('xrechnung-schematron')), {
    licence: 'Apache-2.0',
    files: [
      E('xrechnung-schematron') + '/src/validation/schematron/common.sch',
      E('xrechnung-schematron') + '/src/validation/schematron/ubl/XRechnung-UBL-validation.sch',
      E('xrechnung-schematron') + '/src/validation/schematron/cii/XRechnung-CII-validation.sch',
      E('xrechnung-schematron') + '/src/xsl/peppol-into-xr.xsl',
      E('xrechnung-schematron') + '/src/xsl/rule-list.xml',
    ].map(fileEntry),
    merged: [
      E('xrechnung-schematron') + '/build/schematron/ubl/XRechnung-UBL-validation.sch',
      E('xrechnung-schematron') + '/build/schematron/cii/XRechnung-CII-validation.sch',
    ].map(fileEntry),
    note: 'merged = result of the official build step peppol-into-xr.xsl (Saxon HE 12.8) which integrates the whitelisted Peppol BIS Billing rules; this is what the KoSIT validator configuration ships.',
  }),
  'OpenPeppol peppol-bis-invoice-3 (branch 2026-Q2-QA2, used by KoSIT as "3.0.21")': Object.assign(repoInfo(E('peppol-bis-invoice-3')), {
    licence: 'no licence file in the repository; the BIS document forbids redistribution without consent of OpenPeppol AISBL — compiled only locally for the test suites, not redistributed (docs/RULESETS.md section 5)',
    files: [
      E('peppol-bis-invoice-3') + '/rules/sch/PEPPOL-EN16931-UBL.sch',
      E('peppol-bis-invoice-3') + '/rules/sch/PEPPOL-EN16931-CII.sch',
    ].map(fileEntry),
    note: 'KoSIT build.xml 2.6.0 downloads these two files from the branch head because tag v3.0.21 did not exist at release time; the branch may move — the commit recorded here is what was used.',
  }),
  'KoSIT validator-configuration-xrechnung (2026-08-31)': Object.assign(repoInfo(E('validator-configuration-xrechnung')), {
    licence: 'Apache-2.0',
    files: [
      E('validator-configuration-xrechnung') + '/scenarios.xml',
      E('validator-configuration-xrechnung') + '/src/default-report.xsl',
      E('validator-configuration-xrechnung') + '/src/xrechnung-report.xsl',
    ].map(fileEntry),
  }),
  'KoSIT validator (source, for behaviour reference only)': Object.assign(repoInfo(E('validator')), { licence: 'Apache-2.0' }),
  'KoSIT xrechnung-testsuite (test corpus)': Object.assign(repoInfo(E('xrechnung-testsuite')), { licence: 'Apache-2.0' }),
  'ZUGFeRD corpus (PDF test corpus)': Object.assign(repoInfo(E('zugferd-corpus')), { licence: 'Apache-2.0' }),
  'fontoxpath (XPath 3.1 engine, built from source + Prüfer patch: exact decimals, document index, path rewrites)': Object.assign(repoInfo(E('fontoxpath')), { licence: 'MIT', patch: fileEntry(path.join(root, 'patches', 'fontoxpath-pruefer.patch')) }),
  'slimdom (DOM for Node tests)': Object.assign(repoInfo(E('slimdom.js')), { licence: 'MIT' }),
  'xspattern (+ patches/xspattern-pruefer.patch: \\p{Cn}) / whynot / prsc (fontoxpath dependencies)': { repos: ['xspattern.js', 'whynot.js', 'prsc.js'].map((r) => repoInfo(E(r))), licence: 'MIT' },
  'Saxon HE 12.8 (reference engine for parity tests only, not shipped)': { source: 'https://github.com/Saxonica/Saxon-HE (12/Java/SaxonHE12-8J.zip)', repo: saxonRepo(), sha256: '2ba851aec7925b882208182c48c936230205d558e335636bbe46626bd8003598', jar: fileEntry(E('saxon') + '/saxon-he-12.8.jar'), licence: 'MPL-2.0' },
  'ISO Schematron XSLT2 skeleton 2010-07-10 (via phax/ph-schematron; reference compilation only)': Object.assign(repoInfo(E('ph-schematron')), { licence: 'MIT (skeleton) / Apache-2.0 (ph-schematron)' }),
  'OASIS UBL 2.1 (os-UBL-2.1, xsdrt; from phax/ph-ubl docs/UBL-2.1.zip) — XSD validation': Object.assign(repoInfo(E('ph-ubl')), {
    licence: 'OASIS IPR Policy (RF on Limited Terms); schemas freely usable, see os-UBL-2.1 package',
    archive: fileEntry(E('ph-ubl') + '/docs/UBL-2.1.zip'),
    files: xsdSources(['UBL-Invoice-2.1.json', 'UBL-CreditNote-2.1.json']),
    note: 'the XSDs unpacked under ph-ubl21/src/main/resources are an incomplete CS1 generation (no CCTS/xmldsig/XAdES files); the complete OASIS package from docs/UBL-2.1.zip is used, xsdrt variant as in the KoSIT build.',
  }),
  'UN/CEFACT CII D16B (from phax/ph-cii) — XSD validation': Object.assign(repoInfo(E('ph-cii')), {
    licence: 'UN/CEFACT (UNECE) — published for free use',
    files: xsdSources(['CII-D16B.json']),
  }),
  'Mustangproject ("ZF_250" = Factur-X 1.09.2 / ZUGFeRD 2.5.2 Schematron, code DBs and XSDs)': Object.assign(repoInfo(E('mustangproject')), {
    licence: 'Mustangproject: Apache-2.0 (LICENSE; pom.xml <licenses>; validator/README.md "Permissive Open Source APL2, see LICENSE"). The ZF_250 Schematron/codedb files carry only "Factur-X release metadata Version: 1.09.2, Release date: 2026-08-04, Effective date: 2026-09-01", the XSDs no header at all; neither the files, their directories, LICENSE nor NOTICE state licence terms of FNFE-MPE / FeRD (the publishers of the Factur-X / ZUGFeRD specification). Separate terms of FNFE-MPE/FeRD are not contained in the repository - see docs/RULESETS.md section 5.',
    version: 'Factur-X 1.09.2 / ZUGFeRD 2.5.2 (History.md 2.25.0, 2026-08-04: "#1216 ZUGFeRD 2.5.2 and Factur-X 1.09.2")',
    release: (() => { const tag = 'core-2.26.0'; const d = git(E('mustangproject'), 'diff --stat ' + tag + ' HEAD -- validator/src/main/resources/schematron/ZF_250 validator/src/main/resources/schema/ZF_250');
      return { tag, commit: git(E('mustangproject'), 'rev-list -n1 ' + tag), zf250IdenticalToPin: d === '', check: 'git diff --stat ' + tag + ' <commit> -- validator/src/main/resources/schematron/ZF_250 validator/src/main/resources/schema/ZF_250 (empty = identical)',
        note: 'the pinned commit is a master commit after the release; the consumed ZF_250 rule and schema files are identical to the release tag, the newer commit is pinned for the validator test sources cited by test/run-pdfa3-tests.cjs' }; })(),
    files: ruleSources(/^FACTUR-X-/).concat(xsdSources(fs.existsSync(path.join(root, 'build', 'xsd')) ? fs.readdirSync(path.join(root, 'build', 'xsd')).filter((f) => /^FACTUR-X-/.test(f)) : [])),
  }),
  'Release artefacts (fetched by tools/fetch-sources.cjs, SHA-256 checked before use; local runs and CI)': {
    artefacts: [
      { name: 'KoSIT validator 1.6.3 (standalone JAR, contains Saxon HE 12.9)', url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar', sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9', licence: 'Apache-2.0', alsoOn: 'Maven Central org.kosit:validator:1.6.3:jar:standalone (CI job kosit-jar-maven compares both byte by byte)' },
      { name: 'KoSIT XRechnung configuration release v2026-08-31 (rule XSLTs compiled by KoSIT with SchXslt 1.10.1)', url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip', sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8', licence: 'Apache-2.0' },
      { name: 'Saxon HE 12.8 (SaxonHE12-8J.zip)', git: 'https://github.com/Saxonica/Saxon-HE.git#45924081b69cabf8e55baafcfb1833f7c544b823:12/Java/SaxonHE12-8J.zip', sha256: '2ba851aec7925b882208182c48c936230205d558e335636bbe46626bd8003598', licence: 'MPL-2.0' },
    ],
    ciOnly: [
      { name: 'veraPDF 1.30.3 (org.verapdf:validation-model-jakarta, Maven Central; CI job pdfa-verapdf, checksums verified by mvn -C and the .sha1 of the main jar)', licence: 'GPL-3.0-or-later / MPL-2.0' },
    ],
    integrity: 'tools/fetch-sources.cjs refuses any artefact whose SHA-256 differs from the value above and records URL, SHA-256 and size of every download in <ext-dir>/DOWNLOADS.txt.',
  },
};

function xsdSources(models) {
  const out = [];
  for (const m of models) {
    const f = path.join(root, 'build', 'xsd', m);
    if (!fs.existsSync(f)) continue;
    for (const s of JSON.parse(fs.readFileSync(f, 'utf8')).sources || []) {
      if (!s.path) continue;
      const file = path.join(ext, s.path); // '<repository>/<path>' below <ext-dir>
      if (!out.some((o) => o.file === file)) out.push({ file, sha256: s.sha256, bytes: s.bytes });
    }
  }
  return out;
}
function ruleSources(re) {
  const out = [];
  for (const m of fs.readdirSync(path.join(root, 'build', 'schemas')).filter((f) => re.test(f))) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', m), 'utf8'));
    const mainDir = j.sources && j.sources[0] ? path.posix.dirname(j.sources[0].file) : null;
    for (const s of (j.sources || []).concat((j.documents || []).map((d) => Object.assign({ file: mainDir + '/' + d.href }, d)))) {
      // sources are recorded as '<repository>/<path>' below <ext-dir>; document() files (code lists) lie next to the main schema
      const file = s.file ? path.join(ext, s.file) : null;
      if (file && !out.some((o) => o.file === file)) out.push({ file, sha256: s.sha256, bytes: s.bytes });
    }
  }
  return out;
}

const derived = {};
const localOnly = {};
for (const f of fs.readdirSync(path.join(root, 'build', 'schemas'))) (/^PEPPOL-/.test(f) ? localOnly : derived)[f] = fileEntry(path.join(root, 'build', 'schemas', f));
derived['scenarios.json'] = fileEntry(path.join(root, 'build', 'scenarios.json'));
if (fs.existsSync(path.join(root, 'build', 'rulesets.json'))) derived['rulesets.json'] = fileEntry(path.join(root, 'build', 'rulesets.json'));
if (fs.existsSync(path.join(root, 'build', 'xsd'))) for (const f of fs.readdirSync(path.join(root, 'build', 'xsd'))) derived['xsd/' + f] = fileEntry(path.join(root, 'build', 'xsd', f));
for (const f of ['fontoxpath.iife.js', 'fontoxpath.iife.min.js', 'fontoxpath.cjs', 'slimdom.cjs']) if (fs.existsSync(path.join(root, 'vendor', f))) derived[f] = fileEntry(path.join(root, 'vendor', f));

const manifest = relativize({ generated: new Date().toISOString(), generator: 'tools/make-manifest.cjs', sources, derived,
  localOnly: Object.assign({ note: 'compiled only for the test suites, not part of the repository or the build (no redistribution licence, docs/RULESETS.md)' }, localOnly) });
const out = process.argv[3] || path.join(root, 'build', 'STANDARDS_MANIFEST.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log('manifest -> ' + out);
