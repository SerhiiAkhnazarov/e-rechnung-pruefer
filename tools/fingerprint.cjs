#!/usr/bin/env node
/*
 * fingerprint.cjs — the version axis of a verification run.
 *
 * Computes a deterministic fingerprint of everything a test result depends on:
 *   - the frozen standards corpus (SHA-256 of build/STANDARDS_MANIFEST.json, which itself pins
 *     every source repository commit and every consumed source file),
 *   - the engine (patch, vendored bundles), the runtime sources (src/*.js),
 *   - every compiled rule set, XSD model and the scenario table (build/schemas, build/xsd,
 *     build/scenarios.json),
 *   - the reference toolchain used by the oracle tests (Saxon jar, Java, Node, Playwright browser).
 *
 * `id` is the SHA-256 of the canonical JSON of the content part (files + toolchain), so two runs
 * with the same id were made on byte-identical inputs. The git commit is recorded beside it but is
 * not part of the id (a re-commit of identical content does not change the id).
 *
 * Usage:  node tools/fingerprint.cjs            → prints the fingerprint JSON
 *         require('./fingerprint.cjs').compute() → object
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function filesIn(dir, filter) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => fs.statSync(path.join(abs, f)).isFile() && (!filter || filter(f))).sort().map((f) => path.join(dir, f));
}

function filesUnder(dir, filter) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile() && (!filter || filter(p))) out.push(p);
    }
  })(dir);
  return out;
}

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) }).trim();
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    return out || null;
  }
}

function javaVersion() {
  // `java -version` writes to stderr
  try {
    const r = require('child_process').spawnSync('java', ['-version'], { encoding: 'utf8', env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
    const line = (r.stderr || '').split('\n').find((l) => /version/.test(l));
    return line ? line.trim() : null;
  } catch (e) { return null; }
}

function compute(opts) {
  opts = opts || {};
  const files = {};
  const groups = {
    manifest: ['build/STANDARDS_MANIFEST.json'],
    patch: filesIn('patches'),
    vendor: filesIn('vendor'),
    runtime: filesIn('src'),
    // PEPPOL-*.json are compiled locally from the pinned Peppol source (manifest) and never shipped or
    // committed; their inputs (source SHA in the manifest, compiler in src/) are covered above
    rulesets: filesIn('build/schemas', (f) => f.endsWith('.json') && !/^PEPPOL-/.test(f)),
    xsdModels: filesIn('build/xsd', (f) => f.endsWith('.json')),
    scenarios: ['build/scenarios.json'].concat(fs.existsSync(path.join(root, 'build', 'rulesets.json')) ? ['build/rulesets.json'] : []),
    tools: filesIn('tools', (f) => /\.(cjs|sh)$/.test(f)).concat(filesUnder('tools/verapdf')),
    tests: filesUnder('test', (f) => !f.endsWith('.class')),  // scripts, oracles' sources, expectations, test schemas
    // dist/ is not an input: it is generated from the groups above by tools/build-standalone.cjs and
    // embeds the verification status itself (it would otherwise change the fingerprint it reports)
  };
  for (const [g, list] of Object.entries(groups)) {
    files[g] = {};
    for (const f of list) if (fs.existsSync(path.join(root, f))) files[g][f] = sha(path.join(root, f));
  }
  const saxonJar = opts.saxonJar || process.env.SAXON_JAR || path.join(process.env.EXT_DIR || path.join(root, 'ext'), 'saxon', 'saxon-he-12.8.jar');
  let playwright = null;
  // playwright-core: PLAYWRIGHT_DIR, next to PLAYWRIGHT_MODULE (test/resolve-tool.cjs), or node_modules of the project
  for (const p of [process.env.PLAYWRIGHT_DIR, process.env.PLAYWRIGHT_MODULE && path.join(path.dirname(process.env.PLAYWRIGHT_MODULE), 'playwright-core'), path.join(root, 'node_modules', 'playwright-core')].filter(Boolean)) {
    const bj = path.join(p, 'browsers.json');
    if (fs.existsSync(bj)) {
      const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
      const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
      // browser builds this Playwright version uses (its browsers.json) – whether each one is installed is
      // recorded per suite in VERIFICATION.json ('not-run: browser … not installed')
      playwright = { version: pkg.version, browserBuilds: b.browsers.filter((x) => ['chromium', 'webkit', 'firefox'].includes(x.name)).map((x) => x.name + ' ' + (x.browserVersion || x.revision)) };
      break;
    }
  }
  const toolchain = {
    node: process.version,
    java: javaVersion(),
    saxon: fs.existsSync(saxonJar) ? { jar: path.basename(saxonJar), sha256: sha(saxonJar) } : null,
    playwright,
  };
  const content = { files, toolchain };
  const id = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  // filesId: the file inputs alone (without the toolchain), so that a build on another machine can tell
  // whether a verification report belongs to exactly these sources (tools/build-standalone.cjs)
  const filesId = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const git = {
    commit: tryRun('git', ['-C', root, 'rev-parse', 'HEAD']),
    // inputs that differ from the commit (modified or not yet committed); outputs (dist/, build/reports/) and
    // work files are not inputs
    dirty: (tryRun('git', ['-C', root, 'status', '--porcelain', '--'].concat(Object.values(files).flatMap((g) => Object.keys(g)))) || '').length > 0,
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'STANDARDS_MANIFEST.json'), 'utf8'));
  const standards = {};
  for (const [name, s] of Object.entries(manifest.sources)) standards[name] = s.commit ? s.commit.slice(0, 12) + (s.describe && s.describe !== s.commit.slice(0, 7) ? ' (' + s.describe + ')' : '') : (s.sha256 ? 'sha256 ' + s.sha256.slice(0, 12) : null);
  return { id, short: id.slice(0, 16), filesId, computed: new Date().toISOString(), git, standards, toolchain, files };
}

module.exports = { compute };
if (require.main === module) console.log(JSON.stringify(compute(), null, 2));
