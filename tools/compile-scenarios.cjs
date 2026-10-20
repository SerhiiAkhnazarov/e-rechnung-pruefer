#!/usr/bin/env node
/*
 * compile-scenarios.cjs — extracts the KoSIT validator scenarios (validator-configuration-xrechnung
 * scenarios.xml) into JSON: name, match XPath (with namespace bindings), Schematron resources and
 * custom severity levels. Ant property placeholders are substituted with the values from build.xml.
 *
 * Usage: node compile-scenarios.cjs <validator-configuration-xrechnung-dir> <out.json> [--emit-xml <scenarios.xml>]
 *
 * --emit-xml writes the token-substituted scenarios.xml exactly as the Ant target "compile-scenario"
 * of the configuration's build.xml does (same <filter token=…> list, build.xml lines 421-441);
 * @build.date@ is set to validator.configuration.version.full (the release date) because the
 * sandbox has no build timestamp of the official release. Tokens outside that list (e.g.
 * @xrechnung.cvd.version.major.minor@) stay literal — as in the official release.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));

const argv = process.argv.slice(2);
const emitIdx = argv.indexOf('--emit-xml');
const emitXml = emitIdx >= 0 ? argv[emitIdx + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--emit-xml');
const [repo, out] = positional;
if (!repo || !out) { console.error('usage: compile-scenarios.cjs <config-repo> <out.json> [--emit-xml <scenarios.xml>]'); process.exit(2); }

const buildXml = fs.readFileSync(path.join(repo, 'build.xml'), 'utf8');
const props = {};
for (const m of buildXml.matchAll(/<property name="([^"]+)"\s+value="([^"]*)"\s*\/>/g)) props[m[1]] = m[2];
for (const m of buildXml.matchAll(/<property name="([^"]+)"\s*\n\s*value="([^"]*)"\s*\/>/g)) props[m[1]] = m[2];
function resolve(v, depth = 0) {
  if (depth > 10) return v;
  return v.replace(/\$\{([^}]+)\}/g, (_, k) => (props[k] !== undefined ? resolve(props[k], depth + 1) : '${' + k + '}'));
}
for (const k of Object.keys(props)) props[k] = resolve(props[k]);

const xml = fs.readFileSync(path.join(repo, 'scenarios.xml'), 'utf8');
const subst = xml.replace(/@([a-z.]+)@/g, (m, k) => (props[k] !== undefined ? props[k] : m));
const doc = slimdom.parseXmlDocument(subst);

if (emitXml) {
  // build.xml target "compile-scenario": <filter token="…" value="${…}"/> — token -> property
  const filters = {
    'build.date': props['validator.configuration.version.full'],
    'cen.spec.id': props['cen.spec.id'],
    'cen.rules.version': props['cen.rules.version'],
    'cen.download.url.ubl': props['cen.download.url.ubl'],
    'cen.download.url.cii': props['cen.download.url.cii'],
    'xrechnung.download.url': props['xr.schematron.download.url'],
    'xrechnung.rules.version.full': props['xr.schematron.version.full'],
    'xrechnung.rules.version.major.minor': props['xr.schematron.version.major.minor'],
    'xrechnung.version': props['xrechnung.version'],
    'xrechnung.spec.id': props['xrechnung.spec.id'],
    'xrechnung.extension.id': props['xrechnung.extension.id'],
    'xrechnung.cvd.id': props['xrechnung.cvd.id'],
    'ubl.version': props['ubl.version'],
    'ubl.download.url': props['ubl.download.url'],
    'cii.version': props['cii.version'],
    'cii.download.url': props['cii.download.url'],
  };
  for (const [k, v] of Object.entries(filters)) if (v === undefined) throw new Error('build.xml property for filter token ' + k + ' not found');
  const filtered = xml.replace(/@([a-z.]+)@/g, (m, k) => (filters[k] !== undefined ? filters[k] : m));
  fs.mkdirSync(path.dirname(emitXml), { recursive: true });
  fs.writeFileSync(emitXml, filtered);
  console.log('scenarios.xml (tokens substituted) -> ' + emitXml);
}
const NS = 'http://www.xoev.de/de/validator/framework/1/scenarios';
const el = (n, name) => Array.from(n.childNodes).filter((c) => c.nodeType === 1 && c.localName === name && c.namespaceURI === NS);
const text = (n) => (n ? n.textContent.trim() : null);

const scenarios = [];
for (const sc of el(doc.documentElement, 'scenario')) {
  const ns = {};
  for (const n of el(sc, 'namespace')) ns[n.getAttribute('prefix')] = n.textContent.trim();
  const schematrons = [];
  for (const v of el(sc, 'validateWithSchematron')) for (const r of el(v, 'resource')) schematrons.push({ name: text(el(r, 'name')[0]), location: text(el(r, 'location')[0]) });
  const xsds = [];
  for (const v of el(sc, 'validateWithXmlSchema')) for (const r of el(v, 'resource')) xsds.push({ name: text(el(r, 'name')[0]), location: text(el(r, 'location')[0]) });
  const customLevels = {};
  for (const cr of el(sc, 'createReport')) for (const cl of el(cr, 'customLevel')) for (const id of cl.textContent.trim().split(/\s+/)) customLevels[id] = cl.getAttribute('level');
  scenarios.push({
    name: text(el(sc, 'name')[0]),
    description: text(el(sc, 'description')[0]),
    namespaces: ns,
    match: text(el(sc, 'match')[0]),
    xsd: xsds,
    schematron: schematrons.map((s) => Object.assign(s, { schemaId: /XRechnung-UBL/.test(s.location) ? 'XRechnung-UBL' : /XRechnung-CII/.test(s.location) ? 'XRechnung-CII' : /EN16931-UBL/.test(s.location) ? 'EN16931-UBL' : /EN16931-CII/.test(s.location) ? 'EN16931-CII' : null })),
    customLevels,
    acceptMatch: text(el(sc, 'acceptMatch')[0]),
  });
}
const result = {
  source: { file: 'scenarios.xml', sha256: crypto.createHash('sha256').update(xml).digest('hex') },
  configurationName: text(el(doc.documentElement, 'name')[0]),
  properties: {
    'xrechnung.version': props['xrechnung.version'],
    'xrechnung.spec.id': props['xrechnung.spec.id'],
    'xrechnung.extension.id': props['xrechnung.extension.id'],
    'xrechnung.cvd.id': props['xrechnung.cvd.id'],
    'cen.spec.id': props['cen.spec.id'],
    'xr.schematron.version.full': props['xr.schematron.version.full'],
    'validator.configuration.version.full': props['validator.configuration.version.full'],
  },
  // KoSIT default-report.xsl: level from flag/role; customLevel per scenario overrides; assessment:
  // reject if processing error, no scenario, fallback scenario or any message with (custom) level error.
  scenarios,
};
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`${scenarios.length} scenarios -> ${out}`);
for (const s of scenarios) console.log(`  ${s.name}: ${s.schematron.map((x) => x.schemaId).join('+')} custom=${Object.keys(s.customLevels).length}`);
