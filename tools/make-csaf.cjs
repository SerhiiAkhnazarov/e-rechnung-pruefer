#!/usr/bin/env node
/*
 * make-csaf.cjs — the security advisories of the E-Rechnung Prüfer as OASIS CSAF 2.0 documents and their distribution
 * on the GitHub Pages site (CSAF 2.0 section 7; recommended by BSI TR-03183-2 3.1 / TR-03183-3 and the Austrian
 * national CVD policy):
 *
 *   .well-known/csaf/provider-metadata.json        provider metadata (requirement 7), role csaf_publisher
 *   .well-known/csaf/white/<year>/<file>.json      every CSAF document (TLP:WHITE, requirements 1-4, 11)
 *   .well-known/csaf/white/<year>/<file>.json.sha256 / .sha512   hashes (requirement 18)
 *   .well-known/csaf/white/index.txt, changes.csv  (requirements 12, 13)
 *   .well-known/csaf/white/index.html, <year>/index.html   static directory listings (requirement 14)
 *
 * Documents:
 *   - the security advisories written by hand in security/csaf/<year>/<file>.json (profile csaf_security_advisory);
 *   - the VEX document of the current version (profile csaf_vex), generated from security/vex.json – the same
 *     statements as vex.cdx.json (CycloneDX, tools/make-vex.cjs).
 * Every published file is written with its keys sorted (CSAF 2.0 test 6.2.13). File names follow CSAF 5.1. The
 * documents are checked by test/run-security-tests.cjs (official JSON schemas, mandatory tests of section 6.1).
 * Called by tools/build-standalone.cjs (into dist/site-pages); OpenPGP signatures (requirement 19) are not provided:
 * the manufacturer has no OpenPGP key (SECURITY.md); integrity: HTTPS, the hashes and the artifact attestation of the
 * Pages deployment.
 *
 * Usage: node tools/make-csaf.cjs <out-dir>   (reads security/, legal/security.json, dist/BUILD_INFO.json)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hash = (b, alg) => crypto.createHash(alg).update(b).digest('hex');
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {}) : v);
const stringify = (o) => JSON.stringify(sortKeys(o), null, 2) + '\n';
/** CSAF 2.0 section 5.1: tracking id in lowercase, every sequence of characters other than [+\-a-z0-9] replaced by "_" */
const fileName = (id) => id.toLowerCase().replace(/[^+\-a-z0-9]+/g, '_') + '.json';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const security = () => JSON.parse(read('legal/security.json'));
const csafBase = (sec) => sec.site + '.well-known/csaf/';
const directoryUrl = (sec) => csafBase(sec) + 'white/';
function publisher(sec) {
  return {
    category: 'vendor',
    contact_details: 'E-Mail: ' + sec.contactEmail + '; vertrauliche Meldungen: ' + sec.reportForm + '; Meldewege und Fristen: ' + sec.site + 'security-contact/',
    issuing_authority: 'Hersteller des E-Rechnung Prüfers (' + sec.manufacturer + ', natürliche Person, Wien, Österreich); Richtlinie zur koordinierten Offenlegung: ' + sec.site + 'cvd-policy/',
    name: sec.manufacturer,
    namespace: sec.site,
  };
}

// CycloneDX impactAnalysisJustification -> CSAF 2.0 VEX flag label (section 3.2.3.5)
const FLAG = {
  code_not_present: 'vulnerable_code_not_present',
  code_not_reachable: 'vulnerable_code_not_in_execute_path',
  protected_by_compiler: 'inline_mitigations_already_exist',
  protected_at_runtime: 'inline_mitigations_already_exist',
  protected_by_mitigating_control: 'inline_mitigations_already_exist',
  requires_environment: 'vulnerable_code_cannot_be_controlled_by_adversary',
};
// names of the CWE entries used (MITRE CWE list; CSAF test 6.1.11 compares id and name)
const CWE_NAMES = {
  20: 'Improper Input Validation',
  91: 'XML Injection (aka Blind XPath Injection)',
  112: 'Missing XML Validation',
  400: 'Uncontrolled Resource Consumption',
  835: "Loop with Unreachable Exit Condition ('Infinite Loop')",
  1236: 'Improper Neutralization of Formula Elements in a CSV File',
};

