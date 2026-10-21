#!/usr/bin/env node
/*
 * compare-verapdf.cjs — compares veraPDF's verdicts with the container checks of src/pdfa3-checks.js
 * for the rules both cover (encryption, trailer ID, file header, XMP pdfaid identification, XMP
 * metadata in the catalog, XMP extension schemas, embedded files: F/UF, AFRelationship, Subtype
 * (MIME type), Params/ModDate, association via AF).
 *
 * The comparison needs the veraPDF library (org.verapdf:validation-model-jakarta 1.30.3 from Maven Central,
 * run by tools/verapdf/VeraMrr.java); it runs in the CI job "pdfa-verapdf" of .github/workflows/verify.yml.
 * Without veraPDF only `--selftest` (parser + classification on a synthetic report) runs.
 *
 * Input format: veraPDF machine-readable report (MRR, `--format mrr`): report/jobs/job/{item/name,
 * validationReport[@isCompliant,@profileName]/details/rule[@clause,@testNumber,@status,
 * @specification]/{description,object,test,check}}, report/batchSummary[@encrypted,@failedToParse].
 * Written against the MRR structure as Mustang embeds it (Mustang PDFValidator.java l. 125-132 writes
 * FormatOption.MRR; doc/mustang-validation.xsd l. 57-195 describes report, job, item, validationReport,
 * details, rule, check, batchSummary). Jobs without validationReport (parse failure, encryption) are
 * recorded via taskException / batchSummary.
 *
 * Usage:
 *   node test/compare-verapdf.cjs --mrr build/verapdf/mrr-3b.xml --ours build/pdfa3-results.json [--extra build/verapdf/mrr-3u.xml ...] [--out build/reports/verapdf-compare.txt]
 *   node test/compare-verapdf.cjs --flavour-lists <dir> --ours build/pdfa3-results.json --root <corpus>   (writes <dir>/3b.list = all PDFs, 3u.list / 3a.list = PDFs whose XMP claims PDF/A-3U / -3A; NUL-separated)
 *   node test/compare-verapdf.cjs --selftest
 * Exit code 1 if a rule pair marked 'exact' or 'ours-implies-vera' disagrees.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseXml } = require(path.join(__dirname, '..', 'src', 'pdfa3-checks.js'))._internal;

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const optAll = (n) => args.reduce((a, x, i) => (x === n && args[i + 1] ? a.concat([args[i + 1]]) : a), []);

/*
 * Rule pairs. `match(rule)` selects failed veraPDF rules (clause + words of test/description/object);
 * `ours` = check ids whose findings of the given levels count as "our failure".
 * mode: exact              — both must agree in both directions
 *       ours-implies-vera  — our failure must be confirmed by veraPDF (veraPDF covers more, e.g. all namespaces)
 *       vera-implies-ours  — a veraPDF failure must be found by us (we are stricter, e.g. AFRelationship of the invoice)
 *       report             — listed only (it is not known whether ISO 19005-3 / veraPDF has the rule)
 */
