#!/usr/bin/env node
/*
 * run-xmute-tests.cjs — executes the KoSIT xrechnung-schematron test corpus
 * (test/instances/{ubl-inv,ubl-cn,cii}) which is annotated with XML-Mutate
 * processing instructions:
 *
 *   <?xmute mutator="identity|remove|empty|code|whitespace" [values="a,b" separator=","]
 *           [attribute="name"] schematron-valid="xrubl:ID ..." schematron-invalid="xrubl:ID ..."
 *           id="..." description="..." ?>
 *
 * A PI targets the next element sibling. Each mutation is applied to a fresh copy of the
 * document, the XRechnung Schematron (UBL or CII) is executed and the expectations are
 * checked: schematron-valid = the rule id must NOT be reported, schematron-invalid = the
 * rule id MUST be reported. Mutators (per XML-Mutate 0.6 documentation):
 *   identity   — no change
 *   remove     — remove the target element
 *   empty      — remove the target's child nodes (attributes are kept)
 *   code       — replace the text content (or @attribute) with each of the listed values
 *   whitespace — surround the text content with whitespace (variants: prefix, suffix, both)
 *
 * Usage: node run-xmute-tests.cjs <xrechnung-schematron-repo-dir> [--verbose] [--filter substring] [--cen]
 *   --cen  additionally run the CEN EN16931 Schematron so that expectations referring to CEN
 *          rule ids (if any) can be satisfied.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require(path.join(__dirname, '..', 'vendor', 'fontoxpath.cjs'));
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const SR = require(path.join(__dirname, '..', 'src', 'schematron.js'));

const args = process.argv.slice(2);
const repo = args[0];
const verbose = args.includes('--verbose');
const withCen = args.includes('--cen');
const fIdx = args.indexOf('--filter');
const filter = fIdx >= 0 ? args[fIdx + 1] : null;

function load(id) {
  return SR.create(fx, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'schemas', id + '.json'), 'utf8')));
}
const validators = {
  xrubl: [load('XRechnung-UBL')].concat(withCen ? [load('EN16931-UBL')] : []),
  xrcii: [load('XRechnung-CII')].concat(withCen ? [load('EN16931-CII')] : []),
};

function parsePI(data) {
  const attrs = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(data)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function splitIds(s) {
  return (s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

function nextElementSibling(node) {
  let n = node.nextSibling;
  while (n && n.nodeType !== 1) n = n.nextSibling;
  return n;
}

function pathTo(node) {
  // index path from the document element to node (list of child-element indexes)
  const p = [];
  let n = node;
  while (n && n.parentNode && n.parentNode.nodeType !== 9) {
    const parent = n.parentNode;
    let idx = 0;
    for (let c = parent.firstChild; c && c !== n; c = c.nextSibling) if (c.nodeType === 1) idx++;
    p.unshift(idx);
    n = parent;
  }
  return p;
}

function resolvePath(doc, p) {
  let n = doc.documentElement;
  for (const idx of p) {
    let i = 0, found = null;
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        if (i === idx) { found = c; break; }
        i++;
      }
    }
    if (!found) throw new Error('path resolution failed');
    n = found;
  }
  return n;
}

function mutations(attrs) {
  const mut = attrs.mutator || 'identity';
  switch (mut) {
    case 'identity':
      return [{ name: 'identity', apply: () => {} }];
    case 'remove':
      if (attrs.attribute) return [{ name: 'remove@' + attrs.attribute, apply: (el) => el.removeAttribute(attrs.attribute) }];
      return [{ name: 'remove', apply: (el) => el.parentNode.removeChild(el) }];
    case 'empty':
      if (attrs.attribute) return [{ name: 'empty@' + attrs.attribute, apply: (el) => el.setAttribute(attrs.attribute, '') }];
      return [{ name: 'empty', apply: (el) => { while (el.firstChild) el.removeChild(el.firstChild); } }];
    case 'code': {
      const sep = attrs.separator || ',';
      const values = (attrs.values || '').split(sep).map((v) => v.trim());
      return values.map((v) => ({
        name: 'code=' + JSON.stringify(v),
        apply: (el) => {
          if (attrs.attribute) el.setAttribute(attrs.attribute, v);
          else {
            while (el.firstChild) el.removeChild(el.firstChild);
            el.appendChild(el.ownerDocument.createTextNode(v));
          }
        },
      }));
    }
    case 'whitespace':
      return ['prefix', 'suffix', 'both'].map((variant) => ({
        name: 'whitespace:' + variant,
        apply: (el) => {
          const text = el.textContent;
          while (el.firstChild) el.removeChild(el.firstChild);
          const v = (variant !== 'suffix' ? '  ' : '') + text + (variant !== 'prefix' ? '  ' : '');
          el.appendChild(el.ownerDocument.createTextNode(v));
        },
      }));
    default:
      throw new Error('unsupported mutator ' + mut);
  }
}

// Known, documented deviations from the Saxon reference (see test/KNOWN_DEVIATIONS.json).
const knownPath = path.join(__dirname, 'KNOWN_DEVIATIONS.json');
const known = fs.existsSync(knownPath) ? JSON.parse(fs.readFileSync(knownPath, 'utf8')).xmute || [] : [];
function isKnown(file, testId, mutationName) {
  return known.find((k) => file.endsWith(k.file) && k.id === testId && (!k.mutation || k.mutation === mutationName));
}
let total = 0, passed = 0, failed = 0, skipped = 0, knownDeviations = 0;
const failures = [];
const t0 = Date.now();
const dirs = ['test/instances/ubl-inv', 'test/instances/ubl-cn', 'test/instances/cii'];
for (const dir of dirs) {
  const full = path.join(repo, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full).sort()) {
    if (!file.endsWith('.xml')) continue;
    if (filter && !file.includes(filter)) continue;
    const xml = fs.readFileSync(path.join(full, file), 'utf8');
    let doc;
    try {
      doc = slimdom.parseXmlDocument(xml);
    } catch (e) {
      failures.push({ file: dir + '/' + file, test: '-', msg: 'XML parse error: ' + e.message });
      failed++;
      continue;
    }
    // collect PIs with their targets (as index paths) before mutating
    const pis = [];
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 7 && c.target === 'xmute') {
          const target = nextElementSibling(c);
          pis.push({ attrs: parsePI(c.data), targetPath: target ? pathTo(target) : null });
        }
        if (c.nodeType === 1) walk(c);
      }
    })(doc);

    for (const pi of pis) {
      const a = pi.attrs;
      const valid = splitIds(a['schematron-valid']);
      const invalid = splitIds(a['schematron-invalid']);
      if (!valid.length && !invalid.length) { skipped++; continue; }
      const prefixes = new Set([...valid, ...invalid].map((x) => x.split(':')[0]));
      for (const m of mutations(a)) {
        total++;
        let problems = [];
        try {
          const copy = slimdom.parseXmlDocument(xml);
          if (pi.targetPath === null) throw new Error('PI has no target element');
          const target = resolvePath(copy, pi.targetPath);
          m.apply(target);
          const reported = new Map(); // "prefix:ID" -> count
          for (const prefix of prefixes) {
            const vs = validators[prefix];
            if (!vs) throw new Error('unknown schematron prefix ' + prefix);
            for (const v of vs) {
              const rep = v.validate(copy);
              for (const f of rep.findings) reported.set(prefix + ':' + f.id, (reported.get(prefix + ':' + f.id) || 0) + 1);
              for (const pe of rep.processingErrors) problems.push(`processing error ${pe.id || ''}: ${pe.message.slice(0, 140)}`);
            }
          }
          for (const id of valid) if (reported.has(id)) problems.push(`expected ${id} valid but reported ${reported.get(id)}x`);
          for (const id of invalid) if (!reported.has(id)) problems.push(`expected ${id} invalid but not reported`);
        } catch (e) {
          problems.push('exception: ' + e.message);
        }
        if (problems.length) {
          const k = isKnown(dir + '/' + file, a.id, m.name);
          if (k) {
            knownDeviations++;
            if (verbose) console.log(`KNOWN  ${dir}/${file} ${a.id} [${m.name}]: ${k.reason}`);
          } else {
            failed++;
            failures.push({ file: dir + '/' + file, test: (a.id || '?') + ' [' + m.name + ']', msg: problems.join('; '), description: a.description });
          }
        } else passed++;
      }
    }
  }
}
const ms = Date.now() - t0;
for (const f of failures) console.log(`FAIL ${f.file} ${f.test}: ${f.msg}${f.description ? '  [' + f.description + ']' : ''}`);
console.log(`\nXRechnung xmute tests: ${passed} passed, ${failed} failed, ${knownDeviations} known deviations (documented), ${skipped} skipped, ${total} mutations in ${ms} ms`);
process.exit(failed ? 1 : 0);
