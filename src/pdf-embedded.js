/*
 * pdf-embedded.js — extracts embedded files (ZUGFeRD / Factur-X / XRechnung attachments) and the
 * ZUGFeRD XMP metadata from a PDF without a full PDF engine.
 *
 * Approach: PDF/A-3 files (the container ZUGFeRD and Factur-X require) are never encrypted, so
 * every object is readable. We scan the file for "N G obj" headers, parse each object with a small
 * PDF syntax parser (dictionaries, arrays, names, strings, numbers, references), expand object
 * streams (/Type /ObjStm, PDF 1.5+), and collect:
 *   - /Type /Filespec dictionaries (file names, /EF references, /AFRelationship, /Desc),
 *   - /Type /EmbeddedFile streams (the file bytes; filters FlateDecode / none),
 *   - the XMP metadata stream (for fx:/zf: ConformanceLevel, DocumentType, Version).
 * The cross-reference table is deliberately not used: scanning also works for incrementally
 * updated or slightly damaged files. The last definition of an object number wins (incremental
 * updates append newer definitions).
 *
 * Inflate: DecompressionStream('deflate') (browser + Node 18+), falling back to pako if present.
 *
 * API (async): extractEmbeddedFiles(bytes: Uint8Array) ->
 *   { files: [{ name, bytes, mimeType, description, afRelationship, filter, objectNumber }],
 *     xmp: { raw, zugferd: { version, conformanceLevel, documentType, documentFileName } | null } | null,
 *     warnings: [string], objectCount }
 *   loadDocument(bytes) -> { objects, trailer, method, resolve, warnings } (object graph, used by
 *     src/pdfa3-checks.js); util = parser primitives (Ref, Name, pdfString, nameTreeEntries, ...)
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfEmbedded = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
  const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %

  class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
  class Name { constructor(name) { this.name = name; } }

  function latin1(bytes, start, end) {
    let s = '';
    const chunk = 8192;
    for (let i = start; i < end; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + chunk)));
    return s;
  }

  /** Minimal PDF object parser over a Uint8Array. */
  class Lexer {
    constructor(bytes, pos) { this.b = bytes; this.pos = pos; }
    skipWs() {
      const b = this.b;
      while (this.pos < b.length) {
        const c = b[this.pos];
        if (WHITESPACE.has(c)) this.pos++;
        else if (c === 0x25) { while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++; }
        else break;
      }
    }
    parseObject(depth) {
      depth = depth || 0;
      if (depth > 200) throw new Error('nesting too deep');
      this.skipWs();
      const b = this.b;
      if (this.pos >= b.length) throw new Error('unexpected end');
      const c = b[this.pos];
      if (c === 0x3c) { // <
        if (b[this.pos + 1] === 0x3c) return this.parseDict(depth);
        return this.parseHexString();
      }
      if (c === 0x28) return this.parseLiteralString();
      if (c === 0x2f) return this.parseName();
      if (c === 0x5b) return this.parseArray(depth);
      if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7d || c === 0x7b) { this.pos++; return undefined; }
      // number, reference, or keyword
      const start = this.pos;
      while (this.pos < b.length && !WHITESPACE.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
      const tok = latin1(b, start, this.pos);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
        // possible reference: int int R
        if (/^\d+$/.test(tok)) {
          const save = this.pos;
          this.skipWs();
          const s2 = this.pos;
          while (this.pos < b.length && !WHITESPACE.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
          const tok2 = latin1(b, s2, this.pos);
          if (/^\d+$/.test(tok2)) {
            this.skipWs();
            if (b[this.pos] === 0x52 && (this.pos + 1 >= b.length || WHITESPACE.has(b[this.pos + 1]) || DELIM.has(b[this.pos + 1]))) { // R
              this.pos++;
              return new Ref(parseInt(tok, 10), parseInt(tok2, 10));
            }
          }
          this.pos = save;
        }
        return parseFloat(tok);
      }
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      if (tok === 'null') return null;
      return { keyword: tok };
    }
    parseName() {
      const b = this.b;
      this.pos++; // '/'
      const start = this.pos;
      while (this.pos < b.length && !WHITESPACE.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
      const raw = latin1(b, start, this.pos);
      return new Name(raw.replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))));
    }
    parseLiteralString() {
      const b = this.b;
      this.pos++; // '('
      let depth = 1;
      const out = [];
      while (this.pos < b.length) {
        let c = b[this.pos++];
        if (c === 0x5c) { // backslash
          c = b[this.pos++];
          switch (c) {
            case 0x6e: out.push(10); break; // n
            case 0x72: out.push(13); break; // r
            case 0x74: out.push(9); break; // t
            case 0x62: out.push(8); break; // b
            case 0x66: out.push(12); break; // f
            case 0x0a: break; // line continuation
            case 0x0d: if (b[this.pos] === 0x0a) this.pos++; break;
            default:
              if (c >= 0x30 && c <= 0x37) {
                let oct = c - 0x30;
                for (let k = 0; k < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) oct = oct * 8 + (b[this.pos++] - 0x30);
                out.push(oct & 0xff);
              } else out.push(c);
          }
        } else if (c === 0x28) { depth++; out.push(c); }
        else if (c === 0x29) { depth--; if (depth === 0) break; out.push(c); }
        else out.push(c);
      }
      return { string: Uint8Array.from(out) };
    }
    parseHexString() {
      const b = this.b;
      this.pos++; // '<'
      const out = [];
      let digits = '';
      while (this.pos < b.length && b[this.pos] !== 0x3e) {
        const c = b[this.pos++];
        if (WHITESPACE.has(c)) continue;
        digits += String.fromCharCode(c);
        if (digits.length === 2) { out.push(parseInt(digits, 16)); digits = ''; }
      }
      if (digits.length === 1) out.push(parseInt(digits + '0', 16));
      this.pos++; // '>'
      return { string: Uint8Array.from(out) };
    }
    parseArray(depth) {
      this.pos++; // '['
      const arr = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= this.b.length) break;
        if (this.b[this.pos] === 0x5d) { this.pos++; break; }
        const v = this.parseObject(depth + 1);
        if (v && v.keyword) { if (v.keyword === 'endobj' || v.keyword === 'stream') break; continue; }
        arr.push(v);
      }
      return arr;
    }
    parseDict(depth) {
      this.pos += 2; // '<<'
      const dict = new Map();
      for (;;) {
        this.skipWs();
        if (this.pos >= this.b.length) break;
        if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) { this.pos += 2; break; }
        if (this.b[this.pos] !== 0x2f) { // not a name: skip garbage token
          const v = this.parseObject(depth + 1);
          if (v && (v.keyword === 'endobj' || v.keyword === 'stream')) break;
          continue;
        }
        const key = this.parseName().name;
        const val = this.parseObject(depth + 1);
        if (val && val.keyword) { if (val.keyword === 'endobj' || val.keyword === 'stream') break; continue; }
        dict.set(key, val);
      }
      return dict;
    }
  }

  function pdfString(v) {
    if (!v || !v.string) return null;
    const b = v.string;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { // UTF-16BE
      let s = '';
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return s;
    }
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
      try { return new TextDecoder('utf-8').decode(b.subarray(3)); } catch (e) { /* fall through */ }
    }
    // PDFDocEncoding ~ Latin-1 for file names
    return latin1(b, 0, b.length);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'function') {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const chunks = [];
        const reader = ds.readable.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        let len = 0;
        for (const c of chunks) len += c.length;
        const out = new Uint8Array(len);
        let o = 0;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
      } catch (e) {
        if (typeof pako === 'undefined') throw e;
      }
    }
    if (typeof pako !== 'undefined') return pako.inflate(bytes);
    throw new Error('no inflate implementation available');
  }

  function applyPredictor(data, parms, resolve) {
    const pred = num(resolve(parms.get('Predictor'))) || 1;
    if (pred <= 1) return data;
    const colors = num(resolve(parms.get('Colors'))) || 1;
    const bpc = num(resolve(parms.get('BitsPerComponent'))) || 8;
    const columns = num(resolve(parms.get('Columns'))) || 1;
    const bpp = Math.ceil((colors * bpc) / 8);
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    if (pred === 2) throw new Error('TIFF predictor not supported');
    // PNG predictors
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const ft = data[r * (rowLen + 1)];
      const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const row = new Uint8Array(rowLen);
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let x = src[i];
        switch (ft) {
          case 0: break;
          case 1: x += a; break;
          case 2: x += b; break;
          case 3: x += Math.floor((a + b) / 2); break;
          case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
          default: throw new Error('bad PNG filter type ' + ft);
        }
        row[i] = x & 0xff;
      }
      out.set(row, r * rowLen);
      prev = row;
    }
    return out;
  }

  function num(v) { return typeof v === 'number' ? v : null; }

  async function decodeStream(obj, resolve, warnings) {
    let data = obj.raw;
    let filters = resolve(obj.dict.get('Filter'));
    if (filters instanceof Name) filters = [filters];
    if (!filters) filters = [];
    let parms = resolve(obj.dict.get('DecodeParms'));
    if (parms instanceof Map) parms = [parms];
    if (!Array.isArray(parms)) parms = [];
    const names = [];
    for (let i = 0; i < filters.length; i++) {
      const f = resolve(filters[i]);
      const fname = f instanceof Name ? f.name : String(f);
      names.push(fname);
      if (fname === 'FlateDecode' || fname === 'Fl') {
        data = await inflate(data);
        const p = resolve(parms[i]);
        if (p instanceof Map && p.get('Predictor')) data = applyPredictor(data, p, resolve);
      } else if (fname === 'ASCIIHexDecode' || fname === 'AHx') {
        const txt = latin1(data, 0, data.length).replace(/>.*$/s, '').replace(/[^0-9A-Fa-f]/g, '');
        const out = new Uint8Array(Math.ceil(txt.length / 2));
        for (let k = 0; k < txt.length; k += 2) out[k / 2] = parseInt(txt.substr(k, 2).padEnd(2, '0'), 16);
        data = out;
      } else if (fname === 'ASCII85Decode' || fname === 'A85') {
        data = ascii85(data);
      } else {
        throw new Error('unsupported stream filter ' + fname);
      }
    }
    return { data, filters: names };
  }

  function ascii85(bytes) {
    let txt = latin1(bytes, 0, bytes.length).replace(/^<~/, '').replace(/~>.*$/s, '').replace(/\s/g, '');
    const out = [];
    let tuple = [];
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (ch === 'z' && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
      tuple.push(ch.charCodeAt(0) - 33);
      if (tuple.length === 5) { let v = 0; for (const t of tuple) v = v * 85 + t; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); tuple = []; }
    }
    if (tuple.length) { const n = tuple.length; while (tuple.length < 5) tuple.push(84); let v = 0; for (const t of tuple) v = v * 85 + t; const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...b.slice(0, n - 1)); }
    return Uint8Array.from(out);
  }

  function findAll(bytes, needle) {
    const res = [];
    const n = needle.length;
    outer: for (let i = 0; i <= bytes.length - n; i++) {
      for (let k = 0; k < n; k++) if (bytes[i + k] !== needle[k]) continue outer;
      res.push(i);
    }
    return res;
  }

  /**
   * Scan the whole file for "N G obj" and parse each object. Objects that start inside the data
   * of another object's stream (e.g. an embedded PDF attachment, which carries its own "N G obj"
   * markers) are discarded; for that, stream lengths are resolved first.
   */
  function scanObjects(bytes, warnings) {
    const all = [];
    const objPositions = findAll(bytes, [0x6f, 0x62, 0x6a]); // "obj"
    for (const p of objPositions) {
      // must be preceded by "N G " and followed by delimiter/whitespace
      const after = bytes[p + 3];
      if (p + 3 < bytes.length && !WHITESPACE.has(after) && !DELIM.has(after)) continue;
      let i = p - 1;
      while (i >= 0 && WHITESPACE.has(bytes[i])) i--;
      let genEnd = i + 1;
      while (i >= 0 && bytes[i] >= 0x30 && bytes[i] <= 0x39) i--;
      const genStart = i + 1;
      if (genStart === genEnd) continue;
      if (i < 0 || !WHITESPACE.has(bytes[i])) continue;
      while (i >= 0 && WHITESPACE.has(bytes[i])) i--;
      let numEnd = i + 1;
      while (i >= 0 && bytes[i] >= 0x30 && bytes[i] <= 0x39) i--;
      const numStart = i + 1;
      if (numStart === numEnd) continue;
      if (i >= 0 && !WHITESPACE.has(bytes[i]) && !DELIM.has(bytes[i])) continue;
      const num = parseInt(latin1(bytes, numStart, numEnd), 10);
      const gen = parseInt(latin1(bytes, genStart, genEnd), 10);
      try {
        const lx = new Lexer(bytes, p + 3);
        const value = lx.parseObject(0);
        const obj = { num, gen, offset: numStart, value, dict: value instanceof Map ? value : null, raw: null, streamStart: -1 };
        lx.skipWs();
        if (obj.dict && bytes[lx.pos] === 0x73 && latin1(bytes, lx.pos, lx.pos + 6) === 'stream') {
          let s = lx.pos + 6;
          if (bytes[s] === 0x0d) s++;
          if (bytes[s] === 0x0a) s++;
          obj.streamStart = s;
        }
        all.push(obj);
      } catch (e) {
        warnings.push('object ' + num + ' at offset ' + numStart + ' could not be parsed: ' + e.message);
      }
    }
    // resolve stream lengths: an indirect /Length may have several candidate definitions (an
    // embedded PDF carries its own object numbers) — take the first candidate after which
    // "endstream" really follows, preferring definitions located after the stream.
    const byNum = new Map();
    for (const o of all) { if (!byNum.has(o.num)) byNum.set(o.num, []); byNum.get(o.num).push(o); }
    const endstreamFollows = (end) => { let k = end; while (k < bytes.length && WHITESPACE.has(bytes[k])) k++; return latin1(bytes, k, k + 9) === 'endstream'; };
    for (const o of all) {
      if (o.streamStart < 0) continue;
      let len = o.dict.get('Length');
      let end = -1;
      if (len instanceof Ref) {
        const cands = (byNum.get(len.num) || []).slice().sort((a, b) => (a.offset > o.offset ? 0 : 1) - (b.offset > o.offset ? 0 : 1) || a.offset - b.offset);
        for (const c of cands) {
          if (typeof c.value === 'number' && o.streamStart + c.value <= bytes.length && endstreamFollows(o.streamStart + c.value)) { end = o.streamStart + c.value; break; }
        }
      } else if (typeof len === 'number' && o.streamStart + len <= bytes.length && endstreamFollows(o.streamStart + len)) {
        end = o.streamStart + len;
      }
      if (end < 0) {
        const data = streamBytes(bytes, o, (v) => (v instanceof Ref ? null : v), []);
        end = data ? o.streamStart + data.length : o.streamStart;
      }
      o.streamEnd = end;
      o.resolvedLength = end - o.streamStart;
    }
    // discard objects that begin inside another object's stream data
    all.sort((a, b) => a.offset - b.offset);
    const objects = new Map();
    let blockedUntil = -1;
    for (const o of all) {
      if (o.offset < blockedUntil) continue;
      objects.set(o.num, o); // later definitions (incremental updates) override earlier ones
      if (o.streamStart >= 0 && o.streamEnd > blockedUntil) blockedUntil = o.streamEnd;
    }
    return objects;
  }

  /** Parse the indirect object whose "N G obj" header starts at (or right after whitespace from) offset. */
  function parseObjectAt(bytes, offset, expectNum) {
    const lx = new Lexer(bytes, offset);
    lx.skipWs();
    const start = lx.pos;
    const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(latin1(bytes, lx.pos, Math.min(bytes.length, lx.pos + 40)));
    if (!header) return null;
    const num = parseInt(header[1], 10), gen = parseInt(header[2], 10);
    if (expectNum !== undefined && num !== expectNum) return null;
    lx.pos += header[0].length;
    const value = lx.parseObject(0);
    const obj = { num, gen, offset: start, value, dict: value instanceof Map ? value : null, raw: null, streamStart: -1 };
    lx.skipWs();
    if (obj.dict && latin1(bytes, lx.pos, lx.pos + 6) === 'stream') {
      let st = lx.pos + 6;
      if (bytes[st] === 0x0d) st++;
      if (bytes[st] === 0x0a) st++;
      obj.streamStart = st;
    }
    return obj;
  }

  /**
   * Locate objects through the cross-reference data (classic tables, xref streams, /Prev and
   * hybrid /XRefStm chains). Returns { objects, trailer } or null when the xref cannot be used.
   */
  async function loadViaXref(bytes, warnings) {
    const tailStart = Math.max(0, bytes.length - 2048);
    const tail = latin1(bytes, tailStart, bytes.length);
    const sx = tail.lastIndexOf('startxref');
    if (sx < 0) return null;
    const m = /startxref\s+(\d+)/.exec(tail.slice(sx));
    if (!m) return null;
    const entries = new Map(); // num -> {offset} | {inStream, idx}
    const trailer = new Map();
    const seen = new Set();
    const queue = [parseInt(m[1], 10)];
    let sections = 0;
    while (queue.length && sections < 64) {
      const off = queue.shift();
      if (!Number.isFinite(off) || off < 0 || off >= bytes.length || seen.has(off)) continue;
      seen.add(off);
      sections++;
      const lx = new Lexer(bytes, off);
      lx.skipWs();
      if (latin1(bytes, lx.pos, lx.pos + 4) === 'xref') {
        // classic table
        lx.pos += 4;
        for (;;) {
          lx.skipWs();
          if (latin1(bytes, lx.pos, lx.pos + 7) === 'trailer') {
            lx.pos += 7;
            const t = lx.parseObject(0);
            if (t instanceof Map) {
              for (const [k, v] of t) if (!trailer.has(k)) trailer.set(k, v);
              if (typeof t.get('XRefStm') === 'number') queue.unshift(t.get('XRefStm')); // hybrid files: xref stream first
              if (typeof t.get('Prev') === 'number') queue.push(t.get('Prev'));
            }
            break;
          }
          const first = lx.parseObject(0), count = lx.parseObject(0);
          if (typeof first !== 'number' || typeof count !== 'number') return null;
          lx.skipWs();
          for (let i = 0; i < count; i++) {
            const line = latin1(bytes, lx.pos, lx.pos + 20);
            const em = /^\s*(\d{1,10})\s+(\d{1,5})\s+([nf])/.exec(line);
            if (!em) return null;
            const n = first + i;
            if (em[3] === 'n' && !entries.has(n)) entries.set(n, { offset: parseInt(em[1], 10) });
            if (em[3] === 'f' && !entries.has(n)) entries.set(n, { free: true });
            lx.pos += em[0].length;
            lx.skipWs();
          }
        }
      } else {
        // xref stream
        const xo = parseObjectAt(bytes, lx.pos);
        if (!xo || !xo.dict || xo.streamStart < 0) return null;
        const resolveLocal = (v) => (v instanceof Ref ? null : v);
        const raw = streamBytes(bytes, xo, resolveLocal, warnings);
        if (!raw) return null;
        const { data } = await decodeStream({ dict: xo.dict, raw }, resolveLocal, warnings);
        const W = (xo.dict.get('W') || []).map((x) => (typeof x === 'number' ? x : 0));
        const size = typeof xo.dict.get('Size') === 'number' ? xo.dict.get('Size') : 0;
        const index = Array.isArray(xo.dict.get('Index')) ? xo.dict.get('Index') : [0, size];
        const rowLen = W.reduce((a, b) => a + b, 0);
        let pos = 0;
        for (let k = 0; k + 1 < index.length; k += 2) {
          for (let i = 0; i < index[k + 1]; i++) {
            if (pos + rowLen > data.length) break;
            const fields = [];
            for (const w of W) { let v = 0; for (let j = 0; j < w; j++) v = v * 256 + data[pos++]; fields.push(v); }
            const type = W[0] === 0 ? 1 : fields[0];
            const n = index[k] + i;
            if (entries.has(n)) continue;
            if (type === 1) entries.set(n, { offset: fields[1] });
            else if (type === 2) entries.set(n, { inStream: fields[1], idx: fields[2] });
            else entries.set(n, { free: true });
          }
        }
        for (const [k, v] of xo.dict) if (!trailer.has(k)) trailer.set(k, v);
        if (typeof xo.dict.get('Prev') === 'number') queue.push(xo.dict.get('Prev'));
      }
    }
    if (!entries.size || !trailer.has('Root')) return null;
    // load direct objects
    const objects = new Map();
    let bad = 0;
    for (const [n, e] of entries) {
      if (e.offset === undefined) continue;
      try {
        const o = parseObjectAt(bytes, e.offset, n);
        if (!o) { bad++; continue; }
        objects.set(n, o);
      } catch (err) { bad++; }
    }
    if (bad && !objects.size) return null;
    if (bad) warnings.push(bad + ' cross-reference entries point to invalid offsets');
    // load objects stored in object streams
    const resolve = makeResolver(objects);
    const parsedStreams = new Map(); // objstm num -> {data, header, first}
    for (const [n, e] of entries) {
      if (e.inStream === undefined) continue;
      try {
        let ps = parsedStreams.get(e.inStream);
        if (!ps) {
          const so = objects.get(e.inStream);
          if (!so || so.streamStart < 0) { ps = null; } else {
            const raw = streamBytes(bytes, so, resolve, warnings);
            const { data } = await decodeStream({ dict: so.dict, raw }, resolve, warnings);
            const nn = num(resolve(so.dict.get('N'))) || 0;
            const first = num(resolve(so.dict.get('First'))) || 0;
            const header = latin1(data, 0, first).trim().split(/\s+/).map((x) => parseInt(x, 10));
            ps = { data, header, first, n: nn, offset: so.offset };
          }
          parsedStreams.set(e.inStream, ps);
        }
        if (!ps) continue;
        const onum = ps.header[2 * e.idx], ooff = ps.header[2 * e.idx + 1];
        if (onum !== n) { bad++; continue; }
        const lx = new Lexer(ps.data, ps.first + ooff);
        const value = lx.parseObject(0);
        objects.set(n, { num: n, gen: 0, offset: ps.offset, value, dict: value instanceof Map ? value : null, raw: null, streamStart: -1, inObjStm: e.inStream });
      } catch (err) {
        warnings.push('object ' + n + ' in object stream ' + e.inStream + ' could not be read: ' + err.message);
      }
    }
    return { objects, trailer };
  }

  /** Walk a name tree (/Names, /Kids) and return [key, value] pairs. */
  function nameTreeEntries(node, resolve, depth) {
    depth = depth || 0;
    const out = [];
    node = resolve(node);
    if (!(node instanceof Map) || depth > 32) return out;
    const names = resolve(node.get('Names'));
    if (Array.isArray(names)) for (let i = 0; i + 1 < names.length; i += 2) out.push([pdfString(resolve(names[i])), names[i + 1]]);
    const kids = resolve(node.get('Kids'));
    if (Array.isArray(kids)) for (const k of kids) out.push(...nameTreeEntries(k, resolve, depth + 1));
    return out;
  }

  function makeResolver(objects) {
    return function resolve(v, depth) {
      depth = depth || 0;
      let guard = 0;
      while (v instanceof Ref && guard++ < 32) {
        const o = objects.get(v.num);
        v = o ? o.value : null;
      }
      return v;
    };
  }

  function streamBytes(bytes, obj, resolve, warnings) {
    if (obj.streamStart < 0) return null;
    if (typeof obj.resolvedLength === 'number') return bytes.subarray(obj.streamStart, obj.streamStart + obj.resolvedLength);
    let len = resolve(obj.dict.get('Length'));
    let end = -1;
    if (typeof len === 'number' && len >= 0 && obj.streamStart + len <= bytes.length) {
      end = obj.streamStart + len;
      // verify that "endstream" follows (allowing whitespace)
      let k = end;
      while (k < bytes.length && WHITESPACE.has(bytes[k])) k++;
      if (latin1(bytes, k, k + 9) !== 'endstream') end = -1;
    }
    if (end < 0) {
      // fall back to searching for "endstream"
      const idx = findAll(bytes.subarray(obj.streamStart), [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]);
      if (!idx.length) { warnings.push('object ' + obj.num + ': endstream not found'); return null; }
      end = obj.streamStart + idx[0];
      // strip trailing EOL
      if (bytes[end - 1] === 0x0a) end--;
      if (bytes[end - 1] === 0x0d) end--;
    }
    return bytes.subarray(obj.streamStart, end);
  }

  async function expandObjectStreams(bytes, objects, warnings) {
    const resolve = makeResolver(objects);
    for (const obj of Array.from(objects.values())) {
      if (!obj.dict || obj.streamStart < 0) continue;
      const type = resolve(obj.dict.get('Type'));
      if (!(type instanceof Name) || type.name !== 'ObjStm') continue;
      try {
        const raw = streamBytes(bytes, obj, resolve, warnings);
        if (!raw) continue;
        const { data } = await decodeStream({ dict: obj.dict, raw }, resolve, warnings);
        const n = num(resolve(obj.dict.get('N'))) || 0;
        const first = num(resolve(obj.dict.get('First'))) || 0;
        const header = latin1(data, 0, first).trim().split(/\s+/).map((x) => parseInt(x, 10));
        for (let i = 0; i < n; i++) {
          const onum = header[2 * i], off = header[2 * i + 1];
          if (!Number.isFinite(onum) || !Number.isFinite(off)) break;
          try {
            const lx = new Lexer(data, first + off);
            const value = lx.parseObject(0);
            const existing = objects.get(onum);
            // objects inside object streams never override a later direct definition at a higher offset
            if (existing && existing.offset > obj.offset) continue;
            objects.set(onum, { num: onum, gen: 0, offset: obj.offset, value, dict: value instanceof Map ? value : null, raw: null, streamStart: -1, inObjStm: obj.num });
          } catch (e) {
            warnings.push('object ' + onum + ' in object stream ' + obj.num + ' could not be parsed: ' + e.message);
          }
        }
      } catch (e) {
        warnings.push('object stream ' + obj.num + ' could not be decoded: ' + e.message);
      }
    }
  }

  function nameOf(v) { return v instanceof Name ? v.name : null; }

  /** Collect every dictionary (recursively) with /Type /Filespec, including inline ones. */
  function collectFilespecs(objects, resolve) {
    const specs = [];
    const seen = new Set();
    function visit(v, depth) {
      if (depth > 50 || v === null || v === undefined) return;
      if (v instanceof Map) {
        if (seen.has(v)) return;
        seen.add(v);
        const t = nameOf(resolve(v.get('Type')));
        if (t === 'Filespec' || (v.has('EF') && (v.has('F') || v.has('UF')))) specs.push(v);
        for (const val of v.values()) visit(val instanceof Ref ? null : val, depth + 1);
      } else if (Array.isArray(v)) {
        for (const x of v) visit(x instanceof Ref ? null : x, depth + 1);
      }
    }
    for (const o of objects.values()) visit(o.value, 0);
    return specs;
  }

  function parseXmp(xmpText) {
    const get = (re) => { const m = re.exec(xmpText); return m ? m[1].trim() : null; };
    const zugferd = {
      version: get(/<(?:fx|zf):Version>([^<]*)</i) || get(/\b(?:fx|zf):Version="([^"]*)"/i),
      conformanceLevel: get(/<(?:fx|zf):ConformanceLevel>([^<]*)</i) || get(/\b(?:fx|zf):ConformanceLevel="([^"]*)"/i),
      documentType: get(/<(?:fx|zf):DocumentType>([^<]*)</i) || get(/\b(?:fx|zf):DocumentType="([^"]*)"/i),
      documentFileName: get(/<(?:fx|zf):DocumentFileName>([^<]*)</i) || get(/\b(?:fx|zf):DocumentFileName="([^"]*)"/i),
    };
    const pdfa = {
      part: get(/<pdfaid:part>([^<]*)</i) || get(/\bpdfaid:part="([^"]*)"/i),
      conformance: get(/<pdfaid:conformance>([^<]*)</i) || get(/\bpdfaid:conformance="([^"]*)"/i),
    };
    const hasZf = Object.values(zugferd).some(Boolean);
    return { zugferd: hasZf ? zugferd : null, pdfa: pdfa.part ? pdfa : null };
  }

  /**
   * Load the object graph of a PDF: through the cross-reference data when usable, otherwise by
   * scanning the file. Returns { objects: Map<num, obj>, trailer: Map | null, method: 'xref'|'scan',
   * resolve, warnings }. Used by extractEmbeddedFiles and by the container checks (pdfa3-checks.js).
   */
  async function loadDocument(bytes, warnings) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    warnings = warnings || [];
    let objects = null, trailer = null, method = 'xref';
    try {
      const viaXref = await loadViaXref(bytes, warnings);
      if (viaXref) { objects = viaXref.objects; trailer = viaXref.trailer; }
    } catch (e) {
      warnings.push('cross-reference data unusable (' + e.message + '); falling back to scanning');
    }
    if (!objects) {
      method = 'scan';
      objects = scanObjects(bytes, warnings);
      await expandObjectStreams(bytes, objects, warnings);
    }
    return { objects, trailer, method, resolve: makeResolver(objects), warnings };
  }

  async function extractEmbeddedFiles(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const warnings = [];
    if (latin1(bytes, 0, Math.min(1024, bytes.length)).indexOf('%PDF-') < 0) warnings.push('no %PDF- header found in the first 1024 bytes');
    const loaded = await loadDocument(bytes, warnings);
    let objects = loaded.objects, method = loaded.method;
    const trailer = loaded.trailer;
    let resolve = loaded.resolve;
    // catalog name tree (the normative way to list embedded files)
    const namedSpecs = [];
    if (trailer) {
      const catalog = resolve(trailer.get('Root'));
      const names = catalog instanceof Map ? resolve(catalog.get('Names')) : null;
      if (names instanceof Map && names.has('EmbeddedFiles')) {
        for (const [key, spec] of nameTreeEntries(names.get('EmbeddedFiles'), resolve)) {
          const sp = resolve(spec);
          if (sp instanceof Map) namedSpecs.push({ key, spec: sp });
        }
      }
      if (catalog instanceof Map && catalog.has('Encrypt')) warnings.push('document is encrypted');
      if (trailer.has('Encrypt')) warnings.push('document declares /Encrypt (not allowed in PDF/A-3); embedded files may be unreadable');
    }
    // if the xref route found no embedded files at all, try scanning as well (damaged files)
    if (method === 'xref' && !namedSpecs.length && !Array.from(objects.values()).some((o) => o.dict && nameOf(resolve(o.dict.get('Type'))) === 'EmbeddedFile')) {
      const scanned = scanObjects(bytes, []);
      await expandObjectStreams(bytes, scanned, []);
      if (Array.from(scanned.values()).some((o) => o.dict && nameOf(makeResolver(scanned)(o.dict.get('Type'))) === 'EmbeddedFile')) {
        warnings.push('embedded files found only by scanning the file (cross-reference data incomplete)');
        objects = scanned; resolve = makeResolver(objects); method = 'scan';
      }
    }

    // filespecs: map embedded-file object number -> spec info (name-tree specs first, then any other)
    const specs = namedSpecs.map((x) => x.spec).concat(collectFilespecs(objects, resolve));
    const byEf = new Map();
    for (const sp of specs) {
      const ef = resolve(sp.get('EF'));
      const info = {
        name: pdfString(resolve(sp.get('UF'))) || pdfString(resolve(sp.get('F'))) || pdfString(resolve(sp.get('DOS'))) || null,
        description: pdfString(resolve(sp.get('Desc'))) || null,
        afRelationship: nameOf(resolve(sp.get('AFRelationship'))),
      };
      if (ef instanceof Map) {
        for (const key of ['UF', 'F', 'DOS', 'Mac', 'Unix']) {
          const r = ef.get(key);
          if (r instanceof Ref && !byEf.has(r.num)) byEf.set(r.num, info);
        }
      }
    }

    const files = [];
    for (const o of objects.values()) {
      if (!o.dict || o.streamStart < 0) continue;
      const t = nameOf(resolve(o.dict.get('Type')));
      const isEmbedded = t === 'EmbeddedFile' || byEf.has(o.num);
      if (!isEmbedded) continue;
      const info = byEf.get(o.num) || {};
      try {
        const raw = streamBytes(bytes, o, resolve, warnings);
        if (!raw) continue;
        const { data, filters } = await decodeStream({ dict: o.dict, raw }, resolve, warnings);
        const params = resolve(o.dict.get('Params'));
        files.push({
          name: info.name || ('embedded-' + o.num),
          bytes: data,
          mimeType: nameOf(resolve(o.dict.get('Subtype'))),
          description: info.description || null,
          afRelationship: info.afRelationship || null,
          filter: filters.join('+') || 'none',
          objectNumber: o.num,
          size: data.length,
          declaredSize: params instanceof Map ? num(resolve(params.get('Size'))) : null,
          modDate: params instanceof Map ? pdfString(resolve(params.get('ModDate'))) : null,
        });
      } catch (e) {
        warnings.push('embedded file (object ' + o.num + (info.name ? ', ' + info.name : '') + ') could not be decoded: ' + e.message);
      }
    }
    files.sort((a, b) => a.objectNumber - b.objectNumber);

    // XMP metadata
    let xmp = null;
    for (const o of objects.values()) {
      if (!o.dict || o.streamStart < 0) continue;
      if (nameOf(resolve(o.dict.get('Type'))) !== 'Metadata') continue;
      try {
        const raw = streamBytes(bytes, o, resolve, warnings);
        if (!raw) continue;
        const { data } = await decodeStream({ dict: o.dict, raw }, resolve, warnings);
        let text;
        try { text = new TextDecoder('utf-8').decode(data); } catch (e) { text = latin1(data, 0, data.length); }
        const parsed = parseXmp(text);
        xmp = Object.assign({ raw: text, objectNumber: o.num }, parsed);
        if (parsed.zugferd) break; // the one carrying ZUGFeRD data wins
      } catch (e) {
        warnings.push('XMP metadata (object ' + o.num + ') could not be decoded: ' + e.message);
      }
    }

    return { files, xmp, warnings, objectCount: objects.size, method };
  }

  /** Heuristic: which embedded file is the e-invoice XML? */
  function pickInvoiceXml(files) {
    const known = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'order-x.xml', 'deliver-x.xml'];
    const byName = files.find((f) => known.includes(String(f.name).toLowerCase()));
    if (byName) return byName;
    const sniff = files.find((f) => {
      if (!f.bytes || f.bytes.length < 20) return false;
      const head = latin1(f.bytes, 0, Math.min(4096, f.bytes.length));
      return /CrossIndustryInvoice|<Invoice\b|<CreditNote\b|<ubl:Invoice|<ubl:CreditNote/.test(head) || /^(CrossIndustryInvoice|CrossIndustryDocument|Invoice|CreditNote)$/.test(rootElementName(f.bytes) || '');
    });
    return sniff || null;
  }

  /** local name of the root element of an XML document (skips BOM, XML declaration, comments, PIs, DOCTYPE) */
  function rootElementName(bytes) {
    const s = latin1(bytes, 0, Math.min(bytes.length, 1 << 20));
    let i = s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf ? 3 : 0;
    for (let guard = 0; guard < 10000; guard++) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i); if (e < 0) return null; i = e + 2; continue; }
      if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i); if (e < 0) return null; i = e + 3; continue; }
      if (s.startsWith('<!', i)) { const e = s.indexOf('>', i); if (e < 0) return null; i = e + 1; continue; }
      const m = /^<(?:[A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)/.exec(s.slice(i, i + 256));
      return m ? m[1] : null;
    }
    return null;
  }

  return {
    extractEmbeddedFiles, pickInvoiceXml, loadDocument,
    // primitives for the container checks (src/pdfa3-checks.js)
    util: { Ref, Name, nameOf, pdfString, nameTreeEntries, makeResolver, streamBytes, decodeStream, scanObjects, expandObjectStreams, latin1, rootElementName },
    _internal: { Lexer, scanObjects, parseXmp },
  };
});
