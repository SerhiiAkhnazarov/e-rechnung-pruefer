#!/usr/bin/env node
/*
 * pruefer-cli.cjs — command-line version of the E-Rechnung Prüfer (same engine, same rule sets,
 * same decision logic as the browser build). Prints one JSON report per input file.
 *
 * Usage: node pruefer-cli.cjs [--out <dir>] [--quiet] [--like-browser] <file.xml|file.pdf|dir> ...
 *   --like-browser  rule sets that the browser build does not embed (PEPPOL-*) are treated as missing
 *   --out <dir>   write <name>.report.json per file into <dir> (otherwise print to stdout)
 *
 * The analysis is src/pruefer-core.js analyzeBytes — the same pipeline as the browser build.
 * JSON per document: file, name, size, sha256, kind (xml|pdf|zip), pdf {attachments, xmp, container{checks,
 * facts}, invoiceAttachment}, xml {encoding, declared, bom, size, parseError}, syntax, specId, profile,
 * route (kosit|facturx|peppol|…|none), scenario (KoSIT scenario name or null), scenarioDetails, customLevels,
 * kositScenario, xsd {schema, resource, source, valid, errorCount, errors[{code,message,location}]},
 * schematronSkipped ('xsd-invalid'), ruleSets, ruleSetsRun, missingRuleSets, findings[{level, originalLevel,
 * id, schema, text, location, context, test}] (Schematron), issues[{source: encoding|pdf|xsd, level, id,
 * text, location}], counts (all sources), assessment (accept|reject|incomplete|not-applicable|
 * not-processable), legalStatus, processingErrors, engineWarnings, warnings, timing, model.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const fx = require(path.join(root, 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(root, 'vendor', 'slimdom.cjs'));
const SchematronRunner = require(path.join(root, 'src', 'schematron.js'));
const PdfEmbedded = require(path.join(root, 'src', 'pdf-embedded.js'));
const InvoiceModel = require(path.join(root, 'src', 'invoice-model.js'));
const PrueferCore = require(path.join(root, 'src', 'pruefer-core.js'));
const XsdValidator = require(path.join(root, 'src', 'xsd-validator.js'));

const args = process.argv.slice(2);
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const outDir = opt('--out');
const quiet = args.includes('--quiet');
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

const PdfA3Checks = require(path.join(root, 'src', 'pdfa3-checks.js'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));

const { createEnv } = require(path.join(root, 'tools', 'node-env.cjs'));
const env = createEnv(args.includes('--like-browser') ? { exclude: /^PEPPOL-/ } : {});

/** JSON report of one file (fields: see header) */
async function analyzeFile(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const r = await PrueferCore.analyzeBytes(env, bytes, path.basename(file));
  const out = Object.assign({ file }, r);
  // compatibility: scenario as name (test/compare-kosit.cjs), details separately
  out.scenarioDetails = r.scenario || null;
  out.scenario = r.scenario ? r.scenario.name : null;
  out.customLevels = r.scenario ? r.scenario.customLevels : {};
  out.findings = (r.findings || []).map((f) => ({ level: f.level, originalLevel: f.originalLevel, id: f.id, schema: f.schema, text: f.text, location: f.location, context: f.context, test: f.test }));
  out.issues = r.issues;
  delete out.allFindings;
  return out;
}

function expand(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) expand(path.join(p, e), out); }
  else if (/\.(xml|pdf)$/i.test(p)) out.push(p);
  return out;
}

(async () => {
  const files = [];
  for (const i of inputs) expand(i, files);
  if (!files.length) { console.error('usage: pruefer-cli.cjs [--out dir] <file|dir>...'); process.exit(2); }
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const all = [];
  let n = 0;
  for (const f of files) {
    let r;
    try { r = await analyzeFile(f); } catch (e) { r = { file: f, assessment: 'not-processable', warnings: ['exception: ' + e.message] }; }
    n++;
    if (outDir) fs.writeFileSync(path.join(outDir, path.basename(f) + '.report.json'), JSON.stringify(r, null, 1));
    else all.push(r);
    if (!quiet) console.error(`${String(r.assessment).padEnd(16)} E${(r.counts || {}).error || 0} W${(r.counts || {}).warning || 0} I${(r.counts || {}).information || 0}  ${path.basename(f)}${r.scenario ? '  [' + r.scenario + ']' : r.profile ? '  [' + r.profile.label + ']' : ''}`);
  }
  if (!outDir) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 1));
  if (!quiet) console.error(`${n} file(s) processed`);
})();