const txt = (r) => (r.test + ' ' + r.description + ' ' + r.object);
const PAIRS = [
  { id: 'encryption', mode: 'exact', ours: ['PDFA3-ENCRYPT'], levels: ['error'], match: (r) => r.clause === '6.1.3' && /encrypt/i.test(txt(r)), job: (j) => j.encrypted },
  { id: 'trailer-id', mode: 'exact', ours: ['PDFA3-TRAILER-ID'], levels: ['error'], match: (r) => r.clause === '6.1.3' && /\bID\b|\bID_|trailer.*identifier|file identifier/i.test(txt(r)) && !/encrypt/i.test(txt(r)) },
  { id: 'file-header', mode: 'exact', ours: ['PDFA3-HEADER', 'PDFA3-HEADER-BINARY'], levels: ['error'], match: (r) => r.clause === '6.1.2' },
  { id: 'pdfaid', mode: 'ours-implies-vera', ours: ['PDFA3-PDFAID-PART', 'PDFA3-PDFAID-CONFORMANCE'], levels: ['error'], match: (r) => r.clause === '6.6.4' },
  { id: 'xmp-in-catalog', mode: 'ours-implies-vera', ours: ['PDFA3-XMP-CATALOG'], levels: ['error'], match: (r) => r.clause === '6.6.2.1' || (/^6\.6/.test(r.clause) && r.clause !== '6.6.4' && /metadata/i.test(txt(r))), job: (j) => j.parseFailed },
  { id: 'xmp-extension-schema', mode: 'ours-implies-vera', ours: ['FX-XMP-EXTENSION-SCHEMA'], levels: ['error'], match: (r) => /^6\.6\.2\.3/.test(r.clause) },
  { id: 'filespec-F-UF', mode: 'exact', ours: ['PDFA3-FILESPEC-F-UF'], levels: ['error'], match: (r) => r.clause === '6.8' && /\bUF\b|containsUF|containsF\b/.test(txt(r)) },
  { id: 'afrelationship', mode: 'vera-implies-ours', ours: ['PDFA3-AFRELATIONSHIP'], levels: ['error'], match: (r) => r.clause === '6.8' && /AFRelationship/.test(txt(r)) },
  { id: 'embedded-file-mime', mode: 'exact', ours: ['PDFA3-EF-SUBTYPE'], levels: ['error'], match: (r) => r.clause === '6.8' && /Subtype|MIME/i.test(txt(r)) },
  { id: 'embedded-file-moddate', mode: 'report', ours: ['PDFA3-EF-PARAMS-MODDATE'], levels: ['warning'], match: (r) => r.clause === '6.8' && /ModDate|Params/.test(txt(r)) },
  { id: 'associated-files', mode: 'report', ours: ['PDFA3-AF-CATALOG', 'PDFA3-NAMETREE'], levels: ['error', 'warning'], match: (r) => r.clause === '6.8' && /\bAF\b|associat/i.test(txt(r)) && !/AFRelationship/.test(txt(r)) },
  // active content (test/active-pdfs.cjs adds synthetic PDFs to the corpus of this comparison): ISO 19005-3 6.5.1 actions,
  // 6.5.2 / 6.4.1 additional actions and widget/field actions; document JavaScript (name tree) has no veraPDF rule
  { id: 'actions', mode: 'exact', ours: ['PDFA3-ACTIONS'], levels: ['error'], match: (r) => r.clause === '6.5.1' },
  { id: 'additional-actions', mode: 'exact', ours: ['PDFA3-AA'], levels: ['error'], match: (r) => r.clause === '6.5.2' || r.clause === '6.4.1' },
  { id: 'document-javascript', mode: 'report', ours: ['PDF-JAVASCRIPT'], levels: ['error'], match: () => false },
];

function* desc(el) { for (const c of el.children) { yield c; yield* desc(c); } }
const child = (el, name) => el.children.find((c) => c.local === name) || null;
const text = (el) => { if (!el) return ''; let s = el.text; for (const c of el.children) s += text(c); return s.trim(); };
const attr = (el, name) => { const a = el && el.attrs.find((x) => x.local === name); return a ? a.value : null; };

/** MRR -> [{ name, profile, compliant, failedRules: [{clause, testNumber, specification, description, object, test, failedChecks}], encrypted, parseFailed, exception }] */
function parseMrr(xmlText) {
  const doc = parseXml(xmlText);
  const jobs = [];
  for (const job of desc(doc)) {
    if (job.local !== 'job') continue;
    const item = child(job, 'item');
    const vr = child(job, 'validationReport');
    const exc = Array.from(desc(job)).find((e) => e.local === 'taskException' || e.local === 'exceptionMessage');
    const j = { name: text(item ? child(item, 'name') : null), profile: attr(vr, 'profileName'), compliant: vr ? attr(vr, 'isCompliant') === 'true' : null, failedRules: [], exception: exc ? (attr(exc, 'type') || '') + ' ' + text(exc) : null };
    if (vr) {
      for (const rule of desc(vr)) {
        if (rule.local !== 'rule' || attr(rule, 'status') !== 'failed') continue;
        j.failedRules.push({ clause: attr(rule, 'clause'), testNumber: attr(rule, 'testNumber'), specification: attr(rule, 'specification'), description: text(child(rule, 'description')), object: text(child(rule, 'object')), test: text(child(rule, 'test')), failedChecks: parseInt(attr(rule, 'failedChecks') || '0', 10) });
      }
    }
    j.encrypted = !!(j.exception && /encrypt/i.test(j.exception));
    j.parseFailed = !vr && !j.encrypted;
    jobs.push(j);
  }
  const bs = Array.from(desc(doc)).find((e) => e.local === 'batchSummary');
  return { jobs, summary: bs ? { totalJobs: attr(bs, 'totalJobs'), encrypted: attr(bs, 'encrypted'), failedToParse: attr(bs, 'failedToParse') } : null };
}

