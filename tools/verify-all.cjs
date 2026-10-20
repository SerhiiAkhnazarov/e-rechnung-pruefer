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
 *   --ext <dir>  directory with the standard repositories (layout of .github/workflows/verify.yml:
 *                einvoicing-en16931, xrechnung-schematron, xrechnung-testsuite,
 *                validator-configuration-xrechnung, peppol-bis-invoice-3, zugferd-corpus,
 *                mustangproject). Default: build/ext (created with links to the sandbox clones).
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

// development sandbox: link its clones under build/ext (same names as in CI); elsewhere pass --ext
let ext = opt('--ext');
if (!ext) {
  ext = path.join(root, 'build', 'ext');
  const links = {
    'einvoicing-en16931': '/home/claude/connectingeurope/einvoicing-en16931',
    'xrechnung-schematron': '/home/claude/itplr-kosit/xrechnung-schematron',
    'xrechnung-testsuite': '/home/claude/itplr-kosit/xrechnung-testsuite',
    'validator-configuration-xrechnung': '/home/claude/itplr-kosit/validator-configuration-xrechnung',
    'peppol-bis-invoice-3': '/home/claude/openpeppol/peppol-bis-invoice-3',
    'zugferd-corpus': '/home/claude/zugferd/corpus',
    'mustangproject': '/home/claude/zugferd/mustangproject',
    'os-UBL-2.1': '/home/claude/oasis/os-UBL-2.1',
    'ph-cii': '/home/claude/phax/ph-cii',
    'ph-schematron': '/home/claude/phax/ph-schematron',
    'validator': '/home/claude/itplr-kosit/validator',
    'saxon': '/home/claude/saxon-he-12.8',
    'kosit-official': '/home/claude/kosit-official',
    'fontoxpath': '/home/claude/fontoxml/fontoxpath',
    'xspattern.js': '/home/claude/bwrrp/xspattern.js',
    'whynot.js': '/home/claude/bwrrp/whynot.js',
    'prsc.js': '/home/claude/bwrrp/prsc.js',
    'slimdom.js': '/home/claude/bwrrp/slimdom.js',
  };
  fs.mkdirSync(ext, { recursive: true });
  for (const [name, target] of Object.entries(links)) {
    const l = path.join(ext, name);
    if (!fs.existsSync(l) && fs.existsSync(target)) fs.symlinkSync(target, l);
  }
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
// name, command, report file, summary-line pattern; `needs` = paths that must exist;
// `browser` = Playwright engine that must be installed (no download is attempted)
const ESBUILD = process.env.ESBUILD_BINARY || [path.join(root, 'node_modules', '.bin', 'esbuild'), '/opt/npm-tools/node_modules/.bin/esbuild'].find((p) => fs.existsSync(p)) || 'esbuild';
const SH = (script) => ['sh', '-c', 'set -e; ' + script];
const SUITES = [
  // ---- stage 1: reference results, regenerated from the pinned sources on every full run ----------
  // (independent engines: Saxon HE 12.8 for Schematron/XPath, JDK 21 Xerces for XSD and encodings;
  //  --reuse-references skips this stage for quick development runs and marks it 'not-run')
  { name: 'ref-corpus', reference: true, cmd: [node, 'test/build-corpus.cjs', '--xr', E('xrechnung-schematron'), '--cen', E('einvoicing-en16931'),
      '--extra', E('xrechnung-testsuite') + '/src/test', '--extra', E('validator-configuration-xrechnung') + '/src/test', '--peppol', E('peppol-bis-invoice-3'), '--zugferd', E('zugferd-corpus')], summary: /./ },
  { name: 'ref-schematron-xsl', reference: true, cmd: SH('rm -rf build/reference-xsl; sh test/kosit-reference/build-xrechnung-xsl.sh build/reference-xsl; sh test/build-oracle-xsl.sh build/reference-xsl; ls build/reference-xsl/*.xsl | wc -l | sed "s/^/reference stylesheets: /"'), summary: /^reference stylesheets/ },
  { name: 'ref-saxon-svrl', reference: true, cmd: ['sh', 'test/run-oracle.sh', E('saxon'), E('einvoicing-en16931'), 'build/reference-xsl'], summary: /./ },
  { name: 'ref-saxon-xpath', reference: true, cmd: SH(node + ' test/xpath-conformance/run-saxon.cjs ' + E('saxon') + '; ' + node + ' test/xpath-conformance/run-saxon-doc.cjs ' + E('saxon') + '; git diff --exit-code --stat -- test/xpath-conformance/expected.json test/xpath-conformance/expected-doc.json && echo "Saxon expectations reproduced byte-identically"'), summary: /evaluated by Saxon|reproduced/, all: true },
  { name: 'ref-xerces', reference: true, cmd: SH('sh test/xsd-oracle/run-xsd-oracle.sh; ' + node + ' test/build-xsd-mutations.cjs; sh test/xsd-oracle/run-xsd-oracle.sh xsd-mutations build/corpus/xsd-mutations; sh test/xsd-oracle/run-facturx-xsd-oracle.sh; echo "Xerces reference: $(cat build/oracle/xsd/*.jsonl | wc -l) documents, Factur-X: $(cat build/oracle/xsd-facturx/*.jsonl | wc -l) validations"'), summary: /^Xerces reference/ },
  // ---- stage 2: the product against the references and the official test material ------------------
  { name: 'manifest', cmd: [node, 'tools/verify-manifest.cjs', ext], summary: /^manifest verification:/ },
  { name: 'engine-reproducible', cmd: ['sh', 'tools/check-engine.sh', ext, ESBUILD], summary: /^engine rebuild|applied cleanly/, all: true, needs: [E('fontoxpath')] },
  { name: 'build-reproducible', cmd: [node, 'tools/check-reproducible.cjs', ext], summary: /^reproducible build:/ },
  { name: 'xpath-conformance', cmd: [node, 'test/xpath-conformance/run-fontoxpath.cjs'], summary: /^XPath conformance/ },
  { name: 'xpath-document', cmd: [node, 'test/xpath-conformance/run-fontoxpath-doc.cjs'], summary: /^XPath document battery/, all: true },
  { name: 'batch-compile', cmd: [node, 'test/check-batches.cjs'], summary: /^batches/ },
  { name: 'cen-unit-tests', cmd: [node, 'test/run-cen-tests.cjs', E('einvoicing-en16931')], summary: /^CEN unit tests:/ },
  { name: 'kosit-xmute-tests', cmd: [node, 'test/run-xmute-tests.cjs', E('xrechnung-schematron')], summary: /^XRechnung xmute tests:/ },
  { name: 'peppol-unit-tests', cmd: [node, 'test/run-peppol-tests.cjs', E('peppol-bis-invoice-3')], summary: /unit tests:/i, needs: ['build/schemas/PEPPOL-UBL.json'] },
  { name: 'facturx-corpus-tests', cmd: [node, 'test/run-facturx-tests.cjs'], summary: /^Factur-X corpus tests:/, needs: ['build/schemas/FACTUR-X-EN16931.json', 'build/rulesets.json', 'build/corpus/zugferd-cii', 'build/oracle/zugferd-cii'] },
  { name: 'facturx-xsd-vs-xerces', cmd: [node, 'test/run-facturx-xsd-tests.cjs'], summary: /^Factur-X XSD vs Xerces:/, needs: ['build/xsd/FACTUR-X-EN16931.json', 'build/oracle/xsd-facturx'] },
  { name: 'parity-saxon', cmd: [node, 'test/compare-oracle.cjs'], summary: /comparisons in .*mismatches/, needs: ['build/oracle'] },
  { name: 'pattern-matcher-selftest', cmd: [node, 'test/selftest-pattern-matcher.cjs'].concat(['xr-ubl', 'xr-cii', 'extra-ubl', 'extra-cii'].flatMap((d) => listXml(path.join(root, 'build', 'corpus', d)))), summary: /^pattern matcher self-test:/ },
  { name: 'xsd-vs-xerces', cmd: [node, 'test/run-xsd-tests.cjs'], summary: /^TOTAL/, all: true, needs: ['build/oracle/xsd'] },
  { name: 'xml-encoding', cmd: [node, 'test/run-encoding-tests.cjs'], summary: /^XML encoding tests:/ },
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
  ...browsers((b) => ({ name: 'peppol-import-' + b, browser: b, cmd: [node, 'test/peppol-import-browser.cjs', '--browser', b, E('peppol-bis-invoice-3'),
    ...['base-example.xml', 'Allowance-example.xml', 'vat-category-E.xml', 'base-creditnote-correction.xml'].map((f) => E('peppol-bis-invoice-3') + '/rules/examples/' + f)],
    summary: /^PEPPOL IMPORT/, needs: ['build/schemas/PEPPOL-UBL.json', 'build/schemas/PEPPOL-CII.json'] })),
  ...browsers((b) => ({ name: 'performance-' + b, browser: b, cmd: [node, 'test/perf.cjs', E('xrechnung-testsuite'), '--browser', b], summary: /lines,|^cold start|^performance/, all: true })),
];

function browsers(f) { return ['chromium', 'webkit', 'firefox'].map(f); }
function listXml(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.xml')).sort().map((f) => path.join(dir, f)) : [];
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

let failed = 0;
for (const s of SUITES) {
  if (only && !only.includes(s.name)) continue;
  if (skip.includes(s.name)) continue;
  if (s.reference && args.includes('--reuse-references')) {
    results[s.name] = { status: 'not-run', reason: 'references reused (--reuse-references, development run)', fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (references reused)`);
    continue;
  }
  if (s.browser && !hasBrowser(s.browser)) {
    results[s.name] = { status: 'not-run', reason: 'Playwright browser ' + s.browser + ' not installed (install it from the official Playwright CDN: npx playwright install --with-deps ' + s.browser + '; the CI job verify installs chromium, webkit and firefox this way)', fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (browser ${s.browser} not installed)`);
    continue;
  }
  const missing = (s.needs || []).filter((p) => !fs.existsSync(path.isAbsolute(p) ? p : path.join(root, p)));
  if (missing.length) {
    results[s.name] = { status: 'not-run', reason: 'missing ' + missing.join(', '), fingerprint: fp.id };
    console.log(`- ${s.name.padEnd(26)} NOT RUN (missing ${missing.join(', ')})`);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, env: Object.assign({}, process.env, { EXT_DIR: ext }) });
  const ms = Date.now() - t0;
  const output = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  const lines = output.split('\n').filter((l) => l.trim());
  const matched = lines.filter((l) => s.summary.test(l.trim()));
  const summary = s.all ? matched.join(' | ') : (matched.pop() || lines[lines.length - 1] || '');
  const header = [
    '# suite        ' + s.name,
    '# fingerprint  ' + fp.id,
    '# git          ' + (fp.git.commit || '-') + (fp.git.dirty ? ' (uncommitted changes)' : ''),
    // paths are written relative to the repository, the source checkouts as <ext>/… (machine-independent reports)
    '# command      ' + s.cmd.map((c) => (typeof c === 'string' && c.startsWith(ext) ? '<ext>' + c.slice(ext.length) : c === node ? 'node' : (c.startsWith('/') && !path.relative(root, c).startsWith('..') ? path.relative(root, c) : c)).replace(ext, '<ext>')).join(' ').slice(0, 2000),
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
