#!/usr/bin/env node
/*
 * make-vex.cjs — the VEX document (Vulnerability Exploitability eXchange) of the program: dist/vex.cdx.json, CycloneDX
 * 1.6, a document of its own beside the SBOM (BSI TR-03183-2 v2.1.0, 3.1 and 8.1.14: an SBOM must not contain
 * vulnerability information; CycloneDX recommends decoupling VEX from the BOM). Every statement of security/vex.json
 * refers to a component of dist/sbom.cdx.json by BOM-Link (urn:cdx:<serialNumber>/<version>#<bom-ref>).
 *
 * Usage: node tools/make-vex.cjs [--out dist/vex.cdx.json]   (reads dist/sbom.cdx.json, security/vex.json)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const STATES = ['resolved', 'resolved_with_pedigree', 'exploitable', 'in_triage', 'false_positive', 'not_affected'];
const JUSTIFICATIONS = ['code_not_present', 'code_not_reachable', 'requires_configuration', 'requires_dependency', 'requires_environment', 'protected_by_compiler', 'protected_at_runtime', 'protected_at_perimeter', 'protected_by_mitigating_control'];

function uuidFrom(hex) {
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20, 32);
}

function makeVex(sbomText, statements) {
  const sbom = JSON.parse(sbomText);
  const serial = String(sbom.serialNumber || '').replace(/^urn:uuid:/, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(serial)) throw new Error('make-vex: the SBOM has no RFC 4122 serial number');
  const refs = new Set([sbom.metadata.component['bom-ref']].concat(sbom.components.map((c) => c['bom-ref'])));
  const vulnerabilities = statements.map((s) => {
    if (!refs.has(s.affects)) throw new Error('make-vex: ' + s.id + ' refers to ' + s.affects + ', which is not a component of the SBOM');
    if (!STATES.includes(s.state)) throw new Error('make-vex: ' + s.id + ': unknown state ' + s.state);
    if (s.state === 'not_affected' && !JUSTIFICATIONS.includes(s.justification)) throw new Error('make-vex: ' + s.id + ': not_affected needs a justification of CycloneDX');
    const v = {
      'bom-ref': 'vex:' + s.id,
      id: s.id,
      source: /^CVE-/.test(s.id) ? { name: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/' + s.id } : s.source,
      references: (s.aliases || []).map((a) => ({ id: a, source: /^GHSA-/.test(a) ? { name: 'GitHub Advisory Database', url: 'https://github.com/advisories/' + a } : { name: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/' + a } })),
    };
    if (s.cwes && s.cwes.length) v.cwes = s.cwes;
    v.description = s.description;
    v.analysis = { state: s.state };
    if (s.justification) v.analysis.justification = s.justification;
    if (s.response) v.analysis.response = s.response;
    v.analysis.detail = s.detail + (s.ancestor ? ' (Component lineage: ' + s.ancestor + ', pedigree of ' + s.affects + ' in the SBOM.)' : '');
    v.analysis.firstIssued = s.firstIssued;
    v.analysis.lastUpdated = s.lastUpdated;
    v.affects = [{ ref: 'urn:cdx:' + serial + '/' + sbom.version + '#' + s.affects }];
    return v;
  });
  const latest = statements.map((s) => s.lastUpdated).sort().pop() || sbom.metadata.timestamp;
  const top = sbom.metadata.component;
  const vex = {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:' + uuidFrom(sha('E-Rechnung Prüfer VEX ' + sbom.serialNumber + ' ' + JSON.stringify(vulnerabilities))),
    version: 1,
    metadata: {
      timestamp: latest > sbom.metadata.timestamp ? latest : sbom.metadata.timestamp,
      tools: { components: [{ type: 'application', name: 'tools/make-vex.cjs (E-Rechnung Prüfer)', version: top.version }] },
      manufacturer: sbom.metadata.manufacturer,
      component: { type: top.type, 'bom-ref': top['bom-ref'], name: top.name, version: top.version, purl: top.purl },
      properties: [
        { name: 'e-rechnung-pruefer:sbom', value: 'urn:cdx:' + serial + '/' + sbom.version },
        { name: 'e-rechnung-pruefer:scope', value: 'every known vulnerability of a component of the program or of a component it derives from (pedigree), with its assessment; vulnerabilities of the build and test environment: test-environment.cdx.json and the OSV report of the workflow security' },
      ],
    },
    vulnerabilities,
  };
  return JSON.stringify(vex, null, 2) + '\n';
}

module.exports = { makeVex, STATES, JUSTIFICATIONS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(root, 'dist', 'vex.cdx.json'));
  const text = makeVex(fs.readFileSync(path.join(root, 'dist', 'sbom.cdx.json'), 'utf8'), JSON.parse(fs.readFileSync(path.join(root, 'security', 'vex.json'), 'utf8')).statements);
  fs.writeFileSync(out, text);
  console.log(out + ': CycloneDX 1.6 VEX, ' + JSON.parse(text).vulnerabilities.length + ' statements, SHA-256 ' + sha(text));
}