/** map an MRR item name (absolute, ./relative, ...) to a key of our results by the longest path suffix */
function keyFor(name, keys) {
  const n = name.replace(/\\/g, '/');
  let best = null;
  for (const k of keys) if ((n === k || n.endsWith('/' + k)) && (!best || k.length > best.length)) best = k;
  return best;
}

function compare(mrr, ours) {
  const keys = Object.keys(ours.corpus);
  const out = { pairs: {}, unmatchedJobs: [], missingJobs: [], unmappedFailures: {}, compliant: 0, nonCompliant: 0, disagreements: 0 };
  for (const p of PAIRS) out.pairs[p.id] = { mode: p.mode, both: 0, neither: 0, onlyVera: [], onlyOurs: [], rules: new Set() };
  const seen = new Set();
  for (const j of mrr.jobs) {
    const k = keyFor(j.name, keys);
    if (!k) { out.unmatchedJobs.push(j.name); continue; }
    seen.add(k);
    if (j.compliant) out.compliant++; else out.nonCompliant++;
    const res = ours.corpus[k].results;
    const mapped = new Set();
    for (const p of PAIRS) {
      const vr = j.failedRules.filter(p.match);
      vr.forEach((r) => { mapped.add(r); out.pairs[p.id].rules.add(r.specification + ' ' + r.clause + '-' + r.testNumber); });
      const vera = vr.length > 0 || (p.job ? !!p.job(j) : false);
      const our = res.some((x) => p.ours.includes(x.id) && p.levels.includes(x.level));
      const s = out.pairs[p.id];
      if (vera && our) s.both++;
      else if (!vera && !our) s.neither++;
      else if (vera) s.onlyVera.push(k + ' [' + vr.map((r) => r.clause + '-' + r.testNumber).join(', ') + ']');
      else s.onlyOurs.push(k + ' [' + res.filter((x) => p.ours.includes(x.id)).map((x) => x.level + ' ' + x.id).join(', ') + ']');
    }
    for (const r of j.failedRules) if (!mapped.has(r)) { const c = r.specification + ' ' + r.clause + '-' + r.testNumber; out.unmappedFailures[c] = (out.unmappedFailures[c] || 0) + 1; }
  }
  for (const k of keys) if (!seen.has(k)) out.missingJobs.push(k);
  for (const [id, s] of Object.entries(out.pairs)) {
    const bad = s.mode === 'exact' ? s.onlyVera.length + s.onlyOurs.length : s.mode === 'ours-implies-vera' ? s.onlyOurs.length : s.mode === 'vera-implies-ours' ? s.onlyVera.length : 0;
    s.disagreements = bad;
    out.disagreements += bad;
  }
  return out;
}

function render(cmp, label) {
  const L = [];
  L.push('veraPDF vs. container checks — ' + label);
  L.push('veraPDF: ' + cmp.compliant + ' compliant, ' + cmp.nonCompliant + ' non-compliant; jobs without counterpart: ' + cmp.unmatchedJobs.length + '; our PDFs without veraPDF job: ' + cmp.missingJobs.length);
  for (const [id, s] of Object.entries(cmp.pairs)) {
    L.push('  ' + id.padEnd(24) + ' ' + s.mode.padEnd(18) + ' both fail ' + String(s.both).padStart(3) + ', both pass ' + String(s.neither).padStart(3) + ', only veraPDF ' + String(s.onlyVera.length).padStart(3) + ', only ours ' + String(s.onlyOurs.length).padStart(3) + (s.disagreements ? '  <-- ' + s.disagreements + ' DISAGREEMENT(S)' : '') + (s.rules.size ? '  veraPDF rules: ' + Array.from(s.rules).sort().join(', ') : ''));
    for (const x of s.onlyVera) L.push('      only veraPDF: ' + x);
    for (const x of s.onlyOurs) L.push('      only ours:    ' + x);
  }
  const um = Object.entries(cmp.unmappedFailures).sort((a, b) => b[1] - a[1]);
  L.push('  veraPDF failures outside the container checks (fonts, colour, ... — not decidable without a PDF/A validator): ' + um.length + ' rules');
  for (const [r, n] of um) L.push('      ' + r + ': ' + n + ' PDF(s)');
  for (const x of cmp.unmatchedJobs) L.push('  unmatched veraPDF job: ' + x);
  for (const x of cmp.missingJobs) L.push('  no veraPDF job for: ' + x);
  L.push('veraPDF comparison (' + label + '): ' + cmp.disagreements + ' disagreements in ' + Object.keys(cmp.pairs).length + ' rule pairs, ' + (cmp.compliant + cmp.nonCompliant) + ' PDFs');
  return L.join('\n');
}

