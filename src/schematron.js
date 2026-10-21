/*
 * schematron.js — ISO Schematron (XSLT2 query binding) runner on top of fontoxpath.
 *
 * Executes the JSON produced by tools/compile-sch.cjs against a DOM document
 * (browser DOM or slimdom). Semantics follow the ISO Schematron skeleton / SchXslt
 * behaviour that KoSIT and CEN use with Saxon:
 *
 *  - every pattern is processed independently; inside a pattern the first rule
 *    (document order) whose context matches a node wins for that node;
 *  - a rule context is an XSLT pattern: node N matches if N is selected by
 *    `//(context)` evaluated from the document node (absolute contexts stay absolute);
 *  - schema-, phase- and pattern-level <let>s are global variables evaluated with the
 *    document node as context; rule-level <let>s are evaluated with the matched node as
 *    context and are visible to all asserts of that rule (hoisted);
 *  - <assert> fails when the effective boolean value of @test is false, <report>
 *    fires when it is true; messages render <name/> and <value-of select/>;
 *  - severity level follows KoSIT default-report.xsl: flag/role fatal|error -> error,
 *    warning|warn -> warning, information|info -> information, otherwise error.
 *
 * Exact decimal arithmetic: see patches/fontoxpath-pruefer.patch.
 *
 * Licence: EUPL-1.2 (compatible with the CEN artefacts it executes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SchematronRunner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VAR_RE = /\$([A-Za-z_][\w.\-]*)/g;

  function levelOf(flag, role) {
    const f = [flag, role].filter(Boolean);
    if (f.includes('fatal') || f.includes('error')) return 'error';
    if (f.includes('warning') || f.includes('warn')) return 'warning';
    if (f.includes('information') || f.includes('info')) return 'information';
    return 'error';
  }

  function referencedVariables(expr) {
    const names = new Set();
    let m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(expr)) !== null) names.add(m[1]);
    return names;
  }

  /**
   * Builds `let $a := (...), $b := (...) return (expr)` so that variables keep their
   * exact XPath types (no round-trip through JavaScript values).
   * Global lets are evaluated with the document node as context via `root(.)!(...)`.
   */
  function buildExpression(expr, ruleLets, globals) {
    const ruleIndex = new Map(ruleLets.map((l, i) => [l.name, i]));
    const globalIndex = new Map(globals.map((l, i) => [l.name, i]));
    const ordered = []; // {name, value, global}
    const emitted = new Set();
    const visiting = new Set();

    function visit(name, allowRule) {
      const key = (allowRule && ruleIndex.has(name) ? 'r:' : 'g:') + name;
      if (emitted.has(key)) return;
      if (visiting.has(key)) throw new Error('circular let reference: $' + name);
      let decl, isGlobal;
      if (allowRule && ruleIndex.has(name)) {
        decl = ruleLets[ruleIndex.get(name)];
        isGlobal = false;
      } else if (globalIndex.has(name)) {
        decl = globals[globalIndex.get(name)];
        isGlobal = true;
      } else {
        return; // unknown variable — leave to the XPath engine to report
      }
      visiting.add(key);
      for (const dep of referencedVariables(decl.value)) {
        if (dep === name) continue;
        // a rule let may use globals and other rule lets; a global may only use globals
        visit(dep, !isGlobal);
      }
      visiting.delete(key);
      emitted.add(key);
      ordered.push({ name, value: decl.value, global: isGlobal });
    }

    for (const name of referencedVariables(expr)) visit(name, true);
    if (!ordered.length) return expr;
    const decls = ordered.map((l) =>
      '$' + l.name + ' := (' + (l.global ? 'root(.)!(' + l.value + ')' : l.value) + ')'
    );
    return 'let ' + decls.join(', ') + ' return (' + expr + ')';
  }

  /**
   * Common-subexpression hoisting for a rule's asserts: an absolute path `//step[pred]/step...`
   * depends only on the document, never on the context node (`//x` is `root(.)//x`), so when the
   * same path (or the same leading part of it) occurs in several asserts of one rule it is bound
   * once per rule evaluation (`let $__cseN := //...`) and the asserts use `$__cseN` instead. The
   * value of a variable holding that node sequence is, by the XPath data model, identical to the
   * path's value at every use, including under later steps and predicates (`$__cse1/cbc:ID[...]`).
   * Only the batch expression is rewritten; the per-assert fallback keeps the original tests.
   *
   * Scanning skips string literals and comments; a `//` counts as the start of a path only when
   * the preceding token cannot be a path head (start of expression, `(`, `[`, `,`, `|`,
   * comparison/arithmetic operators, keywords), so `document(...)//x`, `$v//x`, `..//x` and
   * `a//b` are never touched. Positional predicates are harmless because the hoisted sequence
   * is the full path result in document order.
   */
  function hoistCommonAbsolutePaths(tests, knownVariables) {
    const NAME = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*|:\*)?/;
    const STARTERS = new Set(['(', '[', ',', '|', '=', '<', '>', '+', '-', '*']);
    const KEYWORDS = new Set(['and', 'or', 'return', 'then', 'else', 'satisfies', 'in', 'div', 'mod', 'idiv', 'union', 'intersect', 'except', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'to']);
    // words that can never be the first step of a relative path
    const RESERVED = new Set([...KEYWORDS, 'every', 'some', 'for', 'let', 'if', 'instance', 'of', 'treat', 'as', 'castable', 'cast', 'is', 'function', 'map', 'array', 'switch', 'case', 'default', 'typeswitch']);

    function skipLiteralOrComment(expr, i) {
      const ch = expr[i];
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < expr.length) {
          if (expr[j] === ch) { if (expr[j + 1] === ch) { j += 2; continue; } return j + 1; }
          j++;
        }
        return j;
      }
      if (ch === '(' && expr[i + 1] === ':') {
        let depth = 1, j = i + 2;
        while (j < expr.length && depth) {
          if (expr[j] === '(' && expr[j + 1] === ':') { depth++; j += 2; continue; }
          if (expr[j] === ':' && expr[j + 1] === ')') { depth--; j += 2; continue; }
          j++;
        }
        return j;
      }
      return -1;
    }

    /** index just after the matching close bracket for expr[i] === '[' or '(' (or -1) */
    function skipBalanced(expr, i) {
      const open = expr[i], close = open === '[' ? ']' : ')';
      let depth = 0, j = i;
      while (j < expr.length) {
        const sk = skipLiteralOrComment(expr, j);
        if (sk >= 0) { j = sk; continue; }
        const ch = expr[j];
        if (ch === open) depth++;
        else if (ch === close) { depth--; if (depth === 0) return j + 1; }
        j++;
      }
      return -1;
    }

    /** parses one step (name test / @name / . / .. / text() / node() / *) at i; returns end or -1 */
    function parseStep(expr, i) {
      let j = i;
      if (expr[j] === '@') j++;
      if (expr.startsWith('..', j)) return j + 2;
      if (expr[j] === '.') return j + 1;
      if (expr[j] === '*') return j + 1;
      const kind = /^(text|node|comment)\(\s*\)/.exec(expr.slice(j));
      if (kind) return j + kind[0].length;
      const m = NAME.exec(expr.slice(j));
      if (!m) return -1;
      const name = m[0];
      if (expr[j + name.length] === '(' || /^\s*\(/.test(expr.slice(j + name.length)) && !expr.slice(j + name.length).startsWith('(:')) return -1; // function call step
      if (expr[j + name.length] === ':' && expr[j + name.length + 1] === ':') return -1; // explicit axis: keep it simple
      return j + name.length;
    }

    /** does a path start at i (expr[i..i+1] === '//')? */
    function isPathStart(expr, i) {
      let k = i - 1;
      while (k >= 0 && /\s/.test(expr[k])) k--;
      if (k < 0) return true;
      const ch = expr[k];
      if (STARTERS.has(ch)) return true;
      const word = /[A-Za-z_][\w.\-]*$/.exec(expr.slice(0, k + 1));
      return !!(word && KEYWORDS.has(word[0]) && (k - word[0].length < 0 || /[\s(,\[]/.test(expr[k - word[0].length])));
    }

    /**
     * Returns [{start, ends:[...]}] — each hoistable occurrence with its step-boundary end offsets.
     * Absolute paths (`//a...`, `/a...`) are hoistable anywhere. Relative paths (`cac:a/...`) and
     * parenthesised heads (`(cac:a|cac:b)/...`) only where the focus is the rule's context node:
     * outside predicates and outside groups that follow `/` or `!`.
     */
    function findPaths(expr) {
      const out = [];
      const stack = []; // open brackets: {close, focus}
      let focusDepth = 0;
      let i = 0;
      const prevNonSpace = (k) => { k--; while (k >= 0 && /\s/.test(expr[k])) k--; return k >= 0 ? expr[k] : ''; };
      const prevNonSpaceAt = (k) => { while (k < expr.length && /\s/.test(expr[k])) k++; return k < expr.length ? expr[k] : ''; }; // first non-space char at or after k
      while (i < expr.length) {
        const sk = skipLiteralOrComment(expr, i);
        if (sk >= 0) { i = sk; continue; }
        const ch = expr[i];
        let head = null; // {absolute, end}
        if (/[A-Za-z_]/.test(ch) && !isPathStart(expr, i)) {
          // a name that is not a path start (a step after '/', a function name, a keyword ...): skip it whole
          const w = NAME.exec(expr.slice(i));
          i += w ? w[0].length : 1;
          continue;
        }
        if (ch === '/' && isPathStart(expr, i)) {
          head = { absolute: true, end: expr[i + 1] === '/' ? i + 2 : i + 1, first: true };
        } else if (focusDepth === 0 && isPathStart(expr, i)) {
          if (ch === '(' && expr[i + 1] !== ':') {
            const e = skipBalanced(expr, i);
            if (e > 0) head = { absolute: false, end: e, first: false };
          } else if (ch === '@' || ch === '*' || /[A-Za-z_]/.test(ch)) {
            const w = NAME.exec(expr.slice(i));
            const after = w ? prevNonSpaceAt(i + w[0].length) : '';
            if (!w || (!RESERVED.has(w[0]) && after !== '$' && after !== '{' && after !== '(')) head = { absolute: false, end: i, first: true };
          }
        }
        if (head) {
          const start = i;
          let j = head.end;
          const ends = [];
          if (!head.first) ends.push(j); // the group itself is a hoistable unit
          let expectStep = head.first;
          for (;;) {
            if (expectStep) {
              const stepEnd = parseStep(expr, j);
              if (stepEnd < 0) break;
              j = stepEnd;
              let ok = true;
              while (expr[j] === '[') { const e = skipBalanced(expr, j); if (e < 0) { ok = false; break; } j = e; }
              if (!ok) break;
              ends.push(j);
            }
            if (expr[j] === '/' ) { j += expr[j + 1] === '/' ? 2 : 1; expectStep = true; continue; }
            break;
          }
          // a relative single-name head that is a keyword or followed by '(' is not a path
          const valid = ends.length && (head.absolute || !head.first || !RESERVED.has(expr.slice(start, ends[0])));
          if (valid && (head.absolute || ends.length > 1 || !head.first || expr.slice(start, ends[0]) !== '.')) {
            // a candidate may only use variables that are in scope at the batch level (rule lets,
            // globals, earlier hoisted values) — never variables bound inside the assert itself
            const usable = ends.filter((e) => [...referencedVariables(expr.slice(start, e))].every((n) => n.startsWith('__cse') || knownVariables.has(n)));
            if (usable.length) out.push({ start, ends: usable });
          }
          // scanning continues inside the occurrence: a group head keeps the focus, so paths inside it
          // (and absolute paths inside predicates) are occurrences of their own; nested occurrences are
          // resolved by the rewrite (outer spans win, inner ones are handled when the value is hoisted)
          if (head.first && ch !== '/') {
            // skip the first name: the names after '/' are never path starts anyway
            const w = NAME.exec(expr.slice(i));
            if (w) { i += w[0].length; continue; }
          }
        }
        if (ch === '[') { stack.push({ close: ']', focus: true }); focusDepth++; }
        else if (ch === '(') {
          // a group or a function call that forms a step after '/' or '!' is evaluated with the focus of
          // that step's nodes (`cac:Line/xs:decimal(cbc:Amount)`, `cac:Line/(cbc:A|cbc:B)`)
          let k = i - 1;
          while (k >= 0 && /\s/.test(expr[k])) k--;
          if (k >= 0 && /[\w.\-:]/.test(expr[k])) { // function name before '('
            while (k >= 0 && /[\w.\-:]/.test(expr[k])) k--;
            while (k >= 0 && /\s/.test(expr[k])) k--;
          }
          const f = k >= 0 && (expr[k] === '/' || expr[k] === '!');
          stack.push({ close: ')', focus: f });
          if (f) focusDepth++;
        }
        else if ((ch === ']' || ch === ')') && stack.length) { const top = stack.pop(); if (top.focus) focusDepth--; }
        i++;
      }
      return out;
    }

    /** one round: hoists the longest path prefix occurring at least twice in `exprs` */
    function hoistOnce(exprs, firstIndex, existing) {
      const occurrences = exprs.map(findPaths);
      const counts = new Map();
      occurrences.forEach((occ, t) => {
        for (const o of occ) for (const e of o.ends) { const key = exprs[t].slice(o.start, e); counts.set(key, (counts.get(key) || 0) + 1); }
      });
      const names = new Map();
      const lets = [];
      const rewritten = exprs.map((expr, t) => {
        const occ = occurrences[t].slice().sort((a, b) => a.start - b.start);
        const replacements = []; // [start, end, name], non-overlapping, outer spans first
        let skipUntil = 0;
        for (const o of occ) {
          if (o.start < skipUntil) continue; // inside a span already replaced
          let chosen = null;
          for (let e = o.ends.length - 1; e >= 0; e--) {
            if (existing && o.start === 0 && o.ends[e] === expr.length) continue; // a value is its own definition: look at its leading parts
            const key = expr.slice(o.start, o.ends[e]);
            if ((counts.get(key) || 0) >= 2 || (existing && existing.has(key))) { chosen = [key, o.ends[e]]; break; }
          }
          if (!chosen) continue;
          let name = names.get(chosen[0]) || (existing && existing.get(chosen[0]));
          if (!name) { name = '__cse' + (firstIndex + lets.length + 1); names.set(chosen[0], name); lets.push({ name, value: chosen[0] }); }
          replacements.push([o.start, chosen[1], name]);
          skipUntil = chosen[1];
        }
        let out = expr;
        for (let k = replacements.length - 1; k >= 0; k--) out = out.slice(0, replacements[k][0]) + '$' + replacements[k][2] + out.slice(replacements[k][1]);
        return out;
      });
      return { lets, exprs: rewritten };
    }

    // round 1 over the asserts, then over the hoisted values themselves (shared leading parts such as
    // //cac:TaxCategory[...='VAT'] of //cac:TaxCategory[...='VAT']/cbc:ID[...='E'] are bound once too)
    const first = hoistOnce(tests, 0, null);
    let lets = first.lets;
    let frontier = lets;
    while (frontier.length) {
      const existing = new Map(lets.map((l) => [l.value, l.name]));
      const round = hoistOnce(frontier.map((l) => l.value), lets.length, existing);
      frontier.forEach((l, i) => { l.value = round.exprs[i]; });
      if (!round.lets.length) break;
      lets = lets.concat(round.lets);
      frontier = round.lets;
    }
    return { lets, tests: first.exprs };
  }

  /** Splits an XPath expression on top-level `|` (outside quotes, brackets and parentheses). */
  function splitTopLevelUnion(expr) {
    const parts = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === '|' && depth === 0) {
        parts.push(expr.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(expr.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  /**
   * Turns an XSLT match pattern into an XPath expression that selects, from the document
   * node, exactly the nodes the pattern matches: absolute branches (starting with `/`) are
   * used as they are, relative branches become `//(branch)`.
   */
  function patternToSelector(context) {
    return splitTopLevelUnion(context)
      .map((b) => (b.startsWith('/') ? '(' + b + ')' : '//(' + b + ')'))
      .join(' | ');
  }

  /**
   * Parses one union branch of an XSLT pattern into steps:
   *   { absolute, steps: [{ sep: '/'|'//', axis, test, preds: [] }] }
   * Only the pattern subset allowed by XSLT 2.0 is supported (child/attribute/descendant-or-self
   * axes, node tests, predicates). Used by the per-node fallback matcher.
   */
  function parsePatternBranch(branch) {
    let s = branch.trim();
    let absolute = false;
    const steps = [];
    let sep = '/';
    const text = s;
    if (s === '/') return { absolute: true, root: true, steps: [], text };
    if (s.startsWith('//')) { absolute = true; sep = '//'; s = s.slice(2); }
    else if (s.startsWith('/')) { absolute = true; sep = '/'; s = s.slice(1); }
    // split into steps on top-level / and //
    let depth = 0, quote = null, start = 0;
    const raw = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === '/' && depth === 0) {
        raw.push({ text: s.slice(start, i), sep });
        if (s[i + 1] === '/') { sep = '//'; i++; } else sep = '/';
        start = i + 1;
      }
    }
    raw.push({ text: s.slice(start), sep });
    for (const r of raw) {
      let t = r.text.trim();
      if (!t) throw new Error('empty step in pattern: ' + branch);
      let axis = 'child';
      const am = /^([a-z-]+)::/.exec(t);
      if (am) { axis = am[1]; t = t.slice(am[0].length); }
      else if (t.startsWith('@')) { axis = 'attribute'; t = t.slice(1); }
      // node test = up to first '['
      let j = 0, d = 0, q = null;
      for (; j < t.length; j++) {
        const ch = t[j];
        if (q) { if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '(') d++;
        else if (ch === ')') d--;
        else if (ch === '[' && d === 0) break;
      }
      const test = t.slice(0, j).trim();
      let union = null;
      if (test.startsWith('(') && test.endsWith(')')) {
        // XSLT 3.0 pattern grammar: a parenthesised union of patterns as a step
        union = splitTopLevelUnion(test.slice(1, -1)).map(parsePatternBranch);
      }
      const preds = [];
      let rest = t.slice(j);
      while (rest.startsWith('[')) {
        let k = 1, dd = 1, qq = null;
        for (; k < rest.length; k++) {
          const ch = rest[k];
          if (qq) { if (ch === qq) qq = null; continue; }
          if (ch === '"' || ch === "'") qq = ch;
          else if (ch === '[') dd++;
          else if (ch === ']') { dd--; if (dd === 0) break; }
        }
        preds.push(rest.slice(1, k));
        rest = rest.slice(k + 1).trim();
      }
      if (rest) throw new Error('cannot parse pattern step: ' + r.text);
      steps.push({ sep: r.sep, axis, test, preds, union });
    }
    return { absolute, steps, text };
  }

  function nodeTestMatches(node, test, axis, ns) {
    if (axis === 'attribute') {
      if (node.nodeType !== 2) return false;
    } else if (axis === 'child' || axis === 'descendant-or-self' || axis === 'descendant') {
      if (node.nodeType === 2 || node.nodeType === 9) return false;
    }
    if (test === 'node()') return true;
    if (test === 'text()') return node.nodeType === 3 || node.nodeType === 4;
    if (test === 'comment()') return node.nodeType === 8;
    if (/^processing-instruction\(/.test(test)) return node.nodeType === 7;
    if (test === '.') return true;
    if (axis === 'attribute' ? node.nodeType !== 2 : node.nodeType !== 1) return false;
    if (test === '*') return true;
    const m = /^(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*|\*)$/.exec(test);
    if (!m) throw new Error('unsupported node test: ' + test);
    const prefix = m[1] || null, local = m[2];
    const wantNs = prefix ? ns[prefix] || null : null;
    if (prefix && !ns[prefix]) throw new Error('unknown prefix in pattern: ' + prefix);
    if ((node.namespaceURI || null) !== wantNs) return false;
    return local === '*' || node.localName === local;
  }

  // position of an element among its same-named siblings, computed once per parent (a path for
  // every finding on a 2000-line invoice must not rescan the 2000 siblings for each of them)
  const siblingPositions = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function siblingPosition(n) {
    const parent = n.parentNode;
    if (!parent || !siblingPositions) {
      let idx = 1;
      for (let s = n.previousSibling; s; s = s.previousSibling) if (s.nodeType === 1 && s.nodeName === n.nodeName) idx++;
      return idx;
    }
    let positions = siblingPositions.get(parent);
    if (!positions) {
      positions = new Map();
      const counts = new Map();
      for (let c = parent.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const k = (counts.get(c.nodeName) || 0) + 1;
        counts.set(c.nodeName, k);
        positions.set(c, k);
      }
      siblingPositions.set(parent, positions);
    }
    return positions.get(n) || 1;
  }

  function nodePath(node) {
    const parts = [];
    let n = node;
    while (n && n.nodeType !== 9) {
      if (n.nodeType === 2) {
        parts.unshift('@' + n.nodeName);
        n = n.ownerElement;
        continue;
      }
      if (n.nodeType === 1) {
        parts.unshift(n.nodeName + '[' + siblingPosition(n) + ']');
      } else if (n.nodeType === 3 || n.nodeType === 4) {
        parts.unshift('text()');
      } else if (n.nodeType === 8) {
        parts.unshift('comment()');
      } else if (n.nodeType === 7) {
        parts.unshift('processing-instruction()');
      }
      n = n.parentNode;
    }
    return '/' + parts.join('/');
  }

  function documentOrderIndex(doc) {
    // pre-order (node, then its attributes, then its children), iteratively: no recursion depth limit
    const index = new Map();
    let i = 0;
    let n = doc;
    while (n) {
      index.set(n, i++);
      if (n.nodeType === 1 && n.attributes) {
        for (let a = 0; a < n.attributes.length; a++) index.set(n.attributes[a], i++);
      }
      if (n.firstChild) { n = n.firstChild; continue; }
      while (n && n !== doc && !n.nextSibling) n = n.parentNode;
      n = n && n !== doc ? n.nextSibling : null;
    }
    return index;
  }

  function parseXmlDefault(xml) {
    if (typeof DOMParser !== 'undefined') {
      // in the page: src/xml-parse.js (the Trusted Types policy of the Prüfer); elsewhere DOMParser directly
      const doc = typeof PrueferXml !== 'undefined' ? PrueferXml.parse(xml) : new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('embedded document is not well-formed');
      return doc;
    }
    if (typeof require === 'function') {
      try { return require('../vendor/slimdom.cjs').parseXmlDocument(xml); } catch (e) { /* fall through */ }
    }
    throw new Error('no XML parser available for document() — pass options.parseXml');
  }

  const registeredFunctions = new WeakMap(); // fontoxpath instance -> Set of "ns#local"

  /**
   * xsl:function support. Functions without recursion are inlined by the compiler (their body
   * becomes part of the calling expression, so exact types are preserved). Recursive functions
   * are registered here and evaluated through the engine with their parameters bound as variables.
   */
  const XS_TYPES = /^xs:(string|boolean|integer|decimal|double|float|date|dateTime|time|anyURI|anyAtomicType|untypedAtomic)([?*+]?)$/;
  function fontoType(as, fallback) {
    if (!as) return fallback;
    const m = XS_TYPES.exec(as.trim());
    if (!m) return fallback;
    return 'xs:' + m[1] + (m[2] || '');
  }

  function ensureFunctions(fontoxpath, schema, xpathOptions) {
    let set = registeredFunctions.get(fontoxpath);
    if (!set) {
      set = new Set();
      registeredFunctions.set(fontoxpath, set);
    }
    for (const f of schema.functions || []) {
      if (f.used === false || f.inlined) continue;
      const local = f.name.split(':').pop();
      const key = f.namespaceURI + '#' + local;
      if (set.has(key)) continue;
      if (!f.body) throw new Error('xsl:function ' + f.name + ' has no XPath body and no native implementation');
      const paramTypes = f.params.map((p) => fontoType(p.as, 'item()*'));
      const returnType = fontoType(f.as, 'item()*');
      const body = f.body;
      const paramNames = f.params.map((p) => p.name);
      fontoxpath.registerCustomXPathFunction(
        { namespaceURI: f.namespaceURI, localName: local },
        paramTypes,
        returnType,
        function () {
          const args = Array.prototype.slice.call(arguments, 1);
          // the embedded document() files stay visible inside function bodies
          const variables = Object.assign({}, xpathOptions.variables);
          paramNames.forEach((n, i) => { variables[n] = args[i]; });
          return fontoxpath.evaluateXPath(body, null, null, variables, fontoxpath.evaluateXPath.ANY_TYPE, xpathOptions);
        }
      );
      set.add(key);
    }
  }

  function create(fontoxpath, schema, options) {
    options = options || {};
    const ns = schema.ns || {};
    // documents referenced through document('...') in the rules, parsed once and bound as variables
    const variables = {};
    for (const d of schema.documents || []) {
      variables[d.variable] = options.parseXml ? options.parseXml(d.xml) : parseXmlDefault(d.xml);
    }
    const xpathOptions = {
      namespaceResolver: function (prefix) {
        return ns[prefix] || null;
      },
      language: fontoxpath.evaluateXPath.XPATH_3_1_LANGUAGE,
      // NOTE: fontoxpath takes variables as the 4th argument of evaluateXPath*, not as an option; they are
      // kept here so that every call site passes the same object (VARS below)
      variables,
    };
    const VARS = variables;
    ensureFunctions(fontoxpath, schema, xpathOptions);
    // documents are never mutated during validation: let the engine answer //name steps from its index
    if (typeof fontoxpath.setDescendantIndexEnabled === 'function') fontoxpath.setDescendantIndexEnabled(true);
    const globals = schema.globals || [];

    // Pre-build expression strings once (fontoxpath caches compiled expressions per string).
    const patterns = schema.patterns.map((p) => ({
      id: p.id,
      rules: p.rules.map((r) => ({
        context: r.context,
        matchExpr: buildExpression(patternToSelector(r.context), [], globals),
        branches: null, // parsed lazily: [{absolute, steps}] per union branch
        flag: r.flag,
        role: r.role,
        lets: r.lets,
        // all asserts of the rule in one XPath call: (boolean(t1), boolean(t2), ...) — lets evaluated once per node
        batchExpr: r.asserts.length ? (() => {
          const hoisted = hoistCommonAbsolutePaths(r.asserts.map((a) => a.test), new Set((r.lets || []).map((l) => l.name).concat(globals.map((l) => l.name))));
          return buildExpression('(' + hoisted.tests.map((t) => 'boolean(' + t + ')').join(', ') + ')', (r.lets || []).concat(hoisted.lets), globals);
        })() : null,
        asserts: r.asserts.map((a) => ({
          kind: a.kind,
          id: a.id,
          flag: a.flag,
          role: a.role,
          test: a.test,
          testExpr: buildExpression(a.test, r.lets, globals),
          msg: a.msg.map((m) => {
            if (m.t === 'value-of') {
              return { t: 'value-of', expr: buildExpression('string-join(for $v in (' + m.select + ') return string($v), " ")', r.lets, globals) };
            }
            if (m.t === 'name' && m.path) {
              return { t: 'name', expr: buildExpression('name((' + m.path + ')[1])', r.lets, globals) };
            }
            return m;
          }),
        })),
      })),
    }));

    /**
     * Index of a document: elements by "{ns}local", attributes by "@{ns}local", plus the lists
     * of all elements and all attributes (document order). Built once per validate() call.
     */
    function buildCandidateIndex(docIndex) {
      const byName = new Map();
      const elements = [], attributes = [];
      let docNode = null;
      for (const n of docIndex.keys()) {
        if (n.nodeType === 9) { docNode = n; continue; }
        if (n.nodeType !== 1 && n.nodeType !== 2) continue;
        const key = (n.nodeType === 2 ? '@' : '') + '{' + (n.namespaceURI || '') + '}' + n.localName;
        let list = byName.get(key);
        if (!list) byName.set(key, (list = []));
        list.push(n);
        (n.nodeType === 2 ? attributes : elements).push(n);
      }
      return { byName, elements, attributes, docNode };
    }

    /** Candidate nodes for a parsed branch (by its last step), or null when not indexable. */
    function candidatesFor(br, index) {
      if (br.root) return index.docNode ? [index.docNode] : [];
      const last = br.steps[br.steps.length - 1];
      if (last.union) return null;
      const t = last.test;
      if (t === 'node()' || t === 'text()' || t === 'comment()' || /^processing-instruction\(/.test(t) || t === '.') return null;
      if (last.axis !== 'child' && last.axis !== 'attribute') return null;
      if (t === '*') return last.axis === 'attribute' ? index.attributes : index.elements;
      const m = /^(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*|\*)$/.exec(t);
      if (!m) return null;
      const prefix = m[1] || null, local = m[2];
      if (prefix && !ns[prefix]) throw new Error('unknown prefix in pattern: ' + prefix);
      const uri = prefix ? ns[prefix] : '';
      if (local === '*') return (last.axis === 'attribute' ? index.attributes : index.elements).filter((n) => (n.namespaceURI || '') === uri);
      return index.byName.get((last.axis === 'attribute' ? '@' : '') + '{' + uri + '}' + local) || [];
    }

    /**
     * Nodes matched by a rule context. Each union branch is evaluated against the indexed
     * candidates of its last step with exact XSLT pattern semantics (matchSteps); branches that
     * cannot be indexed fall back to evaluating `//(branch)` with fontoxpath.
     * XSLT semantics: a dynamic error while matching a pattern against a node means the pattern
     * does not match that node; the error is reported as a warning.
     */
    function matchRule(rule, doc, index, warnings) {
      if (!rule.branches) rule.branches = splitTopLevelUnion(rule.context).map(parsePatternBranch);
      const out = [];
      const seen = new Set();
      for (const br of rule.branches) {
        let cands = null;
        try { cands = candidatesFor(br, index); } catch (e) { warnings.push({ context: rule.context, message: String(e && e.message || e) }); continue; }
        // XSLT 3.0 §5.5.3: a node N matches a pattern P iff N is in root(N)//(P) (or /P for absolute patterns).
        // One evaluation of that expression is exact and cheaper than one evaluation per candidate when
        //  - the branch is absolute, or starts with a union of absolute branches such as
        //    (/ubl:Invoice[$isCVD]/cac:InvoiceLine | /cn:CreditNote[$isCVD]/cac:CreditNoteLine)/cac:Item,
        //    because then the expression does not depend on the context node at all, or
        //  - a predicate would otherwise be evaluated for many candidates (//*[ends-with(name(), 'Amount')]).
        const absoluteUnion = br.steps.length >= 1 && br.steps[0].union && br.steps[0].union.every((u) => u.root || u.absolute);
        if (cands !== null && (br.absolute || absoluteUnion) && !br.root) cands = null;
        if (cands !== null && cands.length >= 64 && br.steps.some((st) => st.preds && st.preds.length)) cands = null;
        if (cands === null) {
          const selector = buildExpression(br.root ? '(/)' : (br.absolute || absoluteUnion ? '(' + br.text + ')' : '//(' + br.text + ')'), [], globals);
          try {
            for (const n of fontoxpath.evaluateXPathToNodes(selector, doc, null, VARS, xpathOptions)) if (!seen.has(n)) { seen.add(n); out.push(n); }
          } catch (e) {
            warnings.push({ context: rule.context, message: 'branch evaluated node-by-node after dynamic error: ' + String(e && e.message || e) });
            for (const n of [index.docNode].concat(index.elements, index.attributes)) {
              if (!n || seen.has(n)) continue;
              try { if (br.root ? n.nodeType === 9 : matchSteps(n, br.steps, br.steps.length - 1, br.absolute)) { seen.add(n); out.push(n); } }
              catch (e2) { warnings.push({ context: rule.context, location: nodePath(n), message: String(e2 && e2.message || e2) }); }
            }
          }
          continue;
        }
        for (const n of cands) {
          if (seen.has(n)) continue;
          try {
            if (br.root ? n.nodeType === 9 : matchSteps(n, br.steps, br.steps.length - 1, br.absolute)) { seen.add(n); out.push(n); }
          } catch (e) {
            warnings.push({ context: rule.context, location: nodePath(n), message: String(e && e.message || e) });
          }
        }
      }
      return out;
    }

    /**
     * Per-node XSLT pattern matching (used by the self-test).
     */
    function nodeMatchesPattern(node, rule, warnings) {
      if (!rule.branches) rule.branches = splitTopLevelUnion(rule.context).map(parsePatternBranch);
      for (const br of rule.branches) {
        try {
          if (br.root) { if (node.nodeType === 9) return true; continue; }
          if (matchSteps(node, br.steps, br.steps.length - 1, br.absolute)) return true;
        } catch (e) {
          warnings.push({ context: rule.context, location: nodePath(node), message: String(e && e.message || e) });
        }
      }
      return false;
    }

    function parentOf(node) {
      return node.nodeType === 2 ? node.ownerElement : node.parentNode;
    }

    function matchSteps(node, steps, i, absolute) {
      const step = steps[i];
      if (step.union) {
        if (!step.union.some((br) => (br.root ? node.nodeType === 9 : matchSteps(node, br.steps, br.steps.length - 1, br.absolute)))) return false;
      } else if (!nodeTestMatches(node, step.test, step.axis, ns)) return false;
      for (const pred of step.preds) {
        let expr;
        if (step.union) {
          expr = 'exists(self::node()[' + pred + '])';
        } else if (/^\s*\d+\s*$/.test(pred)) {
          expr = '(count(preceding-sibling::' + step.test + ') + 1) = ' + pred.trim();
          if (step.axis === 'attribute') expr = '1 = ' + pred.trim();
        } else if (/\b(position|last)\s*\(/.test(pred)) {
          expr = 'let $n := . return exists((../' + (step.axis === 'attribute' ? '@' : '') + step.test + ')[' + pred + '][. is $n])';
        } else {
          expr = 'exists(self::node()[' + pred + '])';
        }
        if (!fontoxpath.evaluateXPathToBoolean(buildExpression(expr, [], globals), node, null, VARS, xpathOptions)) return false;
      }
      const parent = parentOf(node);
      if (i === 0) {
        if (step.union) return true; // the inner patterns decided absoluteness themselves
        if (!absolute) return true;
        if (step.sep === '//') return true;
        return !!parent && parent.nodeType === 9;
      }
      if (step.sep === '/') {
        return !!parent && matchSteps(parent, steps, i - 1, absolute);
      }
      // '//' : some ancestor (or the parent itself) matches the previous step
      for (let a = parent; a; a = parentOf(a)) {
        if (matchSteps(a, steps, i - 1, absolute)) return true;
      }
      return false;
    }

    function activePatterns(phase) {
      if (!phase || phase === '#ALL') return patterns;
      if (phase === '#DEFAULT') phase = schema.defaultPhase || '#ALL';
      if (phase === '#ALL') return patterns;
      const ph = (schema.phases || []).find((p) => p.id === phase);
      if (!ph) throw new Error('unknown phase: ' + phase);
      return patterns.filter((p) => ph.active.includes(p.id));
    }

    function renderMessage(assert, node) {
      let out = '';
      for (const part of assert.msg) {
        if (part.t === 'text') out += part.v;
        else if (part.t === 'name') {
          try {
            out += part.expr
              ? fontoxpath.evaluateXPathToString(part.expr, node, null, VARS, xpathOptions)
              : node.nodeType === 2 || node.nodeType === 1 ? node.nodeName : '';
          } catch (e) {
            out += '';
          }
        } else if (part.t === 'value-of') {
          try {
            out += fontoxpath.evaluateXPathToString(part.expr, node, null, VARS, xpathOptions);
          } catch (e) {
            out += '';
          }
        }
      }
      return out.replace(/\s+/g, ' ').trim();
    }

    /**
     * Validate a document.
     * @param {Document} doc
     * @param {{phase?: string, docIndex?: Map}} [opts]
     * @returns {{schema: string, findings: Array, firedRules: number, processingErrors: Array}}
     */
    function validate(doc, opts) {
      opts = opts || {};
      const docIndex = opts.docIndex || documentOrderIndex(doc);
      const findings = [];
      const processingErrors = [];
      const warnings = [];
      let firedRules = 0;
      const active = activePatterns(opts.phase || '#ALL');
      const index = buildCandidateIndex(docIndex);
      const prof = opts.profile ? { match: 0, asserts: 0, rules: [] } : null;

      for (const pattern of active) {
        if (!pattern.rules.length) continue;
        const owner = new Map(); // node -> rule (first matching rule in document order of the schema wins)
        for (const rule of pattern.rules) {
          const tm = prof ? Date.now() : 0;
          for (const n of matchRule(rule, doc, index, warnings)) if (!owner.has(n)) owner.set(n, rule);
          if (prof) { const d = Date.now() - tm; prof.match += d; rule._tMatch = (rule._tMatch || 0) + d; }
        }
        const matched = Array.from(owner.entries()).sort((a, b) => (docIndex.get(a[0]) || 0) - (docIndex.get(b[0]) || 0));
        for (const [node, rule] of matched) {
          firedRules++;
          const ta = prof ? Date.now() : 0;
          if (prof) { rule._fired = (rule._fired || 0) + 1; }
          if (prof) setTimeout(() => {}, 0);
          if (!rule.asserts.length) continue;
          // all asserts in one call; on a dynamic error fall back to one call per assert to isolate it
          let values = null;
          try {
            values = fontoxpath.evaluateXPath(rule.batchExpr, node, null, VARS, fontoxpath.evaluateXPath.ALL_RESULTS_TYPE, xpathOptions);
            if (!Array.isArray(values) || values.length !== rule.asserts.length) values = null;
          } catch (e) {
            values = null;
          }
          for (let ai = 0; ai < rule.asserts.length; ai++) {
            const assert = rule.asserts[ai];
            let value;
            if (values) value = values[ai] === true;
            else {
              try {
                value = fontoxpath.evaluateXPathToBoolean(assert.testExpr, node, null, VARS, xpathOptions);
              } catch (e) {
                processingErrors.push({
                  pattern: pattern.id,
                  context: rule.context,
                  id: assert.id,
                  location: nodePath(node),
                  phase: 'test',
                  message: String(e && e.message || e),
                });
                continue;
              }
            }
            const fired = assert.kind === 'report' ? value : !value;
            if (!fired) { if (prof && ai === rule.asserts.length - 1) { const d = Date.now() - ta; prof.asserts += d; rule._tAssert = (rule._tAssert || 0) + d; } continue; }
            const finding = {
              id: assert.id,
              kind: assert.kind,
              flag: assert.flag,
              role: assert.role,
              level: levelOf(assert.flag, assert.role),
              text: renderMessage(assert, node),
              location: nodePath(node),
              pattern: pattern.id,
              context: rule.context,
              test: assert.test,
            };
            Object.defineProperty(finding, 'node', { value: node, enumerable: false }); // for callers that map findings back to the DOM
            findings.push(finding);
          }
        }
      }
      if (prof) {
        for (const p of active) for (const r of p.rules) if (r._tMatch || r._tAssert) prof.rules.push({ context: r.context.slice(0, 70), match: r._tMatch || 0, asserts: r._tAssert || 0, fired: r._fired || 0, nAsserts: r.asserts.length });
        prof.rules.sort((a, b) => (b.match + b.asserts) - (a.match + a.asserts));
      }
      return { schema: schema.id, findings, firedRules, processingErrors, warnings, profile: prof };
    }

    return { validate, schema, patterns, buildExpression, _nodeMatchesPattern: nodeMatchesPattern, _xpathOptions: xpathOptions };
  }

  return { create, buildExpression, patternToSelector, splitTopLevelUnion, parsePatternBranch, levelOf, nodePath, documentOrderIndex };
});