/** the CSAF VEX document of a version from security/vex.json (statements shared with vex.cdx.json) */
function vexDocument(vexSource, version, sec) {
  const revisions = (vexSource.csafRevisions || {})[version];
  if (!revisions || !revisions.length) throw new Error('make-csaf: security/vex.json has no csafRevisions for version ' + version);
  const latest = revisions[revisions.length - 1];
  const stated = vexSource.statements.map((s) => s.lastUpdated).sort().pop();
  if (stated > latest.date) throw new Error('make-csaf: a VEX statement was updated (' + stated + ') after the last CSAF revision of ' + version + ' (' + latest.date + '): add a revision to csafRevisions');
  const id = 'E-RECHNUNG-PRUEFER-VEX-' + version;
  const pid = 'CSAFPID-0001';
  const REPO = sec.repository;
  const doc = {
    document: {
      category: 'csaf_vex',
      csaf_version: '2.0',
      distribution: { text: 'Public, no restriction of redistribution.', tlp: { label: 'WHITE', url: 'https://www.first.org/tlp/' } },
      lang: 'en',
      notes: [
        { category: 'summary', title: 'Summary', text: 'Assessment of every known vulnerability of a component that E-Rechnung Prüfer ' + version + ' contains or derives from (pedigree in the SBOM). The same statements are published as CycloneDX VEX (vex.cdx.json) beside the SBOM (sbom.cdx.json).' },
        { category: 'legal_disclaimer', title: 'Disclaimer', text: 'Assessments as of the dates of the revision history, provided without warranty. E-Rechnung Prüfer is free software under the EUPL-1.2 (liability and warranty: articles 7 and 8 of the licence).' },
      ],
      publisher: publisher(sec),
      references: [
        { category: 'self', summary: 'Canonical URL of this document', url: directoryUrl(sec) + revisions[0].date.slice(0, 4) + '/' + fileName(id) },
        { category: 'external', summary: 'CycloneDX VEX of the current version', url: sec.site + 'vex.cdx.json' },
        { category: 'external', summary: 'Software bill of materials (CycloneDX 1.6, BSI TR-03183-2) of version ' + version, url: REPO + '/releases/download/v' + version + '/sbom.cdx.json' },
      ],
      title: 'E-Rechnung Prüfer ' + version + ': VEX (vulnerabilities of components the program derives from)',
      tracking: {
        current_release_date: latest.date,
        id,
        initial_release_date: revisions[0].date,
        revision_history: revisions.map((r) => ({ date: r.date, number: r.number, summary: r.summary })),
        status: 'final',
        version: latest.number,
      },
    },
    product_tree: { branches: [{ category: 'vendor', name: sec.manufacturer, branches: [{ category: 'product_name', name: 'E-Rechnung Prüfer', branches: [{ category: 'product_version', name: version,
      product: { name: 'E-Rechnung Prüfer ' + version, product_id: pid, product_identification_helper: { purl: 'pkg:github/serhiiakhnazarov/e-rechnung-pruefer@v' + version, sbom_urls: [REPO + '/releases/download/v' + version + '/sbom.cdx.json'] } } }] }] }] },
    vulnerabilities: vexSource.statements.map((s) => {
      const v = {};
      if (/^CVE-\d{4}-\d{4,}$/.test(s.id)) v.cve = s.id; else throw new Error('make-csaf: VEX statement without CVE id: ' + s.id);
      const ghsa = (s.aliases || []).filter((a) => /^GHSA-/.test(a));
      if (ghsa.length) v.ids = ghsa.map((a) => ({ system_name: 'GitHub Security Advisory Database', text: a }));
      if (s.cwes && s.cwes.length) { if (!CWE_NAMES[s.cwes[0]]) throw new Error('make-csaf: name of CWE-' + s.cwes[0] + ' unknown'); v.cwe = { id: 'CWE-' + s.cwes[0], name: CWE_NAMES[s.cwes[0]] }; }
      v.notes = [{ category: 'description', title: 'Description', text: s.description }];
      if (s.ancestor) v.notes.push({ category: 'details', title: 'Component', text: 'Concerns ' + s.ancestor + ', from which ' + s.affects.replace(/^file:/, '') + ' of the program derives (pedigree in the SBOM).' });
      v.references = [{ category: 'external', summary: 'NVD: ' + s.id, url: 'https://nvd.nist.gov/vuln/detail/' + s.id }]
        .concat((s.aliases || []).map((a) => (/^GHSA-/.test(a) ? { category: 'external', summary: 'GitHub Advisory Database: ' + a, url: 'https://github.com/advisories/' + a } : { category: 'external', summary: 'NVD: ' + a + ' (same flaw, other product)', url: 'https://nvd.nist.gov/vuln/detail/' + a })));
      if (s.state === 'not_affected') {
        const label = FLAG[s.justification];
        if (!label) throw new Error('make-csaf: no CSAF flag for the justification ' + s.justification);
        v.product_status = { known_not_affected: [pid] };
        v.flags = [{ date: s.lastUpdated, label, product_ids: [pid] }];
        v.threats = [{ category: 'impact', date: s.lastUpdated, details: s.detail, product_ids: [pid] }];
      } else if (s.state === 'in_triage') {
        v.product_status = { under_investigation: [pid] };
      } else if (s.state === 'exploitable') {
        if (!s.remediation) throw new Error('make-csaf: ' + s.id + ' is exploitable but has no remediation');
        v.product_status = { known_affected: [pid] };
        v.remediations = [{ category: s.remediation.category, details: s.remediation.details, product_ids: [pid] }];
        v.threats = [{ category: 'impact', details: s.detail, product_ids: [pid] }];
      } else if (s.state === 'resolved') {
        v.product_status = { fixed: [pid] };
      } else throw new Error('make-csaf: state ' + s.state + ' is not mapped to CSAF');
      return v;
    }),
  };
  return doc;
}

