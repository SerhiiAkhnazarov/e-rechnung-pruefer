#!/usr/bin/env node
/*
 * sarif-summary.cjs — the results of a static analysis (SARIF 2.1.0, e.g. the output directory of
 * github/codeql-action/analyze) as plain text for a check run, so that every finding is readable through the REST API
 * (GET /repos/{owner}/{repo}/commits/{sha}/check-runs → output.text) and not only in the Security tab: tool and
 * version, query suite size, and for every result rule, level, security severity, location and message; results that
 * the analysis marks as suppressed are listed separately.
 * Used by .github/workflows/security.yml; not an input of the verification (not in tools/fingerprint.cjs).
 *
 * Usage: node .github/scripts/sarif-summary.cjs <file.sarif | directory> ...
 *   exit code 0 when there is no result that is not suppressed, 1 when there is one, 2 when no SARIF file is readable
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');

const inputs = process.argv.slice(2);
const files = [];
for (const p of inputs) {
  try {
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (f.endsWith('.sarif')) files.push(path.join(p, f)); }
    else files.push(p);
  } catch (e) { console.log(p + ': ' + e.code); }
}

const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
let open = 0, suppressed = 0, readable = 0;
const out = [];
for (const f of files) {
  let sarif;
  try { sarif = JSON.parse(fs.readFileSync(f, 'utf8')); readable++; } catch (e) { out.push(f + ': not readable (' + e.message + ')'); continue; }
  for (const run of sarif.runs || []) {
    const driver = (run.tool && run.tool.driver) || {};
    const rules = new Map();
    for (const r of driver.rules || []) rules.set(r.id, r);
    for (const ext of (run.tool && run.tool.extensions) || []) for (const r of ext.rules || []) if (!rules.has(r.id)) rules.set(r.id, r);
    const results = run.results || [];
    const lang = (run.properties && run.properties.semmle && run.properties.semmle.language) || (run.automationDetails && run.automationDetails.id) || '';
    out.push('# ' + path.basename(f) + ': ' + (driver.name || '?') + ' ' + (driver.semanticVersion || driver.version || '') + (lang ? ' (' + lang + ')' : '') + ', ' + rules.size + ' rules, ' + results.length + ' results');
    const rows = [];
    for (const res of results) {
      const rule = rules.get(res.ruleId) || (res.rule && res.rule.index != null && driver.rules ? driver.rules[res.rule.index] : null) || {};
      const props = rule.properties || {};
      const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
      const where = loc ? (loc.artifactLocation && loc.artifactLocation.uri) + ':' + (loc.region && loc.region.startLine || '?') + (loc.region && loc.region.startColumn ? ':' + loc.region.startColumn : '') : '(no location)';
      const isSuppressed = (res.suppressions || []).some((s) => !s.status || s.status === 'accepted');
      if (isSuppressed) suppressed++; else open++;
      rows.push({
        key: (isSuppressed ? '1' : '0') + where,
        text: (isSuppressed ? 'SUPPRESSED ' : '') + (res.ruleId || rule.id || '?') + ' [' + (res.level || (rule.defaultConfiguration && rule.defaultConfiguration.level) || 'warning') +
          (props['security-severity'] ? ', security-severity ' + props['security-severity'] : '') + (props.precision ? ', precision ' + props.precision : '') + '] ' + where +
          '\n    ' + one(res.message && res.message.text).slice(0, 600) + (rule.shortDescription ? '\n    rule: ' + one(rule.shortDescription.text) : ''),
      });
    }
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const r of rows) out.push(r.text);
    out.push('');
  }
}
console.log((readable ? open + ' open result(s), ' + suppressed + ' suppressed, in ' + readable + ' SARIF file(s)' : 'no readable SARIF file') + '\n');
console.log(out.join('\n'));
process.exit(!readable ? 2 : open ? 1 : 0);
