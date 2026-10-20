/*
 * sch-compiler.js — compiles ISO Schematron (queryBinding="xslt2") into the JSON structure that
 * src/schematron.js executes with fontoxpath. Environment-neutral (Node and browser): every file system,
 * XML and hashing operation goes through the `host` object passed to compile():
 *   host.read(path) → text            host.exists(path) → boolean
 *   host.resolve(base?, href) → path  host.dirname(path) / host.basename(path)
 *   host.parseXml(text) → Document    host.serialize(doc) → text
 *   host.sha256(text) → hex           host.byteLength(text) → UTF-8 byte count
 *   host.sourceName(path) → the name recorded in "sources" (e.g. "<repository>/<path in repository>")
 * tools/compile-sch.cjs is the Node host; the browser app uses it to compile rule files the user loads.
 * Licence: EUPL-1.2
 */
/*
 * compile-sch.cjs — compiles ISO Schematron (queryBinding="xslt2") sources into
 * a plain JSON structure that src/schematron.js executes at runtime with fontoxpath.
 *
 * Supported: ns, let (schema/pattern/phase level = global; rule level = local),
 * pattern, rule (context, flag), assert/report (id, flag, role, test, message with
 * <name/>, <name path/>, <value-of select/>), include (inlined), phase (recorded),
 * xsl:function (inlined into the calling expressions; recursive ones registered at runtime),
 * document('file.xml') next to the schema (embedded as $__document_N in compact form, see minifyXml).
 *
 * Rejected (not needed by CEN EN16931 / XRechnung sources; fail loudly instead of
 * silently producing wrong results): abstract patterns/rules, is-a, extends, diagnostics
 * references, key()/current() usage inside expressions.
 *
 * Usage: node compile-sch.cjs <schema.sch> <out.json> [--id ID]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SchCompiler = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
let H = null;
// comments of the source files outside their schema element (licence and permission notices, release notes),
// kept verbatim with the compiled form (EUPL-1.2 Art. 5, Apache-2.0 §4(c)); main file first, then includes
let sourceNotices = [];
const SCH_NS = 'http://purl.oclc.org/dsdl/schematron';
const XSL_NS = 'http://www.w3.org/1999/XSL/Transform';

function isEl(node, localName, ns = SCH_NS) {
  return node && node.nodeType === 1 && node.namespaceURI === ns && node.localName === localName;
}

function childElements(el) {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 1);
}

function parseFile(file, seen) {
  const abs = H.resolve(file);
  if (seen.has(abs)) throw new Error('include cycle: ' + abs);
  seen.add(abs);
  const text = H.read(abs);
  const doc = H.parseXml(text);
  for (let n = doc.firstChild; n; n = n.nextSibling) if (n.nodeType === 8) sourceNotices.push(String(n.data).trim());
  return { doc, abs, sha256: H.sha256(text), bytes: H.byteLength(text) };
}

/** Replace every <include href> with the root element of the included file (ISO 19757-3 §6.2). */
function resolveIncludes(el, baseFile, seen, sources) {
  for (const child of childElements(el)) {
    if (isEl(child, 'include')) {
      const href = child.getAttribute('href');
      const target = H.resolve(H.dirname(baseFile), href);
      const inc = parseFile(target, new Set(seen));
      sources.push({ file: H.sourceName(inc.abs), sha256: inc.sha256, bytes: inc.bytes });
      const imported = el.ownerDocument.importNode(inc.doc.documentElement, true);
      resolveIncludes(imported, target, seen, sources);
      el.replaceChild(imported, child);
    } else {
      resolveIncludes(child, baseFile, seen, sources);
    }
  }
}

function textOf(node) {
  return node.textContent;
}

/** Message = sequence of parts: {t:'text',v} | {t:'name',path?} | {t:'value-of',select} */
function messageParts(el) {
  const parts = [];
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 || n.nodeType === 4) {
      parts.push({ t: 'text', v: n.data });
    } else if (n.nodeType === 1) {
      if (isEl(n, 'name')) {
        const p = n.getAttribute('path');
        parts.push(p ? { t: 'name', path: p } : { t: 'name' });
      } else if (isEl(n, 'value-of')) {
        parts.push({ t: 'value-of', select: n.getAttribute('select') });
      } else if (isEl(n, 'emph') || isEl(n, 'span') || isEl(n, 'dir')) {
        parts.push(...messageParts(n));
      } else {
        throw new Error('Unsupported element in assert message: ' + n.nodeName);
      }
    }
  }
  return parts;
}