/** every CSAF document: the advisories of security/csaf/ and the VEX document of the version */
function documents(version) {
  const sec = security();
  const docs = [];
  const dir = path.join(root, 'security', 'csaf');
  if (fs.existsSync(dir)) {
    for (const year of fs.readdirSync(dir).filter((d) => /^\d{4}$/.test(d)).sort()) {
      for (const f of fs.readdirSync(path.join(dir, year)).filter((x) => x.endsWith('.json')).sort()) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, year, f), 'utf8'));
        const id = doc.document.tracking.id;
        if (fileName(id) !== f) throw new Error('make-csaf: security/csaf/' + year + '/' + f + ' must be named ' + fileName(id));
        if (doc.document.tracking.initial_release_date.slice(0, 4) !== year) throw new Error('make-csaf: ' + f + ' belongs in the folder of the year of its initial release date');
        docs.push({ source: 'security/csaf/' + year + '/' + f, year, file: f, doc });
      }
    }
  }
  const vex = vexDocument(JSON.parse(read('security/vex.json')), version, sec);
  docs.push({ source: 'security/vex.json', year: vex.document.tracking.initial_release_date.slice(0, 4), file: fileName(vex.document.tracking.id), doc: vex, generated: true });
  return docs;
}

function listing(title, entries, sec) {
  return '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; form-action \'none\'; base-uri \'none\'">\n<meta name="referrer" content="no-referrer">\n' +
    '<title>' + esc(title) + '</title>\n</head>\n<body>\n<h1>' + esc(title) + '</h1>\n<ul>\n' +
    entries.map((e) => '<li><a href="' + esc(e) + '">' + esc(e) + '</a></li>').join('\n') + '\n</ul>\n<p>CSAF 2.0, TLP:WHITE – ' + esc(sec.manufacturer) + ' (<a href="' + esc(sec.site + 'advisories/') + '">Sicherheitshinweise</a>)</p>\n</body>\n</html>\n';
}

/** writes the distribution below <outDir>/.well-known/csaf; returns { written: {path: sha256}, documents } */
function buildCsaf(outDir, info) {
  const sec = security();
  const docs = documents(info.version);
  const base = path.join(outDir, '.well-known', 'csaf');
  fs.rmSync(base, { recursive: true, force: true });
  const white = path.join(base, 'white');
  const written = {};
  const put = (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); written['.well-known/csaf/' + rel] = hash(text, 'sha256'); };
  const years = {};
  for (const d of docs) {
    const text = stringify(d.doc);
    d.text = text;
    put('white/' + d.year + '/' + d.file, text);
    put('white/' + d.year + '/' + d.file + '.sha256', hash(text, 'sha256') + '  ' + d.file + '\n');
    put('white/' + d.year + '/' + d.file + '.sha512', hash(text, 'sha512') + '  ' + d.file + '\n');
    (years[d.year] = years[d.year] || []).push(d.file);
  }
  const paths = docs.map((d) => d.year + '/' + d.file).sort();
  put('white/index.txt', paths.join('\n') + '\n');
  const changes = docs.slice().sort((a, b) => (a.doc.document.tracking.current_release_date < b.doc.document.tracking.current_release_date ? 1 : a.doc.document.tracking.current_release_date > b.doc.document.tracking.current_release_date ? -1 : (a.file < b.file ? -1 : 1)));
  put('white/changes.csv', changes.map((d) => '"' + d.year + '/' + d.file + '","' + d.doc.document.tracking.current_release_date + '"').join('\n') + '\n');
  put('white/index.html', listing('CSAF-Dokumente (TLP:WHITE)', Object.keys(years).sort().map((y) => y + '/').concat(['index.txt', 'changes.csv']), sec));
  for (const [y, files] of Object.entries(years)) put('white/' + y + '/index.html', listing('CSAF-Dokumente ' + y, files.sort().flatMap((f) => [f, f + '.sha256', f + '.sha512']), sec));
  const lastUpdated = docs.map((d) => d.doc.document.tracking.current_release_date).sort().pop();
  const metadata = {
    canonical_url: csafBase(sec) + 'provider-metadata.json',
    distributions: [{ directory_url: directoryUrl(sec) }],
    last_updated: lastUpdated,
    list_on_CSAF_aggregators: true,
    metadata_version: '2.0',
    mirror_on_CSAF_aggregators: true,
    publisher: publisher(sec),
    role: 'csaf_publisher',
  };
  put('provider-metadata.json', stringify(metadata));
  return { written, documents: docs, metadata };
}

module.exports = { buildCsaf, documents, vexDocument, fileName, sortKeys, stringify, publisher, CWE_NAMES, FLAG };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/make-csaf.cjs <out-dir>'); process.exit(2); }
  const info = JSON.parse(read('dist/BUILD_INFO.json'));
  const r = buildCsaf(path.resolve(out), info);
  for (const [f, h] of Object.entries(r.written)) console.log(f + ' sha256:' + h);
}
