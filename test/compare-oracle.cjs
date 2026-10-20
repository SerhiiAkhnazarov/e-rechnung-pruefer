#!/usr/bin/env node
/*
 * compare-oracle.cjs — parity check of our engine against the Saxon reference SVRL produced by
 * test/run-oracle.sh. For every corpus document and every schema it compares the multiset of
 * failed assertions (id + flag + location) and the error behaviour (dynamic errors).
 *
 * Usage: node compare-oracle.cjs [--verbose] [--dir xr-ubl] [--schema XRechnung-UBL]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; }
const onlyDir = opt('--dir');
const onlySchema = opt('--schema');

const root = path.join(__dirname, '..');
const corpus = path.join(root, 'build', 'corpus');
const oracle = path.join(root, 'build', 'oracle');
const SVRL_NS = 'http://purl.oclc.org/dsdl/svrl';

const validators = {};
function validator(id) {
  if (!validators[id]) validators[id] = SR.create(fx, JSON.parse(fs.readFileSync(path.join(root, 'build', 'schemas', id + '.json'), 'utf8')));
  return validators[id];
}

// Saxon skeleton location: /*:Invoice[namespace-uri()='…'][1]/*:TaxTotal[namespace-uri()='…'][1]/@currencyID
function normSaxonLocation(loc) {
  return loc
    .replace(/\[namespace-uri\(\)='[^']*'\]/g, '')
    .replace(/\*:/g, '')
    .replace(/@\*:?/g, '@')
    .replace(/@([A-Za-z_][\w.-]*)/g, (m, a) => '@' + a.replace(/^[^:]+:/, ''));
}
// ours: /ubl:Invoice[1]/cac:TaxTotal[1]/@currencyID  -> strip prefixes
function normOurLocation(loc) {
  return loc.replace(/(^|\/)([A-Za-z_][\w.-]*):/g, '$1').replace(/@([A-Za-z_][\w.-]*):/g, '@');
}

function key(id, flag, loc) { return id + '|' + flag + '|' + loc; }

const known = fs.existsSync(path.join(__dirname, 'KNOWN_DEVIATIONS.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'KNOWN_DEVIATIONS.json'), 'utf8')).oracle || [] : [];

const summary = {};
const mismatches = [];
let docs = 0;
const t0 = Date.now();
for (const dir of fs.readdirSync(oracle).sort()) {
  if (onlyDir && dir !== onlyDir) continue;
  const dpath = path.join(oracle, dir);
  if (!fs.statSync(dpath).isDirectory()) continue;
  for (const schemaId of fs.readdirSync(dpath).filter((n) => fs.statSync(path.join(dpath, n)).isDirectory()).sort()) {
    if (onlySchema && schemaId !== onlySchema) continue;
    const failedList = new Set(fs.existsSync(path.join(dpath, schemaId + '.failed')) ? fs.readFileSync(path.join(dpath, schemaId + '.failed'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);
    const v = validator(schemaId);
    const stat = { docs: 0, equal: 0, bothError: 0, mismatch: 0, oracleErrorOnly: 0, oursErrorOnly: 0, known: 0 };
    summary[dir + ' × ' + schemaId] = stat;
    for (const file of fs.readdirSync(path.join(corpus, dir)).sort()) {
      if (!file.endsWith('.xml')) continue;
      stat.docs++; docs++;
      const xml = fs.readFileSync(path.join(corpus, dir, file), 'utf8');
      const doc = slimdom.parseXmlDocument(xml);
      const rep = v.validate(doc);
      const oracleFailed = failedList.has(file);
      const svrlPath = path.join(dpath, schemaId, file);
      let oracleAsserts = null;
      if (!oracleFailed && fs.existsSync(svrlPath)) {
        try {
          const sdoc = slimdom.parseXmlDocument(fs.readFileSync(svrlPath, 'utf8'));
          oracleAsserts = [];
          (function walk(n) {
            for (let c = n.firstChild; c; c = c.nextSibling) {
              if (c.nodeType === 1 && c.namespaceURI === SVRL_NS && (c.localName === 'failed-assert' || c.localName === 'successful-report')) {
                oracleAsserts.push({ id: c.getAttribute('id'), flag: c.getAttribute('flag'), location: normSaxonLocation(c.getAttribute('location') || '') });
              }
              if (c.nodeType === 1) walk(c);
            }
          })(sdoc);
        } catch (e) {
          oracleAsserts = null;
        }
      }
      const oursError = rep.processingErrors.length > 0;
      if (oracleFailed || oracleAsserts === null) {
        if (oursError) stat.bothError++;
        else {
          stat.oracleErrorOnly++;
          mismatches.push({ dir, schemaId, file, kind: 'oracle dynamic error, ours none', detail: 'ours findings: ' + rep.findings.map((f) => f.id).join(',') });
        }
        continue;
      }
      // compare multisets
      const a = new Map();
      for (const o of oracleAsserts) { const k = key(o.id, o.flag, o.location); a.set(k, (a.get(k) || 0) + 1); }
      const b = new Map();
      for (const f of rep.findings) { const k = key(f.id, f.flag, normOurLocation(f.location)); b.set(k, (b.get(k) || 0) + 1); }
      const onlyOracle = [], onlyOurs = [];
      for (const [k, n] of a) { const m = b.get(k) || 0; if (m < n) onlyOracle.push(k + (n - m > 1 ? ' ×' + (n - m) : '')); }
      for (const [k, n] of b) { const m = a.get(k) || 0; if (m < n) onlyOurs.push(k + (n - m > 1 ? ' ×' + (n - m) : '')); }
      if (!onlyOracle.length && !onlyOurs.length && !oursError) { stat.equal++; continue; }
      const kd = known.find((k) => k.dir === dir && k.schema === schemaId && k.file === file);
      if (kd) { stat.known++; if (verbose) console.log(`KNOWN ${dir}/${file} [${schemaId}]: ${kd.reason}`); continue; }
      if (oursError && !onlyOracle.length && !onlyOurs.length) {
        stat.oursErrorOnly++;
        mismatches.push({ dir, schemaId, file, kind: 'ours dynamic error, oracle none', detail: rep.processingErrors.map((e) => (e.id || '') + ': ' + e.message.slice(0, 100)).join(' | ') });
        continue;
      }
      stat.mismatch++;
      mismatches.push({ dir, schemaId, file, kind: 'findings differ', detail: (onlyOracle.length ? 'only Saxon: ' + onlyOracle.join(', ') : '') + (onlyOurs.length ? ' only ours: ' + onlyOurs.join(', ') : '') + (oursError ? ' ours errors: ' + rep.processingErrors.map((e) => e.id + ': ' + e.message.slice(0, 80)).join('|') : '') });
    }
  }
}
for (const m of mismatches) console.log(`MISMATCH ${m.dir}/${m.file} [${m.schemaId}] ${m.kind}: ${m.detail}`);
console.log('\nParity summary (documents × schema):');
let totalMismatch = 0;
for (const [k, s] of Object.entries(summary)) {
  totalMismatch += s.mismatch + s.oracleErrorOnly + s.oursErrorOnly;
  console.log(`  ${k.padEnd(28)} docs=${String(s.docs).padStart(5)} identical=${String(s.equal).padStart(5)} both-dynamic-error=${String(s.bothError).padStart(3)} known-deviation=${String(s.known).padStart(2)} MISMATCH=${s.mismatch} oracle-error-only=${s.oracleErrorOnly} ours-error-only=${s.oursErrorOnly}`);
}
console.log(`\n${docs} document×schema comparisons in ${Date.now() - t0} ms; mismatches: ${totalMismatch}`);
process.exit(totalMismatch ? 1 : 0);
