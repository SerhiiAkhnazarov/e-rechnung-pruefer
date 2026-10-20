/*
 * pdf-writer.js — a small PDF 1.4 writer for the documents the Prüfer produces itself (Prüfprotokoll, Lesefassung der
 * Rechnung): A4 pages, text in the standard fonts Helvetica / Helvetica-Bold / Courier with WinAnsiEncoding (widths:
 * src/pdf-fonts.js), filled rectangles and lines, a flow layout with headings, paragraphs, key/value lists and tables
 * with automatic page breaks, and a footer with page numbers. No fonts are embedded and nothing is compressed; the
 * output is plain ASCII PDF (bytes >= 128 of the text as octal escapes), byte-identical for identical input.
 *
 * Characters outside Windows-1252 are written without diacritics where Unicode decomposes them (ő -> o), otherwise
 * as '?'; doc.replaced counts them.
 *
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pdf-fonts.js'));
  else root.PdfWriter = factory(root.PdfFonts);
})(typeof self !== 'undefined' ? self : this, function (PdfFonts) {
  'use strict';

  const PAGE = { w: 595.28, h: 841.89 }; // A4 in points
  const FONT_KEYS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Courier' };
  // Unicode -> Windows-1252 for the code points 0x80–0x9F of WinAnsiEncoding
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };

  function winAnsiCode(cp) {
    if (cp >= 0x20 && cp <= 0x7e) return cp;
    if (cp >= 0xa0 && cp <= 0xff) return cp;
    if (CP1252[cp] !== undefined) return CP1252[cp];
    return -1;
  }
  /** text -> WinAnsi codes; tabs/control characters become spaces; counts replacements in stats.replaced */
  function encode(str, stats) {
    const out = [];
    for (const ch of String(str)) {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || cp === 0x7f) { out.push(32); continue; }
      let c = winAnsiCode(cp);
      if (c < 0) {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        c = base.length === 1 ? winAnsiCode(base.codePointAt(0)) : -1;
        if (c < 0) c = 63; // '?'
        if (stats) stats.replaced++;
      }
      out.push(c);
    }
    return out;
  }
  const widthOf = (codes, font, size) => { const w = PdfFonts[FONT_KEYS[font]].widths; let s = 0; for (const c of codes) s += w[c - 32]; return (s * size) / 1000; };
  const num = (n) => { const s = (Math.round(n * 100) / 100).toFixed(2); return s.replace(/\.?0+$/, '') || '0'; };
  const pdfString = (codes) => {
    let s = '(';
    for (const c of codes) {
      if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
      else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
      else s += '\\' + c.toString(8).padStart(3, '0');
    }
    return s + ')';
  };
  /** Info dictionary strings: UTF-16BE with byte order mark, as hex */
  const utf16Hex = (str) => { let h = 'FEFF'; for (let i = 0; i < str.length; i++) h += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase(); return '<' + h + '>'; };
  const rgb = (c) => (c || [0, 0, 0]).map((x) => num(x)).join(' ');

  /** low-level document: pages with drawing operations */
  function createDocument(meta) {
    meta = meta || {};
    const pages = [];
    const stats = { replaced: 0 };
    let page = null;
    const doc = {
      page: PAGE,
      stats,
      addPage() { page = { ops: [] }; pages.push(page); return pages.length; },
      get pageCount() { return pages.length; },
      text(x, y, str, font, size, color) {
        const codes = encode(str, stats);
        page.ops.push('BT ' + rgb(color) + ' rg /' + font + ' ' + num(size) + ' Tf 1 0 0 1 ' + num(x) + ' ' + num(y) + ' Tm ' + pdfString(codes) + ' Tj ET');
      },
      rect(x, y, w, h, color) { page.ops.push(rgb(color) + ' rg ' + num(x) + ' ' + num(y) + ' ' + num(w) + ' ' + num(h) + ' re f'); },
      line(x1, y1, x2, y2, width, color) { page.ops.push(rgb(color) + ' RG ' + num(width || 0.5) + ' w ' + num(x1) + ' ' + num(y1) + ' m ' + num(x2) + ' ' + num(y2) + ' l S'); },
      width: (str, font, size) => widthOf(encode(str), font, size),
      /** draws per page footer(pageNo, pageCount) and returns the PDF as Uint8Array */
      finish(footer) {
        if (!pages.length) doc.addPage();
        if (footer) pages.forEach((p, i) => { page = p; footer(i + 1, pages.length); });
        const objs = [];
        const add = (body) => { objs.push(body); return objs.length; };
        const catalog = add(null), pagesObj = add(null);
        const fonts = Object.entries(FONT_KEYS).map(([k, name]) => [k, add('<< /Type /Font /Subtype /Type1 /BaseFont /' + name + ' /Encoding /WinAnsiEncoding >>')]);
        const fontRes = '<< ' + fonts.map(([k, n]) => '/' + k + ' ' + n + ' 0 R').join(' ') + ' >>';
        const d = meta.date ? meta.date : new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const pdfDate = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
        const info = add('<< ' + [['Title', meta.title], ['Author', meta.author], ['Subject', meta.subject], ['Keywords', meta.keywords], ['Creator', meta.creator], ['Producer', meta.producer]].filter(([, v]) => v).map(([k, v]) => '/' + k + ' ' + utf16Hex(String(v))).join(' ') + ' /CreationDate (' + pdfDate + ') /ModDate (' + pdfDate + ') >>');
        const kids = [];
        for (const p of pages) {
          const content = p.ops.join('\n') + '\n';
          const c = add('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
          kids.push(add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + num(PAGE.w) + ' ' + num(PAGE.h) + '] /Resources << /Font ' + fontRes + ' >> /Contents ' + c + ' 0 R >>'));
        }
        objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R' + (meta.lang ? ' /Lang ' + utf16Hex(meta.lang) : '') + ' >>';
        objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
        let out = '%PDF-1.4\n%âãÏÓ\n';
        const offsets = [];
        objs.forEach((body, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
        const xref = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
        const id = (meta.id || '').replace(/[^0-9a-fA-F]/g, '').padEnd(32, '0').slice(0, 32);
        out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R /ID [<' + id + '> <' + id + '>] >>\nstartxref\n' + xref + '\n%%EOF\n';
        const bytes = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // the document is ASCII except the binary comment
        return bytes;
      },
    };
    return doc;
  }

  /**
   * Flow layout on top of a document: a cursor that moves down the page, new pages when needed.
   * opts: margins {left, right, top, bottom}, header(flow) drawn at the top of every new page
   */
  function createFlow(doc, opts) {
    opts = opts || {};
    const m = Object.assign({ left: 50, right: 50, top: 50, bottom: 62 }, opts.margins || {});
    const W = doc.page.w - m.left - m.right;
    let y = 0;
    const f = {
      left: m.left, width: W,
      get y() { return y; },
      newPage() { doc.addPage(); y = doc.page.h - m.top; if (opts.header) opts.header(f); },
      ensure(h) { if (y - h < m.bottom) f.newPage(); },
      gap(h) { y -= h; },
      /** wrapped lines of a text in a width */
      wrap(text, font, size, width) {
        const lines = [];
        for (const para of String(text === null || text === undefined ? '' : text).split(/\r?\n/)) {
          const words = para.split(/ +/);
          let line = '';
          for (let w of words) {
            const cand = line ? line + ' ' + w : w;
            if (doc.width(cand, font, size) <= width) { line = cand; continue; }
            if (line) { lines.push(line); line = ''; }
            while (doc.width(w, font, size) > width) { // a word wider than the column: break it
              let k = w.length;
              while (k > 1 && doc.width(w.slice(0, k), font, size) > width) k--;
              lines.push(w.slice(0, k)); w = w.slice(k);
            }
            line = w;
          }
          lines.push(line);
        }
        return lines;
      },
      text(str, o) {
        o = Object.assign({ font: 'F1', size: 9.5, color: [0.1, 0.12, 0.16], indent: 0, leading: 1.32, width: null, after: 2 }, o || {});
        const width = (o.width || W) - o.indent;
        const lead = o.size * o.leading;
        for (const line of f.wrap(str, o.font, o.size, width)) {
          f.ensure(lead);
          doc.text(m.left + o.indent, y - o.size, line, o.font, o.size, o.color);
          y -= lead;
        }
        y -= o.after;
      },
      heading(str, level) {
        const size = level === 1 ? 15 : level === 2 ? 11.5 : 10;
        f.ensure(size * 2.6);
        y -= level === 1 ? 2 : 8;
        f.text(str, { font: 'F2', size, color: [0.05, 0.16, 0.28], after: level === 1 ? 4 : 2 });
        if (level <= 2) { doc.line(m.left, y + 1, m.left + W, y + 1, 0.6, [0.75, 0.8, 0.86]); y -= 4; }
      },
      /** filled callout: [{text, font?, size?}] on a coloured background */
      box(parts, color, textColor) {
        const pad = 6;
        const blocks = parts.map((p) => ({ p, lines: f.wrap(p.text, p.font || 'F1', p.size || 9.5, W - 2 * pad) }));
        const h = blocks.reduce((s, b) => s + b.lines.length * (b.p.size || 9.5) * 1.32 + 2, 0) + 2 * pad;
        f.ensure(Math.min(h, 200));
        if (y - h < m.bottom) { // taller than the rest of the page: plain text
          for (const b of blocks) f.text(b.p.text, { font: b.p.font, size: b.p.size, color: textColor });
          return;
        }
        doc.rect(m.left, y - h, W, h, color);
        let yy = y - pad;
        for (const b of blocks) {
          const size = b.p.size || 9.5;
          for (const line of b.lines) { doc.text(m.left + pad, yy - size, line, b.p.font || 'F1', size, textColor); yy -= size * 1.32; }
          yy -= 2;
        }
        y -= h + 6;
      },
      /** label/value rows: [[label, value, valueFont?]] */
      kv(rows, o) {
        o = Object.assign({ labelWidth: 150, size: 9, gap: 1.5 }, o || {});
        for (const [label, value, vf] of rows) {
          if (value === undefined || value === null || value === '') continue;
          const lv = f.wrap(label, 'F1', o.size, o.labelWidth - 8);
          const vv = f.wrap(value, vf || 'F1', o.size, W - o.labelWidth);
          const lead = o.size * 1.3;
          const h = Math.max(lv.length, vv.length) * lead;
          f.ensure(h);
          lv.forEach((l, i) => doc.text(m.left, y - o.size - i * lead, l, 'F1', o.size, [0.36, 0.42, 0.48]));
          vv.forEach((l, i) => doc.text(m.left + o.labelWidth, y - o.size - i * lead, l, vf || 'F1', o.size, [0.1, 0.12, 0.16]));
          y -= h + o.gap;
        }
      },
      /**
       * table: cols [{title, width (fraction of the text width), align: 'left'|'right', font?}], rows [[cell, …]],
       * o.size, o.rowColor(i, row) -> fill colour or null
       */
      table(cols, rows, o) {
        o = Object.assign({ size: 8.5, pad: 3 }, o || {});
        const widths = cols.map((c) => c.width * W);
        const lead = o.size * 1.28;
        const header = () => {
          const hl = cols.map((c, i) => f.wrap(c.title, 'F2', o.size, widths[i] - 2 * o.pad));
          const h = Math.max(...hl.map((l) => l.length)) * lead + 2 * o.pad;
          f.ensure(h + lead + 2 * o.pad);
          doc.rect(m.left, y - h, W, h, [0.93, 0.95, 0.97]);
          let x = m.left;
          hl.forEach((lines, i) => {
            lines.forEach((l, k) => { const tx = cols[i].align === 'right' ? x + widths[i] - o.pad - doc.width(l, 'F2', o.size) : x + o.pad; doc.text(tx, y - o.pad - o.size - k * lead, l, 'F2', o.size, [0.1, 0.12, 0.16]); });
            x += widths[i];
          });
          y -= h;
        };
        header();
        rows.forEach((row, r) => {
          const cl = cols.map((c, i) => f.wrap(row[i] === undefined || row[i] === null ? '' : row[i], c.font || 'F1', o.size, widths[i] - 2 * o.pad));
          const h = Math.max(...cl.map((l) => l.length)) * lead + 2 * o.pad;
          if (y - h < m.bottom) { f.newPage(); header(); }
          const fill = o.rowColor ? o.rowColor(r, row) : null;
          if (fill) doc.rect(m.left, y - h, W, h, fill);
          let x = m.left;
          cl.forEach((lines, i) => {
            lines.forEach((l, k) => { const font = cols[i].font || 'F1'; const tx = cols[i].align === 'right' ? x + widths[i] - o.pad - doc.width(l, font, o.size) : x + o.pad; doc.text(tx, y - o.pad - o.size - k * lead, l, font, o.size, [0.1, 0.12, 0.16]); });
            x += widths[i];
          });
          doc.line(m.left, y - h, m.left + W, y - h, 0.3, [0.85, 0.88, 0.91]);
          y -= h;
        });
        y -= 6;
      },
    };
    f.newPage();
    return f;
  }

  return { createDocument, createFlow, encode, PAGE };
});
