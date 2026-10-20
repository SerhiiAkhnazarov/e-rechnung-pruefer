#!/usr/bin/env node
/*
 * verify-all.cjs — the one verification pipeline. Every test suite of the project runs through
 * here; each report is written with the fingerprint of the inputs it was produced from
 * (tools/fingerprint.cjs: standards manifest, engine patch and bundles, runtime, rule sets, XSD
 * models, test scripts, reference toolchain), and build/reports/VERIFICATION.json records per
 * suite: command, exit code, summary line, duration and the fingerprint id.
 *
 * A result is only valid for the fingerprint it carries; tools/verify-manifest.cjs --reports
 * refuses reports whose fingerprint differs from the current inputs.
 *
 * Usage: node tools/verify-all.cjs [--ext <dir>] [--only a,b] [--skip a,b] [--reuse-references] [--list]
 *   --ext <dir>  directory with all sources at their pinned versions, as prepared by
 *                node tools/fetch-sources.cjs <dir> (repository names = logical names of
 *                build/STANDARDS_MANIFEST.json). Default: ext (in the repository root, as in CI).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { compute } = require('./fingerprint.cjs');
const { hasBrowser } = require('../test/resolve-tool.cjs');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const reports = path.join(root, 'build', 'reports');

const ext = path.resolve(opt('--ext') || path.join(root, 'ext'));
if (!args.includes('--list') && !fs.existsSync(ext)) {
  console.error('verify-all: ' + ext + ' does not exist; run node tools/fetch-sources.cjs ' + path.relative(process.cwd(), ext) + ' first (or pass --ext <dir>)');
  process.exit(2);
}
const E = (n) => path.join(ext, n);
const node = process.execPath;

// documents of the browser end-to-end test: valid UBL/CII, a Schematron error, a ZUGFeRD PDF, a PDF with
// container findings (wrong attachment name), encoding errors and a non-UTF-8 document
const E2E_FILES = [
  E('xrechnung-testsuite') + '/src/test/technical-cases/cius/01.01_comprehensive_test_ubl.xml',
  E('xrechnung-testsuite') + '/src/test/technical-cases/cius/01.01_comprehensive_test_uncefact.xml',
  E('xrechnung-schematron') + '/test/instances/ubl-inv/ubl-inv-br-de-19-iban-tests.xml',
  E('zugferd-corpus') + '/ZUGFeRDv2/correct/symtrax/Beispiele/EN16931/zugferd_2p1_EN16931_Reisekostenabrechnung.pdf',
  E('zugferd-corpus') + '/ZUGFeRDv2/fail/Mustangproject/wrongFilename.pdf',
  'build/corpus/encoding/latin1-declared-utf8.xml',
  'build/corpus/encoding/cp1252-decl.xml',
  'build/corpus/encoding/utf16le-bom.xml',
];
// documents of the report tests (Node and browser): in addition an invoice with an embedded attachment (BG-24)
const REPORT_FILES = E2E_FILES.slice(0, 5).concat([E('xrechnung-testsuite') + '/src/test/business-cases/standard/02.03a-INVOICE_ubl.xml', 'build/corpus/encoding/latin1-declared-utf8.xml', 'build/corpus/encoding/utf16le-bom.xml']);
// name, command, report file, summary-line pattern; `needs` = paths that must exist;
// `browser` = Playwright engine that must be installed (no download is attempted)
const ESBUILD = process.env.ESBUILD_BINARY || [path.join(root, 'node_modules', '.bin', 'esbuild')].find((p) => fs.existsSync(p)) || 'esbuild';
const SH = (script) => ['sh', '-c', 'set -e; ' + script];
// a path inside such a script: quoted, with '/' on Windows (sh reads the backslashes of D:\a\x as escapes)
const Q = (p) => "'" + (process.platform === 'win32' ? p.replace(/\\/g, '/') : p).replace(/'/g, "'\\''") + "'";
const SUITES = [
  // ---- stage 1: reference results, regenerated from the pinned sources on every full run ----------
  // (independent engines: Saxon HE 12.8 for Schematron/XPath, JDK 21 Xerces for XSD and encodings;
  //  --reuse-references skips this stage for quick development runs and marks it 'not-run')
  { name: 'ref-corpus', reference: true, cmd: [node, 'test/build-corpus.cjs', '--xr', E('xrechnung-schematron'), '--cen', E('einvoicing-en16931'),
      '--extra', E('xrechnung-testsuite') + '/src/test', '--extra', E('validator-configuration-xrechnung') + '/src/test', '--peppol', E('peppol-bis-invoice-3'), '--zugferd', E('zugferd-corpus')], summary: /./ },
  { name: 'ref-schematron-xsl', reference: true, cmd: SH('rm -rf build/reference-xsl; sh test/kosit-reference/build-xrechnung-xsl.sh build/reference-xsl; sh test/build-oracle-xsl.sh build/reference-xsl; ls build/reference-xsl/*.xsl | wc -l | sed "s/^/reference stylesheets: /"'), summary: /^reference stylesheets/ },
  { name: 'ref-saxon-svrl', reference: true, cmd: ['sh', 'test/run-oracle.sh', E('saxon'), E('einvoicing-en16931'), 'build/reference-xsl'], summary: /./ },
  // the official KoSIT visualization stylesheets over the corpus (after ref-saxon-svrl, which empties build/oracle):
  // reference values of every business term (invoice model) and the syntax binding of build/bt-paths.json
  { name: 'ref-kosit-visualization', reference: true, cmd: ['sh', 'test/kosit-visualization/run.sh', E('saxon'), E('xrechnung-visualization')], summary: /^KoSIT visualization instances:/ },
  { name: 'ref-saxon-xpath', reference: true, cmd: SH(Q(node) + ' test/xpath-conformance/run-saxon.cjs ' + Q(E('saxon')) + '; ' + Q(node) + ' test/xpath-conformance/run-saxon-doc.cjs ' + Q(E('saxon')) + '; git diff --exit-code --stat -- test/xpath-conformance/expected.json test/xpath-conformance/expected-doc.json && echo "Saxon expectations reproduced byte-identically"'), summary: /evaluated by Saxon|reproduced/, all: true },
  { name: 'ref-xerces', reference: true, cmd: SH('sh test/xsd-oracle/run-xsd-oracle.sh; ' + Q(node) + ' test/build-xsd-mutations.cjs --zugferd ' + Q(E('zugferd-corpus')) + '; sh test/xsd-oracle/run-xsd-oracle.sh xsd-mutations build/corpus/xsd-mutations; sh test/xsd-oracle/run-facturx-xsd-oracle.sh; echo "Xerces reference: $(cat build/oracle/xsd/*.jsonl | wc -l) documents, Factur-X: $(cat build/oracle/xsd-facturx/*.jsonl | wc -l) validations"'), summary: /^Xerces reference/ },
  // ---- stage 2: the product against the references and the official test material ------------------
  { name: 'manifest', cmd: [node, 'tools/verify-manifest.cjs', ext], summary: /^manifest verification:/ },
  { name: 'engine-reproducible', cmd: ['sh', 'tools/check-engine.sh', ext, ESBUILD], summary: /^engine rebuild|applied cleanly/, all: true, needs: [E('fontoxpath')] },
  { name: 'build-reproducible', cmd: [node, 'tools/check-reproducible.cjs', ext], summary: /^reproducible build:/ },
  // the page that the browser suites open (dist/E-Rechnung-Pruefer.html) is built from the current sources first,
  // as in CI; the final page with the status line of this run is built after the run (tools/build-standalone.cjs)
  { name: 'page-build', cmd: [node, 'tools/build-standalone.cjs', '--version', changelogVersion()], summary: /SHA-256/ },
  { name: 'xpath-conformance', cmd: [node, 'test/xpath-conformance/run-fontoxpath.cjs'], summary: /^XPath conformance/ },
  { name: 'xpath-document', cmd: [node, 'test/xpath-conformance/run-fontoxpath-doc.cjs'], summary: /^XPath document battery/, all: true },
  { name: 'batch-compile', cmd: [node, 'test/check-batches.cjs'], summary: /^batches/ },
  { name: 'cen-unit-tests', cmd: [node, 'test/run-cen-tests.cjs', E('einvoicing-en16931')], summary: /^CEN unit tests:/ },
  { name: 'kosit-xmute-tests', cmd: [node, 'test/run-xmute-tests.cjs', E('xrechnung-schematron')], summary: /^XRechnung xmute tests:/ },
  { name: 'peppol-unit-tests', cmd: [node, 'test/run-peppol-tests.cjs', E('peppol-bis-invoice-3')], summary: /unit tests:/i, needs: ['build/schemas/PEPPOL-UBL.json'] },
  { name: 'facturx-corpus-tests', cmd: [node, 'test/run-facturx-tests.cjs'], summary: /^Factur-X corpus tests:/, needs: ['build/schemas/FACTUR-X-EN16931.json', 'build/rulesets.json', 'build/corpus/zugferd-cii', 'build/oracle/zugferd-cii'] },
  { name: 'facturx-xsd-vs-xerces', cmd: [node, 'test/run-facturx-xsd-tests.cjs'], summary: /^Factur-X XSD vs Xerces:/, needs: ['build/xsd/FACTUR-X-EN16931.json', 'build/oracle/xsd-facturx'] },
  { name: 'parity-saxon', cmd: [node, 'test/compare-oracle.cjs'], summary: /comparisons in .*mismatches/, needs: ['build/oracle'] },
  { name: 'pattern-matcher-selftest', cmd: [node, 'test/selftest-pattern-matcher.cjs'].concat(['xr-ubl', 'xr-cii', 'extra-ubl', 'extra-cii'].map((d) => 'build/corpus/' + d)), summary: /^pattern matcher self-test:/ },
  { name: 'xsd-vs-xerces', cmd: [node, 'test/run-xsd-tests.cjs'], summary: /^TOTAL/, all: true, needs: ['build/oracle/xsd'] },
  { name: 'xml-encoding', cmd: [node, 'test/run-encoding-tests.cjs'], summary: /^XML encoding tests:/ },
  // invoice data, VAT classification, files written, line numbers, checksums (0.3.0)
  { name: 'invoice-model-vs-kosit', cmd: [node, 'test/run-invoice-model-tests.cjs'], summary: /^invoice model vs KoSIT visualization:/, needs: ['build/oracle/xr'] },
  { name: 'vat-relevance', cmd: [node, 'test/run-vat-tests.cjs'], summary: /^corpus:|^VAT relevance tests:/, all: true },
  { name: 'reports', cmd: [node, 'test/run-reports-tests.cjs', ...REPORT_FILES], summary: /^readers:|^reports tests:/, all: true },
  { name: 'line-numbers-vs-expat', cmd: [node, 'test/run-line-tests.cjs'], summary: /^reference:|^line numbers vs expat:/, all: true },
  { name: 'sha256-vs-node-crypto', cmd: [node, 'test/run-sha256-tests.cjs'], summary: /^SHA-256/ },
  { name: 'xsd-selftest', cmd: [node, 'test/xsd-selftest.cjs'], summary: /^instances/ },
  ...browsers((b) => ({ name: 'xsd-browser-' + b, browser: b, cmd: [node, 'test/xsd-browser.cjs', '--browser', b], summary: /identical|differences/ })),
  { name: 'kosit-reference', cmd: [node, 'test/kosit-reference/verify.cjs'], summary: /configuration self-tests|MISMATCHES|fresh run/, all: true, needs: ['build/corpus/xr-ubl', E('saxon') + '/saxon-he-12.8.jar'] },
  { name: 'kosit-official', cmd: [node, 'test/kosit-official.cjs', E('kosit-official')], summary: /^verified|scenario:|xsd verdict:|messages:|configuration verdict|MISMATCHES/, all: true, needs: [E('kosit-official') + '/validator-1.6.3-standalone.jar', 'build/corpus/xr-ubl'] },
  { name: 'pdf-extraction-vs-pdfjs', cmd: [node, 'test/run-pdf-tests.cjs', E('zugferd-corpus')], summary: /identical|PDF/i },
  { name: 'pdf-scan-fallback', cmd: [node, 'test/run-pdf-fallback-tests.cjs', E('zugferd-corpus')], summary: /identical|PDF/i },
  { name: 'pdfa3-container-checks', cmd: [node, 'test/run-pdfa3-tests.cjs', E('zugferd-corpus'), '--mustang', E('mustangproject'), '--json', 'build/pdfa3-results.json'], summary: /^PDF\/A-3 container checks:/ },
  { name: 'verapdf-compare-selftest', cmd: [node, 'test/compare-verapdf.cjs', '--selftest'], summary: /^compare-verapdf selftest:/ },
  // CI only (job pdfa-verapdf): needs the veraPDF reports; locally NOT RUN (veraPDF not installed)
  { name: 'pdfa-verapdf', cmd: [node, 'test/compare-verapdf.cjs', '--mrr', 'build/verapdf/mrr-3b.xml', '--ours', 'build/pdfa3-results.json', '--out', 'build/reports/verapdf-compare.txt']
      .concat(['3u', '3a'].filter((f) => fs.existsSync(path.join(root, 'build', 'verapdf', 'mrr-' + f + '.xml'))).flatMap((f) => ['--extra', 'build/verapdf/mrr-' + f + '.xml'])),
    summary: /^veraPDF comparison \(mrr-3b\.xml\):/, needs: ['build/verapdf/mrr-3b.xml', 'build/pdfa3-results.json'] },
  ...browsers((b) => ({ name: 'e2e-' + b, browser: b, cmd: [node, 'test/e2e-browser.cjs', '--browser', b, '--screenshot', 'build/shots/' + b, ...E2E_FILES], summary: new RegExp('^E2E ' + b) })),
  ...browsers((b) => ({ name: 'reports-browser-' + b, browser: b, cmd: [node, 'test/e2e-reports-browser.cjs', '--browser', b, ...REPORT_FILES], summary: new RegExp('^E2E reports ' + b) })),
  ...browsers((b) => ({ name: 'peppol-import-' + b, browser: b, cmd: [node, 'test/peppol-import-browser.cjs', '--browser', b, E('peppol-bis-invoice-3'),
    ...['base-example.xml', 'Allowance-example.xml', 'vat-category-E.xml', 'base-creditnote-correction.xml'].map((f) => E('peppol-bis-invoice-3') + '/rules/examples/' + f)],
    summary: /^PEPPOL IMPORT/, needs: ['build/schemas/PEPPOL-UBL.json', 'build/schemas/PEPPOL-CII.json'] })),
  ...browsers((b) => ({ name: 'performance-' + b, browser: b, cmd: [node, 'test/perf.cjs', E('xrechnung-testsuite'), '--browser', b], summary: /lines,|^cold start|^performance/, all: true })),
  // ---- Windows (CI job "windows"): the four browser suites in Microsoft Edge and Google Chrome as installed on the
  // machine (Playwright channels msedge / chrome, no browser download) – the platform the product is made for.
  // Recorded only on Windows; the Linux run neither runs nor lists them (VERIFICATION.json of the job verify).
  ...windows((id, ch) => ({ name: 'xsd-browser-' + id + '-win', cmd: [node, 'test/xsd-browser.cjs', '--browser', 'chromium', '--channel', ch], summary: /identical|differences/ })),
  ...windows((id, ch) => ({ name: 'e2e-' + id + '-win', cmd: [node, 'test/e2e-browser.cjs', '--browser', 'chromium', '--channel', ch, '--screenshot', 'build/shots/' + id + '-win', ...E2E_FILES], summary: new RegExp('^E2E ' + ch) })),
  ...windows((id, ch) => ({ name: 'reports-browser-' + id + '-win', cmd: [node, 'test/e2e-reports-browser.cjs', '--browser', 'chromium', '--channel', ch, ...REPORT_FILES], summary: new RegExp('^E2E reports ' + ch) })),
  ...windows((id, ch) => ({ name: 'peppol-import-' + id + '-win', cmd: [node, 'test/peppol-import-browser.cjs', '--browser', 'chromium', '--channel', ch, E('peppol-bis-invoice-3'),
    ...['base-example.xml', 'Allowance-example.xml', 'vat-category-E.xml', 'base-creditnote-correction.xml'].map((f) => E('peppol-bis-invoice-3') + '/rules/examples/' + f)],
    summary: /^PEPPOL IMPORT/, needs: ['build/schemas/PEPPOL-UBL.json', 'build/schemas/PEPPOL-CII.json'] })),
  ...windows((id, ch) => ({ name: 'performance-' + id + '-win', cmd: [node, 'test/perf.cjs', E('xrechnung-testsuite'), '--browser', 'chromium', '--channel', ch], summary: /lines,|^cold start|^performance/, all: true })),
];

function browsers(f) { return ['chromium', 'webkit', 'firefox'].map(f); }
function windows(f) { return [['edge', 'msedge'], ['chrome', 'chrome']].map(([id, ch]) => Object.assign(f(id, ch), { browser: 'chromium', channel: ch, platform: 'win32' })); }
function changelogVersion() {
  const m = /^## (\d+\.\d+\.\d+) /m.exec(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  return m ? m[1] : '0.0.0';
}

if (args.includes('--list')) { for (const s of SUITES) console.log(s.name); process.exit(0); }
const only = opt('--only') ? opt('--only').split(',') : null;
const skip = opt('--skip') ? opt('--skip').split(',') : [];

// the Saxon jar of the reference toolchain is the one in <ext-dir> (tools/fetch-sources.cjs), on every machine
const fp = compute({ saxonJar: path.join(ext, 'saxon', 'saxon-he-12.8.jar') });
console.log('fingerprint ' + fp.id + (fp.git.commit ? ' (git ' + fp.git.commit.slice(0, 12) + (fp.git.dirty ? ', uncommitted changes' : '') + ')' : ''));
fs.mkdirSync(reports, { recursive: true });
const summaryFile = path.join(reports, 'VERIFICATION.json');
const previous = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
const results = {};
// suites not run this time are kept only if they were produced with the same fingerprint
if (previous && previous.fingerprint && previous.fingerprint.id === fp.id) Object.assign(results, previous.suites);

// the environment of the suites: EXT_DIR for the shell scripts; JVM options of the host (JAVA_TOOL_OPTIONS,
// e.g. proxy settings) are not an input of any suite and would only add machine details to the reports
// TZ=UTC: the implicit timezone of XPath (Saxon, fontoxpath, the browsers) is the same on every machine, e.g. for
// xs:date('2026-01-31Z') = xs:date('2026-01-31') in the XPath batteries
const suiteEnv = Object.assign({}, process.env, { EXT_DIR: ext, TZ: 'UTC' });
delete suiteEnv.JAVA_TOOL_OPTIONS;
delete suiteEnv._JAVA_OPTIONS;
// absolute paths of this machine in commands and outputs -> <ext>, ., node, <tmp>; on Windows in every spelling
// that occurs in the outputs: D:\a\x (Node, Java), D:/a/x (Java via Git Bash), D:\\a\\x (inside JSON), /d/a/x (Git Bash)
function spellings(p) {
  const out = [p];
  try { const real = fs.realpathSync.native(p); if (real !== p) out.push(real); } catch (e) { /* not on disk */ }
  if (process.platform !== 'win32') return out;
  return out.flatMap((q) => [q, q.replace(/\\/g, '/'), q.replace(/\\/g, '\\\\')].concat(/^[A-Za-z]:\\/.test(q) ? ['/' + q[0].toLowerCase() + q.slice(2).replace(/\\/g, '/')] : []));
}
const PATHS = [[ext, '<ext>'], [root, '.'], [node, 'node'], [require('os').tmpdir(), '<tmp>']].filter(([p]) => p && p.length > 1)
  .flatMap(([p, r]) => [...new Set(spellings(p))].map((q) => [q, r])).sort((a, b) => b[0].length - a[0].length);
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATH_RES = PATHS.map(([p, r]) => [new RegExp(escRe(p) + '(?![\\w.-])', 'g'), r]);
function machineIndependent(text) { let t = text; for (const [re, r] of PATH_RES) t = t.replace(re, r); return t; }