function compileLet(el) {
  if (el.hasAttribute('value')) return { name: el.getAttribute('name'), value: el.getAttribute('value') };
  // ISO Schematron allows the value as element content (as a sequence constructor in XSLT2 binding).
  throw new Error('let without @value is not supported: ' + el.getAttribute('name'));
}

function compileRule(ruleEl, patternId) {
  if (ruleEl.getAttribute('abstract') === 'true') throw new Error('abstract rules are not supported');
  const rule = {
    context: ruleEl.getAttribute('context'),
    flag: ruleEl.getAttribute('flag') || null,
    role: ruleEl.getAttribute('role') || null,
    lets: [],
    asserts: [],
  };
  if (!rule.context) throw new Error('rule without @context in pattern ' + patternId);
  for (const c of childElements(ruleEl)) {
    if (isEl(c, 'let')) rule.lets.push(compileLet(c));
    else if (isEl(c, 'assert') || isEl(c, 'report')) {
      if (c.hasAttribute('diagnostics')) throw new Error('diagnostics are not supported (assert ' + c.getAttribute('id') + ')');
      rule.asserts.push({
        kind: c.localName, // 'assert' fails when test is false; 'report' fires when test is true
        id: c.getAttribute('id') || null,
        flag: c.getAttribute('flag') || null,
        role: c.getAttribute('role') || null,
        test: c.getAttribute('test'),
        msg: messageParts(c),
      });
    } else if (isEl(c, 'extends')) throw new Error('extends is not supported');
    else if (isEl(c, 'p') || isEl(c, 'title')) {
      /* documentation */
    } else throw new Error('Unsupported child of rule: ' + c.nodeName);
  }
  return rule;
}

/**
 * Translate the body of an xsl:function (xsl:variable / xsl:sequence / xsl:choose / xsl:if) into one
 * XPath 3.1 expression: variables become `let` bindings, choose/when/otherwise become if-then-else.
 */
function xslBodyToXPath(items, fnName) {
  const lets = [];
  let result = null;
  for (const k of items) {
    if (k.nodeType !== 1) continue;
    if (isEl(k, 'variable', XSL_NS)) {
      const name = k.getAttribute('name');
      let value;
      if (k.hasAttribute('select')) value = k.getAttribute('select');
      else {
        const kids = childElements(k);
        if (kids.length) value = xslBodyToXPath(kids, fnName + '/' + name);
        else value = "'" + k.textContent.replace(/'/g, "''") + "'";
      }
      const as = k.getAttribute('as');
      if (as && /^xs:[A-Za-z]+$/.test(as)) value = as + '(' + value + ')';
      lets.push({ name, value });
    } else if (isEl(k, 'sequence', XSL_NS) || isEl(k, 'value-of', XSL_NS)) {
      if (result !== null) throw new Error('xsl:function ' + fnName + ': more than one result expression is not supported');
      result = k.getAttribute('select');
    } else if (isEl(k, 'choose', XSL_NS)) {
      if (result !== null) throw new Error('xsl:function ' + fnName + ': choose after a result expression is not supported');
      const branches = [];
      let otherwise = '()';
      for (const b of childElements(k)) {
        if (isEl(b, 'when', XSL_NS)) branches.push({ test: b.getAttribute('test'), body: xslBodyToXPath(childElements(b), fnName + '/when') });
        else if (isEl(b, 'otherwise', XSL_NS)) otherwise = xslBodyToXPath(childElements(b), fnName + '/otherwise');
      }
      result = branches.reduceRight((acc, br) => 'if (' + br.test + ') then (' + br.body + ') else (' + acc + ')', otherwise);
    } else if (isEl(k, 'if', XSL_NS)) {
      if (result !== null) throw new Error('xsl:function ' + fnName + ': if after a result expression is not supported');
      result = 'if (' + k.getAttribute('test') + ') then (' + xslBodyToXPath(childElements(k), fnName + '/if') + ') else ()';
    } else {
      throw new Error('xsl:function ' + fnName + ': unsupported instruction ' + k.nodeName);
    }
  }
  if (result === null) throw new Error('xsl:function ' + fnName + ': no result expression');
  if (!lets.length) return result;
  return 'let ' + lets.map((l) => '$' + l.name + ' := (' + l.value + ')').join(', ') + ' return (' + result + ')';
}

/** Find the balanced argument list that starts at `start` (index of the opening parenthesis). */
function readArguments(expr, start) {
  let depth = 0, quote = null, argStart = start + 1;
  const args = [];
  for (let i = start; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') {
      depth--;
      if (depth === 0) { args.push(expr.slice(argStart, i)); return { args: args.map((a) => a.trim()).filter((a, k, arr) => !(arr.length === 1 && a === '')), end: i + 1 }; }
    } else if (ch === ',' && depth === 1) { args.push(expr.slice(argStart, i)); argStart = i + 1; }
  }
  throw new Error('unbalanced parentheses in ' + expr.slice(0, 80));
}

