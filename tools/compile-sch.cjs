#!/usr/bin/env node
/*
 * compile-sch.cjs — Node front end of src/sch-compiler.js: compiles an ISO Schematron file into the JSON
 * rule set executed by src/schematron.js. Source files are recorded as "<repository>/<path>" (the name of
 * the enclosing git working tree + the path inside it), so the output does not depend on the machine.
 *
 * Usage: node compile-sch.cjs <schema.sch> <out.json> [--id ID]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SchCompiler = require(path.join(__dirname, '..', 'src', 'sch-compiler.js'));

function repoRelative(abs) {
  for (let d = path.dirname(abs); d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return path.basename(fs.realpathSync(d)) + '/' + path.relative(d, abs).split(path.sep).join('/');
  }
  return path.basename(abs);
}

const nodeHost = {
  read: (p) => fs.readFileSync(p, 'utf8'),
  exists: (p) => fs.existsSync(p),
  resolve: (...parts) => path.resolve(...parts),
  dirname: (p) => path.dirname(p),
  basename: (p) => path.basename(p),
  parseXml: (t) => slimdom.parseXmlDocument(t),
  serialize: (d) => slimdom.serializeToWellFormedString(d),
  sha256: (t) => crypto.createHash('sha256').update(t).digest('hex'),
  byteLength: (t) => Buffer.byteLength(t),
  sourceName: (p) => repoRelative(fs.realpathSync(p)),
};

function compile(file, id) { return SchCompiler.compile(nodeHost, file, id); }

if (require.main === module) {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf('--id');
  let id = null;
  if (idIdx >= 0) { id = args[idIdx + 1]; args.splice(idIdx, 2); }
  const [input, output] = args;
  if (!input || !output) {
    console.error('usage: compile-sch.cjs <schema.sch> <out.json> [--id ID]');
    process.exit(2);
  }
  const compiled = compile(input, id);
  fs.writeFileSync(output, JSON.stringify(compiled, null, 1));
  console.log(`${compiled.id}: ${compiled.stats.patterns} patterns, ${compiled.stats.rules} rules, ${compiled.stats.asserts} asserts, ${compiled.stats.globals} globals, functions: ${compiled.functions.length} declared, ${compiled.functions.filter((f) => f.inlined).length} inlined, ${compiled.functions.filter((f) => f.used).map((f) => f.name).join(',') || '-'} registered at runtime, documents: ${compiled.documents.length}${compiled.documents.map((d) => ' (' + d.href + ' ' + d.bytes + ' -> ' + Buffer.byteLength(d.xml) + ' bytes)').join('')} -> ${output} (${fs.statSync(output).size} bytes, ${JSON.stringify(compiled).length} compact)`);
}

module.exports = { compile };
