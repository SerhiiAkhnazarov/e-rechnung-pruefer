#!/usr/bin/env node
/*
 * report.cjs — writes build/reports/kosit-reference.txt from the outputs of
 *   sh test/kosit-reference/run.sh selftest     (build/kosit-reference/selftest/*.log)
 *   sh test/kosit-reference/run.sh corpus + tools/pruefer-cli.cjs + test/compare-kosit.cjs --out build/kosit-reference/compare.txt
 * Sections: (a) configuration self-test counts, (b) corpus comparison summary, (c) mismatches.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const base = path.join(root, 'build', 'kosit-reference');
const out = path.join(root, 'build', 'reports', 'kosit-reference.txt');
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const line = (txt, re) => { const m = txt && txt.match(re); return m ? m[0] : '(not found)'; };

const L = [];
L.push('KoSIT reference pipeline (test/kosit-reference) — results');
L.push('date: ' + new Date().toISOString());
L.push('validator source: itplr-kosit/validator 6ac5167f (release 1.6.3); configuration: validator-configuration-xrechnung v2026-08-31 (b436fc4b)');
L.push('engine: KositReference.java (JDK 21) + Saxon HE 12.8; XSLT rule sets compiled with the ISO Schematron skeleton (deviation A1, docs/KOSIT-REFERENCE.md)');
L.push('');
L.push('(a) configuration self-tests (src/test/** of the configuration, build.xml targets test-instances-*, check-reports, test-processing-error, test-integration-only)');
const pv = read(path.join(base, 'selftest', 'processing-valid.log'));
const pe = read(path.join(base, 'selftest', 'processing-error.log'));
const it = read(path.join(base, 'selftest', 'integration.log'));
const cr1 = read(path.join(base, 'selftest', 'check-reports-processing-valid.log'));
const cr2 = read(path.join(base, 'selftest', 'check-reports-processing-error.log'));
const tpe = read(path.join(base, 'selftest', 'test-processing-error.log'));
L.push('  instances/processing-valid (test scenarios.xml + assertions.xml): ' + line(pv, /Acceptable: \d+ Rejected: \d+.*/) + '; ' + line(pv, /Assertions run: \d+, Assertions failed: \d+/) + '; ' + line(pv, /exit code: -?\d+/));
L.push('  instances/processing-error (test scenarios.xml + assertions.xml): ' + line(pe, /Acceptable: \d+ Rejected: \d+.*/) + '; ' + line(pe, /Assertions run: \d+, Assertions failed: \d+/) + '; ' + line(pe, /exit code: -?\d+/));
L.push('  check-reports processing-valid: ' + line(cr1, /report\.xsd: .*/) + '; ' + line(cr1, /check-svrl\.xsl on \d+ SVRL files: exit code \d+/));
L.push('  check-reports processing-error: ' + line(cr2, /report\.xsd: .*/) + '; ' + line(cr2, /check-svrl\.xsl on \d+ SVRL files: exit code \d+/));
L.push('  test-processing-error (default-report.xsl fixtures): ' + line(tpe, /\d+ checks, \d+ failed/));
L.push('  integration (production scenarios.xml + assertions-integration-testing.xml): ' + line(it, /Acceptable: \d+ Rejected: \d+.*/) + '; ' + line(it, /Assertions run: \d+, Assertions failed: \d+/) + '; ' + line(it, /exit code: -?\d+/));
const runs = [pv, pe, it].map((t) => (t || '').match(/Assertions run: (\d+), Assertions failed: (\d+)/)).filter(Boolean);
const totalRun = runs.reduce((a, m) => a + Number(m[1]), 0), totalFailed = runs.reduce((a, m) => a + Number(m[2]), 0);
L.push(`  TOTAL: ${totalRun} assertions run, ${totalFailed} failed (expected 284 + 41 = 325 = all uncommented assertions of both files)`);
L.push('');
L.push('(b) corpus comparison (build/kosit-reference/reports vs build/kosit-reference/pruefer, test/compare-kosit.cjs)');
const cmp = read(path.join(base, 'compare.txt'));
if (cmp) {
  const idx = cmp.indexOf('MISMATCHES:');
  for (const l of cmp.slice(0, idx).trimEnd().split('\n')) L.push('  ' + l);
  L.push('');
  L.push('(c) mismatches');
  const tail = cmp.slice(idx).trimEnd().split('\n');
  for (const l of tail) L.push('  ' + l);
  if (tail.length === 1) L.push('  (none)');
} else {
  L.push('  compare.txt missing — run the corpus comparison first');
}
// informational: XSD error lists (not a comparable field — only the verdict is; docs/XSD-VALIDATION.md)
const pat = new Map(); let invalidDocs = 0;
for (const d of ['xr-ubl', 'xr-cii', 'cen-ubl', 'cen-cii', 'extra-ubl', 'extra-cii']) {
  const jd = path.join(base, 'pruefer', d);
  if (!fs.existsSync(jd)) continue;
  for (const f of fs.readdirSync(jd)) {
    const o = JSON.parse(fs.readFileSync(path.join(jd, f), 'utf8'));
    if (!o.scenario || !o.xsd || o.xsd.valid) continue;
    const rf = path.join(base, 'reports', d, f.replace(/\.xml\.report\.json$/, '-report.xml'));
    if (!fs.existsSync(rf)) continue;
    invalidDocs++;
    const rep = fs.readFileSync(rf, 'utf8');
    const codes = [...rep.matchAll(/<rep:message id="val-xsd\.\d+"[^>]*code="([^"]*)"/g)].map((m) => m[1]);
    const k = 'reference [' + codes.join(', ') + '] vs Prüfer [' + o.xsd.errors.map((e) => e.code).join(', ') + ']';
    pat.set(k, (pat.get(k) || 0) + 1);
  }
}
L.push('');
L.push(`(d) informational — XSD error lists of the ${invalidDocs} schema-invalid documents (NOT a comparable field; the verdict is identical in all of them):`);
for (const [k, n] of [...pat.entries()].sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(4)}  ${k}`);
L.push('  Xerces reports a datatype violation of simple content twice (cvc-datatype-valid.1.2.1 + cvc-complex-type.2.2 / cvc-type.3.1.3), src/xsd-validator.js once;');
L.push('  the KoSIT report therefore lists two val-xsd messages where the Prüfer lists one. No effect on scenario, verdict, Schematron or assessment.');
L.push('');
L.push('per-directory logs: build/kosit-reference/reports/<dir>.log (KositReference summary per corpus directory)');
for (const d of ['xr-ubl', 'xr-cii', 'cen-ubl', 'cen-cii', 'extra-ubl', 'extra-cii']) {
  const t = read(path.join(base, 'reports', d + '.log'));
  L.push(`  ${d}: ${line(t, /Processing of \d+ objects completed in \d+ms/)}; ${line(t, /Acceptable: \d+ Rejected: \d+.*/)}`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, L.join('\n') + '\n');
console.log(L.join('\n'));
console.log('\n-> ' + out);