/** Function conversion for an inlined parameter according to its declared type. */
function convertArgument(arg, as) {
  if (!as) return arg;
  const m = /^(xs:[A-Za-z]+)([?*+]?)$/.exec(as.trim());
  if (!m) return arg;
  const type = m[1];
  if (type === 'xs:anyAtomicType' || type === 'xs:untypedAtomic') return 'data(' + arg + ')';
  // cast each atomized item (empty sequence stays empty; xs:string on a node atomizes first)
  return '(for $__a in data(' + arg + ') return ' + type + '($__a))';
}

// reset at the start of every compilation (compileWith) so that the output depends only on the input:
// the browser compiles several files in one page, the Node build one per process
let inlineCounter = 0;
/**
 * Replace every call of an inlinable xsl:function by a `let` expression carrying the function body.
 * Parameter and variable names get a unique suffix so that they cannot collide with the caller's
 * variables. Returns the rewritten expression.
 */
function inlineCalls(expr, inlinable, depth) {
  depth = depth || 0;
  if (depth > 25) throw new Error('function inlining too deep (recursion?)');
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of inlinable) {
      const re = new RegExp('(?<![\\w.:-])' + fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(expr)) !== null) {
        const callStart = m.index;
        const parenPos = m.index + m[0].length - 1;
        const { args, end } = readArguments(expr, parenPos);
        if (args.length !== fn.params.length) throw new Error('call of ' + fn.name + ' with ' + args.length + ' arguments, expected ' + fn.params.length);
        const suffix = '__f' + (++inlineCounter);
        let body = fn.body;
        const names = new Set(fn.params.map((p) => p.name));
        for (const v of body.matchAll(/\blet \$([A-Za-z_][\w.-]*) :=|, \$([A-Za-z_][\w.-]*) :=/g)) names.add(v[1] || v[2]);
        for (const name of names) body = body.replace(new RegExp('\\$' + name.replace(/[.-]/g, '\\$&') + '(?![\\w.-])', 'g'), '$' + name + suffix);
        const binds = fn.params.map((p, i) => '$' + p.name + suffix + ' := (' + convertArgument(args[i], p.as) + ')');
        let replacement = '(let ' + binds.join(', ') + ' return (' + body + '))';
        if (fn.as && /^xs:[A-Za-z]+$/.test(fn.as.trim())) replacement = fn.as.trim() + replacement;
        expr = expr.slice(0, callStart) + replacement + expr.slice(end);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return expr;
}

/**
 * Compact form of a document() file for embedding: the XML declaration, comments, processing
 * instructions and whitespace-only text nodes between elements are dropped; elements, attributes
 * and non-blank text are kept unchanged (DOM round trip through slimdom, no textual rewriting).
 * The rules only navigate elements and attributes of these files (code lists:
 * /codedb/cl[@id=N]/enumeration[@value=$v]), so every XPath evaluates identically on the compact
 * tree. The original file's SHA-256 and size are recorded next to the embedded text.
 */