function selftest() {
  // synthetic MRR following doc/mustang-validation.xsd l. 57-195 of Mustang
  const rule = (clause, n, test, d, obj) => `<rule specification="ISO 19005-3:2012" clause="${clause}" testNumber="${n}" status="failed" failedChecks="1"><description>${d}</description><object>${obj}</object><test>${test}</test><check status="failed"><context>root</context><errorMessage>x</errorMessage></check></rule>`;
  const job = (name, compliant, rules) => `<job><item size="1"><name>${name}</name></item><validationReport jobEndStatus="normal" profileName="PDF/A-3B validation profile" statement="s" isCompliant="${compliant}"><details passedRules="1" failedRules="${rules.length}" passedChecks="1" failedChecks="${rules.length}">${rules.join('')}</details></validationReport><duration start="1" finish="2">00:00:00.001</duration></job>`;
  const mrr = `<?xml version="1.0" encoding="utf-8"?><report><buildInformation><releaseDetails id="core" version="1.30.3" buildDate="2026-01-01T00:00:00Z"/></buildInformation><jobs>` +
    job('/w/ext/zugferd-corpus/a/ok.pdf', true, []) +
    job('./a/nouf.pdf', false, [rule('6.8', 2, 'containsF == true &amp;&amp; containsUF == true', 'The file specification dictionary for an embedded file shall contain the F and UF keys', 'CosFileSpecification'), rule('6.2.11.4.1', 1, 'fontFile_size != 0', 'font', 'PDFont')]) +
    job('a/hdr.pdf', false, [rule('6.1.2', 1, 'headerOffset == 0', 'header', 'CosDocument')]) +
    `<job><item size="1"><name>a/enc.pdf</name></item><taskException type="PARSE" isExecuted="true" isSuccess="false"><exceptionMessage>The PDF file is encrypted</exceptionMessage></taskException></job>` +
    job('a/afrel.pdf', false, [rule('6.8', 3, 'AFRelationship != null', 'AFRelationship required', 'CosFileSpecification')]) +
    `</jobs><batchSummary totalJobs="5" failedToParse="0" encrypted="1" outOfMemory="0" veraExceptions="0"><validationReports compliant="1" nonCompliant="3" failedJobs="1">4</validationReports><featureReports failedJobs="0">0</featureReports><repairReports failedJobs="0">0</repairReports><duration start="1" finish="2">x</duration></batchSummary></report>`;
  const R = (id, level) => ({ id, level });
  const ours = { corpus: {
    'a/ok.pdf': { results: [R('PDFA3-FULL-VALIDATION', 'info')] },
    'a/nouf.pdf': { results: [R('PDFA3-FILESPEC-F-UF', 'error')] },
    'a/hdr.pdf': { results: [R('PDFA3-HEADER-BINARY', 'error')] },
    'a/enc.pdf': { results: [R('PDFA3-ENCRYPT', 'error')] },
    'a/afrel.pdf': { results: [] }, // veraPDF finds AFRelationship missing, we do not -> must be a disagreement (vera-implies-ours)
    'a/extra.pdf': { results: [R('PDFA3-AFRELATIONSHIP', 'error')] }, // no veraPDF job
  } };
  const m = parseMrr(mrr);
  const c = compare(m, ours);
  const checks = [
    ['5 jobs parsed', m.jobs.length === 5],
    ['batchSummary encrypted=1', m.summary && m.summary.encrypted === '1'],
    ['F/UF both', c.pairs['filespec-F-UF'].both === 1],
    ['header both', c.pairs['file-header'].both === 1],
    ['encryption both (taskException)', c.pairs.encryption.both === 1],
    ['afrelationship only veraPDF -> disagreement', c.pairs.afrelationship.onlyVera.length === 1 && c.pairs.afrelationship.disagreements === 1],
    ['font rule unmapped', c.unmappedFailures['ISO 19005-3:2012 6.2.11.4.1-1'] === 1],
    ['missing job listed', c.missingJobs.length === 1 && c.missingJobs[0] === 'a/extra.pdf'],
    ['total disagreements = 1', c.disagreements === 1],
  ];
  let bad = 0;
  for (const [n, ok] of checks) { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + n); }
  console.log(render(c, 'selftest').split('\n').map((l) => '  | ' + l).join('\n'));
  console.log(`compare-verapdf selftest: ${checks.length - bad}/${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}

if (args.includes('--selftest')) selftest();
else if (opt('--flavour-lists')) {
  const ours = JSON.parse(fs.readFileSync(opt('--ours'), 'utf8'));
  const dir = opt('--flavour-lists'), root = opt('--root') || '.';
  fs.mkdirSync(dir, { recursive: true });
  const lists = { '3b': [], '3u': [], '3a': [] };
  // keys "<extra-root-name>/<file>" (test/run-pdfa3-tests.cjs Part 4: build/corpus/active-content) live outside the corpus
  const extra = ours.extraRoots || {};
  const fileOf = (k) => { const top = k.split('/')[0]; return extra[top] ? path.join(extra[top], k.slice(top.length + 1)) : path.join(root, k); };
  for (const [k, v] of Object.entries(ours.corpus)) {
    lists['3b'].push(fileOf(k)); // every PDF is validated as PDF/A-3B (the minimum ZUGFeRD/Factur-X requires)
    const c = v.facts && v.facts.pdfaid && v.facts.pdfaid.part === '3' ? String(v.facts.pdfaid.conformance || '').toLowerCase() : '';
    if (c === 'u' || c === 'a') lists['3' + c].push(fileOf(k));
  }
  for (const [f, l] of Object.entries(lists)) { fs.writeFileSync(path.join(dir, f + '.list'), l.map((x) => x + '\0').join('')); console.log(f + ': ' + l.length + ' PDFs' + (f === '3b' ? ' (all)' : ' claim PDF/A-' + f.toUpperCase())); }
} else {
  const mrrFile = opt('--mrr'), oursFile = opt('--ours');
  if (!mrrFile || !oursFile) { console.error('usage: compare-verapdf.cjs --mrr <mrr.xml> --ours <pdfa3-results.json> [--extra <mrr.xml>...] [--out <file>] | --selftest'); process.exit(2); }
  const ours = JSON.parse(fs.readFileSync(oursFile, 'utf8'));
  const blocks = [];
  let dis = 0;
  for (const [i, f] of [mrrFile].concat(optAll('--extra')).entries()) {
    const m = parseMrr(fs.readFileSync(f, 'utf8'));
    if (i === 0) { const c = compare(m, ours); dis += c.disagreements; blocks.push(render(c, path.basename(f))); }
    else {
      // flavour-specific runs (3u / 3a) cover a subset; only the verdicts are listed
      const keys = Object.keys(ours.corpus);
      const lines = m.jobs.map((j) => '  ' + (j.compliant ? 'PASS ' : 'FAIL ') + (keyFor(j.name, keys) || j.name) + ' (' + (j.profile || j.exception || '?') + ')' + (j.compliant ? '' : ': ' + j.failedRules.map((r) => r.clause + '-' + r.testNumber).join(', ')));
      blocks.push('veraPDF ' + path.basename(f) + ': ' + m.jobs.filter((j) => j.compliant).length + '/' + m.jobs.length + ' compliant\n' + lines.join('\n'));
    }
  }
  const text = blocks.join('\n\n') + '\n';
  if (opt('--out')) { fs.mkdirSync(path.dirname(opt('--out')), { recursive: true }); fs.writeFileSync(opt('--out'), text); }
  process.stdout.write(text);
  process.exit(dis ? 1 : 0);
}