let failed = 0;
for (const s of SUITES) {
  if (only && !only.includes(s.name)) continue;
  if (skip.includes(s.name)) continue;
  if (s.reference && args.includes('--reuse-references')) {
    results[s.name] = { status: 'not-run', reason: 'references reused (--reuse-references, development run)', fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (references reused)`);
    continue;
  }
  if (s.platform && s.platform !== process.platform) {
    // platform suites (Windows: Edge, Chrome) belong to the run on that platform; listed only when asked for
    if (only) {
      results[s.name] = { status: 'not-run', reason: 'runs on Windows only (CI job windows: Microsoft Edge and Google Chrome of the runner image)', fingerprint: fp.id };
      console.log(`- ${s.name.padEnd(26)} NOT RUN (Windows only)`);
    }
    continue;
  }
  if (s.browser && !hasBrowser(s.browser, s.channel)) {
    results[s.name] = { status: 'not-run', reason: s.channel
      ? 'browser ' + s.channel + ' not installed (Playwright channel ' + s.channel + ': the ' + (s.channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome') + ' installation of the machine; the CI job windows uses the one of the runner image)'
      : 'Playwright browser ' + s.browser + ' not installed (install it from the official Playwright CDN: npx playwright install --with-deps ' + s.browser + '; the CI job verify installs chromium, webkit and firefox this way)', fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (browser ${s.channel || s.browser} not installed)`);
    continue;
  }
  const missing = (s.needs || []).filter((p) => !fs.existsSync(path.isAbsolute(p) ? p : path.join(root, p)));
  if (missing.length) {
    results[s.name] = { status: 'not-run', reason: 'missing ' + missing.join(', '), fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (missing ${missing.join(', ')})`);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, env: suiteEnv });
  const ms = Date.now() - t0;
  const output = machineIndependent((r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''));
  const lines = output.split('\n').filter((l) => l.trim());
  const matched = lines.filter((l) => s.summary.test(l.trim()));
  const summary = s.all ? matched.join(' | ') : (matched.pop() || lines[lines.length - 1] || '');
  const header = [
    '# suite        ' + s.name,
    '# fingerprint  ' + fp.id,
    '# git          ' + (fp.git.commit || '-') + (fp.git.dirty ? ' (uncommitted changes)' : ''),
    // paths are written relative to the repository, the sources as <ext>/…, temporary files as <tmp>/… (machine-independent reports)
    '# command      ' + machineIndependent(s.cmd.join(' ')).slice(0, 2000),
    '# exit code    ' + r.status,
    '# duration     ' + ms + ' ms',
    '# date         ' + new Date().toISOString(),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(reports, s.name + '.txt'), header + output);
  const ok = r.status === 0;
  if (!ok) failed++;
  results[s.name] = { status: ok ? 'pass' : 'FAIL', exitCode: r.status, summary: summary.trim(), durationMs: ms, report: 'build/reports/' + s.name + '.txt', fingerprint: fp.id };
  console.log(`${ok ? '✓' : '✗'} ${s.name.padEnd(26)} ${summary.trim().slice(0, 160)}  (${(ms / 1000).toFixed(1)} s)`);
}

const environment = process.env.GITHUB_ACTIONS ? 'GitHub Actions (' + (process.env.GITHUB_REPOSITORY || '') + ' run ' + (process.env.GITHUB_RUN_ID || '') + ')' : 'local';
const out = { generated: new Date().toISOString(), generator: 'tools/verify-all.cjs', environment, fingerprint: fp, suites: results };
fs.writeFileSync(summaryFile, JSON.stringify(out, null, 2));
console.log(`\n${Object.values(results).filter((x) => x.status === 'pass').length} passed, ${Object.values(results).filter((x) => x.status === 'FAIL').length} failed, ${Object.values(results).filter((x) => x.status === 'not-run').length} not run — build/reports/VERIFICATION.json (fingerprint ${fp.short})`);
process.exit(failed ? 1 : 0);
