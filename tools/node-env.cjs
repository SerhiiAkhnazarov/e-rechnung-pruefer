/*
 * node-env.cjs — the Node.js environment of src/pruefer-core.js (the browser build embeds the same JSON
 * files): rule sets from build/schemas, XSD models from build/xsd, scenarios, routing table, slimdom as
 * XML parser. Used by tools/pruefer-cli.cjs and by the tests that compare the browser with Node.
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
const XsdValidator = require(path.join(root, 'src', 'xsd-validator.js'));
const PdfA3Checks = require(path.join(root, 'src', 'pdfa3-checks.js'));
const XmlEncoding = require(path.join(root, 'src', 'xml-encoding.js'));
const VatRelevance = require(path.join(root, 'src', 'vat-relevance.js'));

/** build/bt-paths.json without its provenance fields: the part the program uses (syntax binding, groups) */
function vatPaths() {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'build', 'bt-paths.json'), 'utf8'));
  return { syntax: j.syntax, groups: j.groups };
}

/** opts.exclude: regular expression of rule-set ids to treat as unavailable (e.g. /^PEPPOL-/ to mirror the browser build) */
function createEnv(opts) {
  opts = opts || {};
  // the same environment as the browser build (tools/build-standalone.cjs embeds the same JSON files)
  const loadJson = (dir, id) => { const f = path.join(root, 'build', dir, id + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const ruleSetCache = {}, xsdCache = {};
  const env = {
    fontoxpath: fx, SchematronRunner, XsdValidator, PdfEmbedded, PdfA3Checks, XmlEncoding, InvoiceModel, VatRelevance,
    // the same data as the browser build (window.PRUEFER_VAT): legal table and syntax binding
    vatData: { legal: JSON.parse(fs.readFileSync(path.join(root, 'legal', 'ust-pflichtangaben.json'), 'utf8')), paths: vatPaths() },
    scenarios: JSON.parse(fs.readFileSync(path.join(root, 'build', 'scenarios.json'), 'utf8')),
    rulesets: JSON.parse(fs.readFileSync(path.join(root, 'build', 'rulesets.json'), 'utf8')),
    ruleSet: (id) => (id in ruleSetCache ? ruleSetCache[id] : (ruleSetCache[id] = loadJson('schemas', id))),
    xsdModel: (id) => (id in xsdCache ? xsdCache[id] : (xsdCache[id] = loadJson('xsd', id))),
    missingReason: (id) => (/^PEPPOL-/.test(id) ? 'Peppol-Regeln nicht vorhanden: sh tools/compile-rules.sh <ext> mit geklontem peppol-bis-invoice-3 (docs/RULESETS.md, Abschnitt Lizenz)' : 'build/schemas/' + id + '.json fehlt'),
    parseXml: (text) => { try { return { doc: slimdom.parseXmlDocument(text), error: null }; } catch (e) { return { doc: null, error: e.message }; } },
    sha256: async (b) => crypto.createHash('sha256').update(b).digest('hex'),
  };
  if (opts.exclude) { const orig = env.ruleSet; env.ruleSet = (id) => (opts.exclude.test(id) ? null : orig(id)); }
  return env;
}
module.exports = { createEnv, vatPaths, fx, slimdom };