function minifyXml(xml) {
  const doc = H.parseXml(xml);
  (function strip(node) {
    for (let c = node.firstChild; c;) {
      const next = c.nextSibling;
      if (c.nodeType === 8 || c.nodeType === 7 || ((c.nodeType === 3 || c.nodeType === 4) && !c.data.trim())) node.removeChild(c);
      else if (c.nodeType === 1) strip(c);
      c = next;
    }
  })(doc);
  return H.serialize(doc);
}

/** Replace document('file') by a variable bound at runtime to the parsed file. */
function rewriteDocumentCalls(expr, docs, baseDir) {
  return expr.replace(/\bdocument\(\s*'([^']+)'\s*\)/g, (m, href) => {
    let entry = docs.find((d) => d.href === href);
    if (!entry) {
      const file = H.resolve(baseDir, href);
      if (!H.exists(file)) throw new Error('document(' + href + ') not found next to the schema');
      const xml = H.read(file);
      entry = { href, variable: '__document_' + (docs.length + 1), xml: minifyXml(xml), sha256: H.sha256(xml), bytes: H.byteLength(xml), minified: true };
      docs.push(entry);
    }
    return '$' + entry.variable;
  });
}

function compileWith(host, file, id) {
  inlineCounter = 0;
  sourceNotices = [];
  H = host;
  const seen = new Set();
  const main = parseFile(file, seen);
  const sources = [{ file: H.sourceName(main.abs), sha256: main.sha256, bytes: main.bytes }];
  const schema = main.doc.documentElement;
  if (!isEl(schema, 'schema')) throw new Error('root is not sch:schema');
  resolveIncludes(schema, main.abs, seen, sources);

  const out = {
    id: id || H.basename(file).replace(/\.sch$/, ''),
    // modification notice (Apache-2.0 §4(b), EUPL-1.2 Art. 5): this is a compiled form of the files in "sources"
    generator: 'E-Rechnung Prüfer src/sch-compiler.js: ISO Schematron compiled to JSON; rules, tests and messages of the sources unchanged',
    queryBinding: schema.getAttribute('queryBinding') || 'xslt2',
    defaultPhase: schema.getAttribute('defaultPhase') || null,
    title: null,
    ns: {},
    globals: [], // {name, value, scope: 'schema'|'pattern:<id>'|'phase:<id>'}
    functions: [], // xsl:function names (prefix:local) + namespace, must be implemented natively
    phases: [],
    patterns: [],
    sources,
    notices: sourceNotices,
  };

  for (const c of childElements(schema)) {
    if (isEl(c, 'title')) out.title = textOf(c).trim();
    else if (isEl(c, 'ns')) out.ns[c.getAttribute('prefix')] = c.getAttribute('uri');
    else if (isEl(c, 'let')) out.globals.push(Object.assign(compileLet(c), { scope: 'schema' }));
    else if (isEl(c, 'phase')) {
      const ph = { id: c.getAttribute('id'), active: [], lets: [] };
      for (const a of childElements(c)) {
        if (isEl(a, 'active')) ph.active.push(a.getAttribute('pattern'));
        else if (isEl(a, 'let')) {
          const l = Object.assign(compileLet(a), { scope: 'phase:' + ph.id });
          out.globals.push(l);
          ph.lets.push(l.name);
        }
      }
      out.phases.push(ph);
    } else if (isEl(c, 'pattern')) {
      if (c.getAttribute('abstract') === 'true') throw new Error('abstract patterns are not supported');
      if (c.hasAttribute('is-a')) throw new Error('is-a patterns are not supported');
      const pat = { id: c.getAttribute('id') || 'pattern-' + (out.patterns.length + 1), rules: [] };
      for (const r of childElements(c)) {
        if (isEl(r, 'rule')) pat.rules.push(compileRule(r, pat.id));
        else if (isEl(r, 'let')) out.globals.push(Object.assign(compileLet(r), { scope: 'pattern:' + pat.id }));
        else if (isEl(r, 'title') || isEl(r, 'p')) {
          /* documentation */
        } else throw new Error('Unsupported child of pattern: ' + r.nodeName);
      }
      out.patterns.push(pat);
    } else if (isEl(c, 'function', XSL_NS)) {
      const qname = c.getAttribute('name');
      const prefix = qname.split(':')[0];
      // namespace of the function: <ns> declaration first, then xmlns:prefix on the schema element
      const nsUri = out.ns[prefix] || schema.getAttribute('xmlns:' + prefix) || null;
      if (!nsUri) throw new Error('cannot resolve namespace of xsl:function ' + qname);
      const fn = { name: qname, namespaceURI: nsUri, as: c.getAttribute('as') || null, params: [], body: null };
      const items = [];
      for (const k of childElements(c)) {
        if (isEl(k, 'param', XSL_NS)) fn.params.push({ name: k.getAttribute('name'), as: k.getAttribute('as') || null });
        else items.push(k);
      }
      fn.body = xslBodyToXPath(items, qname);
      out.functions.push(fn);
    } else if (isEl(c, 'p') || isEl(c, 'diagnostics')) {
      if (isEl(c, 'diagnostics')) throw new Error('diagnostics are not supported');
    } else if (c.namespaceURI === SCH_NS) {
      throw new Error('Unsupported schema child: ' + c.nodeName);
    }
  }

  // xsl:function handling: functions that do not take part in a call cycle are inlined at every
  // call site (exact types are preserved inside XPath); recursive ones are registered at runtime
  // and evaluated through the engine (their body is still XPath).
  const calls = (body, fn) => new RegExp('(?<![\\w.:-])' + fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(').test(body);
  const recursive = new Set();
  for (const f of out.functions) {
    // depth-first search for a cycle through f
    const seen = new Set();
    const stack = [f];
    while (stack.length) {
      const g = stack.pop();
      for (const h of out.functions) if (calls(g.body, h)) {
        if (h === f) recursive.add(f.name);
        if (!seen.has(h.name)) { seen.add(h.name); stack.push(h); }
      }
    }
  }
  const inlinable = out.functions.filter((f) => !recursive.has(f.name));
  for (const f of out.functions) {
    f.inlined = !recursive.has(f.name);
    f.body = inlineCalls(f.body, inlinable.filter((g) => g !== f), 0); // callee bodies inlined into callers
  }
  const docs = [];
  const baseDir = H.dirname(H.resolve(file));
  const rewrite = (e) => inlineCalls(rewriteDocumentCalls(e, docs, baseDir), inlinable, 0);
  for (const g of out.globals) g.value = rewrite(g.value);
  for (const p of out.patterns) for (const r of p.rules) {
    r.context = rewrite(r.context);
    for (const l of r.lets) l.value = rewrite(l.value);
    for (const a of r.asserts) { a.test = rewrite(a.test); for (const m of a.msg) if (m.select) m.select = rewrite(m.select); }
  }
  for (const f of out.functions) f.body = rewriteDocumentCalls(f.body, docs, baseDir);
  out.documents = docs.map((d) => ({ href: d.href, variable: d.variable, xml: d.xml, sha256: d.sha256, bytes: d.bytes, minified: d.minified }));

  // Sanity checks on expressions: constructs our runtime does not emulate.
  const allExprs = [];
  for (const g of out.globals) allExprs.push(g.value);
  for (const p of out.patterns) for (const r of p.rules) {
    allExprs.push(r.context);
    for (const l of r.lets) allExprs.push(l.value);
    for (const a of r.asserts) { allExprs.push(a.test); for (const m of a.msg) if (m.select) allExprs.push(m.select); }
  }
  for (const f of out.functions) allExprs.push(f.body);
  for (const e of allExprs) {
    if (/(?<![\w.:-])(key|current|document|doc|generate-id|unparsed-text|collection)\s*\(/.test(e)) {
      throw new Error('Unsupported XSLT function in expression: ' + e.slice(0, 120));
    }
  }

  // which functions remain referenced after inlining (these must be registered at runtime)
  const used = new Set();
  for (const f of out.functions) {
    if (allExprs.some((e) => calls(e, f))) used.add(f.name);
  }
  for (const f of out.functions) f.used = used.has(f.name);

  // statistics
  let nRules = 0, nAsserts = 0;
  for (const p of out.patterns) { nRules += p.rules.length; for (const r of p.rules) nAsserts += r.asserts.length; }
  out.stats = { patterns: out.patterns.length, rules: nRules, asserts: nAsserts, globals: out.globals.length };
  return out;
}


return { compile: compileWith };
});
