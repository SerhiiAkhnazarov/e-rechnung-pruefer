/*
 * file-safety.js — classifies the files the Prüfer offers for download (the attachments of the invoice, BG-24, and
 * the files embedded in a PDF) and builds safe file names for every download.
 *
 * The Prüfer never opens these files; the user may. A file that runs code when it is opened – a program, a script,
 * an HTML or SVG document, an Office document with macros, a shortcut, a disk image or an archive containing any of
 * these – is marked "danger" and offered only after a second click, under a neutralised name (".gesperrt" appended,
 * so that neither a double click nor the browser runs it). Files whose content contradicts the declared type, and
 * file types that can carry active content which is not inspected here (Office documents, RTF, archives), are
 * marked "caution". Detection by content (magic numbers, the central directory of ZIP files) and by name.
 *
 * API:
 *   classify(bytes: Uint8Array, name: string, declaredMime?: string) ->
 *     { risk: 'ok'|'caution'|'danger', type: string (German), detected: id, extension, reasons: [German],
 *       safeName, downloadName (safeName, or safeName + '.gesperrt' when risk is danger) }
 *   safeFileName(name, fallback?) -> a file name without control and formatting characters (bidirectional overrides
 *     such as U+202E, which can disguise ".exe" as ".pdf"), path separators, characters reserved on Windows, reserved
 *     device names (CON, NUL, …) and leading/trailing dots or spaces; whitespace becomes '_'; at most 120 characters
 *   addPdfFindings(classification, PdfA3Checks.activeContent(doc)) -> the classification of a PDF attachment with its
 *     JavaScript, Launch and other active content
 *   csvFormulaRisk(text) -> true when a CSV text has a cell that a spreadsheet program would evaluate as a formula
 *   decodeBase64(text) -> Uint8Array (attachments of the invoice, BT-125)
 *   DANGEROUS_EXTENSIONS
 *
 * Plain UMD, no dependencies. Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FileSafety = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // run code when opened (Windows, macOS, Linux; browsers for HTML/SVG; Office with macros; shortcuts, installers,
  // disk images that mount and show programs)
  const DANGEROUS_EXTENSIONS = new Set(('exe com scr pif cpl msi msp mst msc dll sys drv ocx bat cmd ps1 ps1xml ps2 ps2xml psc1 psc2 psm1 psd1 ' +
    'vb vbs vbe js jse mjs cjs jar class wsf wsh wsc ws hta html htm xhtml xht mht mhtml shtml svg svgz lnk url website reg inf scf ' +
    'application appref-ms gadget msix msixbundle appx appxbundle xbap iso img vhd vhdx dmg pkg mpkg app command tool sh bash zsh csh ksh fish ' +
    'py pyw pyc pyz pl rb php phar apk deb rpm run bin elf so dylib docm dotm xlsm xltm xlam xla pptm potm ppam ppsm sldm ' +
    'chm hlp xll wll ade adp mde accde accdr settingcontent-ms library-ms searchconnector-ms desktop diagcab cab appimage').split(/\s+/));
  const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

  const MIME_FAMILY = {
    pdf: ['application/pdf'],
    png: ['image/png'], jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'], gif: ['image/gif'], tiff: ['image/tiff'], bmp: ['image/bmp'], webp: ['image/webp'],
    xml: ['text/xml', 'application/xml'],
    text: ['text/plain', 'text/csv'],
    ooxml: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    odf: ['application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.presentation'],
    zip: ['application/zip', 'application/x-zip-compressed'],
  };
  const TYPE_LABEL = {
    pe: 'Windows-Programm (EXE/DLL)', elf: 'Linux-Programm (ELF)', macho: 'macOS-Programm (Mach-O)', javaclass: 'Java-Programm (CLASS)',
    script: 'Skript (Shebang „#!“)', eicar: 'EICAR-Testdatei für Virenscanner', lnk: 'Windows-Verknüpfung (LNK)', html: 'HTML-Dokument (kann Skripte ausführen)', svg: 'SVG-Grafik (kann Skripte enthalten)',
    ole: 'Office-Datei im Altformat (OLE: DOC, XLS, PPT, MSI)', 'ooxml-macro': 'Office-Dokument mit Makros', ooxml: 'Office-Dokument (OOXML)', 'odf-macro': 'OpenDocument mit Makros', odf: 'OpenDocument',
    jar: 'Java-Archiv (JAR)', 'zip-exec': 'ZIP-Archiv mit ausführbaren Dateien', zip: 'ZIP-Archiv', archive: 'Archiv', cab: 'Windows-Archiv (CAB)', iso: 'Datenträgerabbild (ISO)',
    rtf: 'RTF-Dokument', pdf: 'PDF-Dokument', png: 'PNG-Bild', jpeg: 'JPEG-Bild', gif: 'GIF-Bild', tiff: 'TIFF-Bild', bmp: 'BMP-Bild', webp: 'WebP-Bild',
    xml: 'XML-Dokument', text: 'Text', unknown: 'unbekanntes Format', empty: 'leere Datei',
  };

  const latin1 = (bytes, start, end) => { let s = ''; for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]); return s; };
  const startsWith = (bytes, sig, at) => { at = at || 0; if (bytes.length < at + sig.length) return false; for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false; return true; };
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

  /** file names of a ZIP archive from its central directory (null when it cannot be read; ZIP64: null) */
  function zipNames(b) {
    const max = Math.min(b.length, 22 + 65535);
    for (let e = b.length - 22; e >= b.length - max; e--) {
      if (e < 0) break;
      if (b[e] !== 0x50 || b[e + 1] !== 0x4b || b[e + 2] !== 0x05 || b[e + 3] !== 0x06) continue;
      const count = u16(b, e + 10), size = u32(b, e + 12), offset = u32(b, e + 16);
      if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
      if (offset + size > b.length) return null;
      const names = [];
      let p = offset;
      for (let k = 0; k < count && k < 20000; k++) {
        if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return names.length ? names : null;
        const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
        let n = '';
        try { n = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(p + 46, p + 46 + nl)); } catch (x) { n = latin1(b, p + 46, p + 46 + nl); }
        names.push(n);
        p += 46 + nl + xl + cl;
      }
      return names;
    }
    return null;
  }

  const extOf = (name) => { const m = /\.([A-Za-z0-9-]{1,24})$/.exec(String(name || '').trim()); return m ? m[1].toLowerCase() : ''; };

  /** the first characters of a text file, without byte order mark and leading whitespace (for HTML/SVG detection) */
  function textHead(b) {
    let start = 0, enc = 'utf-8';
    if (startsWith(b, [0xef, 0xbb, 0xbf])) start = 3;
    else if (startsWith(b, [0xff, 0xfe])) { start = 2; enc = 'utf-16le'; }
    else if (startsWith(b, [0xfe, 0xff])) { start = 2; enc = 'utf-16be'; }
    else if (b.length > 3 && b[0] === 0x3c && b[1] === 0x00) enc = 'utf-16le';
    else if (b.length > 3 && b[0] === 0x00 && b[1] === 0x3c) enc = 'utf-16be';
    let s = '';
    try { s = new TextDecoder(enc, { fatal: false }).decode(b.subarray(start, Math.min(b.length, start + 8192))); } catch (x) { s = latin1(b, start, start + 8192); }
    return s.replace(/^\s+/, '');
  }

  /** printable text? (no NUL bytes, at most 2 % control characters in the first 8 KiB) */
  function looksLikeText(b) {
    const n = Math.min(b.length, 8192);
    if (!n) return false;
    let ctl = 0;
    for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false; if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c) ctl++; }
    return ctl / n < 0.02;
  }

  /** content type by magic numbers and structure */
  // the EICAR anti-malware test file (68 characters, optionally followed by whitespace): harmless, but every virus
  // scanner reports it as malware – a file to be kept away like one; recognised by its first 68 characters whatever
  // follows (a scanner that matches the signature anywhere would still report a longer file)
  // (assembled from parts, so that this source file and the page never contain the signature itself)
  const EICAR = ['X5O!P%@AP[4', 'PZX54(P^)7CC)7}$EICAR-', 'STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join('').replace('[4P', '[4\\P');
  function detect(b) {
    if (!b || !b.length) return { id: 'empty' };
    if (b.length >= 68 && latin1(b, 0, 68) === EICAR) return { id: 'eicar' };
    if (startsWith(b, [0x4d, 0x5a])) return { id: 'pe' };
    if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { id: 'elf' };
    if (startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xcf, 0xfa, 0xed, 0xfe])) return { id: 'macho' };
    if (startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return { id: b.length > 7 && b[7] >= 45 && b[7] < 100 ? 'javaclass' : 'macho' }; // Java class file versions 45+; otherwise Mach-O universal binary
    if (startsWith(b, [0x23, 0x21])) return { id: 'script' };
    if (startsWith(b, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) return { id: 'lnk' };
    if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { id: 'ole' };
    if (startsWith(b, [0x4d, 0x53, 0x43, 0x46])) return { id: 'cab' };
    if (b.length > 0x8006 && latin1(b, 0x8001, 0x8006) === 'CD001') return { id: 'iso' };
    if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]) || startsWith(b, [0x50, 0x4b, 0x07, 0x08])) {
      const names = zipNames(b);
      if (!names) return { id: 'zip', note: 'Inhaltsverzeichnis nicht lesbar' };
      const lower = names.map((n) => n.toLowerCase());
      if (lower.some((n) => /(^|\/)vbaproject\.bin$/.test(n) || /(^|\/)vbadata\.xml$/.test(n))) return { id: 'ooxml-macro', names };
      if (lower.includes('[content_types].xml')) return { id: 'ooxml', names };
      if (lower.includes('mimetype') && lower.some((n) => n === 'content.xml')) return lower.some((n) => /^basic\//.test(n) || /^scripts\//.test(n)) ? { id: 'odf-macro', names } : { id: 'odf', names };
      if (lower.includes('meta-inf/manifest.mf') && lower.some((n) => n.endsWith('.class'))) return { id: 'jar', names };
      const exec = names.filter((n) => DANGEROUS_EXTENSIONS.has(extOf(n)));
      if (exec.length) return { id: 'zip-exec', names, exec };
      return { id: 'zip', names };
    }
    if (startsWith(b, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) || startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || startsWith(b, [0x1f, 0x8b]) || startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) || startsWith(b, [0x42, 0x5a, 0x68]) || startsWith(b, [0x28, 0xb5, 0x2f, 0xfd])) return { id: 'archive' };
    if (latin1(b, 0, 1024).indexOf('%PDF-') >= 0) return { id: 'pdf' };
    if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { id: 'png' };
    if (startsWith(b, [0xff, 0xd8, 0xff])) return { id: 'jpeg' };
    if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { id: 'gif' };
    if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return { id: 'tiff' };
    if (startsWith(b, [0x42, 0x4d]) && b.length > 14 && u32(b, 2) === b.length) return { id: 'bmp' };
    if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && latin1(b, 8, 12) === 'WEBP') return { id: 'webp' };
    if (startsWith(b, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return { id: 'rtf' };
    const head = textHead(b);
    const lowHead = head.slice(0, 4096).toLowerCase();
    if (/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]|^<script[\s>]|^<iframe[\s>]/.test(lowHead) || (/^<\?xml/.test(lowHead) && /<html[\s>][^]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml/.test(lowHead))) return { id: 'html' };
    if (/^(<\?xml[^>]*\?>\s*)?(<!--[^]*?-->\s*)*<svg[\s>]/.test(lowHead) || /<svg[\s>][^]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg/.test(lowHead)) return { id: 'svg' };
    if (/^<\?xml|^<[A-Za-z_][\w.:-]*[\s>/]/.test(head)) return { id: 'xml' };
    if (looksLikeText(b)) return { id: 'text' };
    return { id: 'unknown' };
  }

  // cells of a CSV text that a spreadsheet program evaluates (OWASP "CSV Injection"): =, +, -, @ (also full-width),
  // a leading tab or carriage return; plain numbers such as -12,50 are no formula
  const FORMULA_START = /^\s*[=+\-@＝＋－＠]|^[\t\r]/;
  const PLAIN_NUMBER = /^\s*[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?\s*$/;
  function csvFormulaRisk(text) {
    const lines = String(text).split(/\r\n|\n|\r/).slice(0, 5000);
    for (const line of lines) {
      for (const sep of [';', ',', '\t']) {
        if (line.indexOf(sep) < 0 && sep !== ';') continue;
        for (let cell of line.split(sep)) {
          cell = cell.replace(/^"|"$/g, '');
          if (FORMULA_START.test(cell) && !PLAIN_NUMBER.test(cell)) return true;
        }
      }
    }
    return false;
  }

  /** Base64 (RFC 4648, also with line breaks and other characters outside the alphabet, which are skipped) to bytes,
   * in a typed array of the exact size – no intermediate array per byte (large attachments) */
  const B64 = (() => { const t = new Int16Array(256).fill(-1); const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i; t[45] = 62; t[95] = 63; return t; })(); // '-' '_' (base64url) too
  function decodeBase64(text) {
    const s = String(text || '');
    let n = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 61) break; if (c < 256 && B64[c] >= 0) n++; }
    const out = new Uint8Array((n * 3) >> 2);
    let buf = 0, bits = 0, o = 0;
    for (let i = 0; i < s.length && o < out.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 61) break;
      const v = c < 256 ? B64[c] : -1;
      if (v < 0) continue;
      buf = ((buf << 6) | v) & 0xffffff; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
    }
    return out;
  }

  /** add the findings of PdfA3Checks.activeContent for a PDF attachment to its classification */
  function addPdfFindings(c, active) {
    if (!c || !active) return c;
    const raise = (r, why) => { if (r === 'danger' || (r === 'caution' && c.risk === 'ok')) c.risk = r; if (!c.reasons.includes(why)) c.reasons.push(why); };
    if (active.javascript) raise('danger', 'Das PDF enthält JavaScript, das ein PDF-Programm beim Öffnen oder bei Bedienung ausführen kann.');
    if (active.launch) raise('danger', 'Das PDF enthält eine Launch-Aktion, die ein Programm starten oder eine Datei öffnen kann.');
    const other = (active.forbidden || []).filter((x) => x.type !== 'JavaScript' && x.type !== 'Launch');
    if (other.length) raise('caution', 'Das PDF enthält in PDF/A-3 unzulässige Aktionen (' + Array.from(new Set(other.map((x) => '/' + x.type))).join(', ') + ').');
    if (active.submitForm) raise('caution', 'Das PDF enthält ein Formular, das Daten an eine Internetadresse senden kann (SubmitForm).');
    c.downloadName = c.risk === 'danger' ? c.safeName + '.gesperrt' : c.safeName;
    return c;
  }

  function safeFileName(name, fallback) {
    let s = String(name === null || name === undefined ? '' : name).normalize('NFC');
    // control (Cc), formatting incl. bidirectional overrides and zero-width characters (Cf), line/paragraph separators
    s = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/gu, '');
    // path separators and characters reserved on Windows; whitespace
    s = s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
    // leading/trailing dots, underscores and spaces (hidden files, Windows trims trailing dots)
    s = s.replace(/^[._\s]+|[._\s]+$/g, '');
    if (RESERVED_DEVICE.test(s)) s = '_' + s;
    if (s.length > 120) { const ext = extOf(s); s = ext && ext.length < 20 ? s.slice(0, 119 - ext.length).replace(/[._]+$/, '') + '.' + ext : s.slice(0, 120); }
    return s || (fallback === undefined ? 'Datei' : fallback);
  }

  function classify(bytes, name, declaredMime) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const safeName = safeFileName(name, 'Anlage');
    const ext = extOf(safeName);
    const d = detect(b);
    const reasons = [];
    let risk = 'ok';
    const raise = (r, why) => { if (r === 'danger' || (r === 'caution' && risk === 'ok')) risk = r; if (why && !reasons.includes(why)) reasons.push(why); };
    const original = String(name || '');
    // bidirectional controls can show "rechnung\u202Efdp.exe" as "rechnungexe.pdf"; other invisible characters
    if (/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(original)) raise('danger', 'Der Dateiname enthält Steuerzeichen für die Schreibrichtung, die die Dateiendung verschleiern können.');
    else if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(original)) raise('caution', 'Der Dateiname enthält unsichtbare Zeichen (im angebotenen Namen entfernt).');
    switch (d.id) {
      case 'pe': case 'elf': case 'macho': case 'javaclass': case 'script': case 'lnk': case 'jar': case 'html': case 'svg': case 'ooxml-macro': case 'odf-macro': case 'iso':
        raise('danger', TYPE_LABEL[d.id] + ': Beim Öffnen kann Programmcode ausgeführt werden.'); break;
      case 'eicar':
        raise('danger', 'Die Datei ist die EICAR-Testdatei: harmlos, aber jeder Virenscanner meldet sie als Schadsoftware – wie Schadsoftware zu behandeln.'); break;
      case 'zip-exec':
        raise('danger', 'Das ZIP-Archiv enthält ausführbare Dateien (' + d.exec.slice(0, 3).join(', ') + (d.exec.length > 3 ? ', …' : '') + ').'); break;
      case 'ole': raise('caution', 'Office-Datei im Altformat: Makros werden nicht geprüft.'); break;
      case 'ooxml': case 'odf': raise('caution', 'Office-Dokument: Makros sind nicht enthalten; externe Verknüpfungen werden nicht geprüft – in der geschützten Ansicht öffnen.'); break;
      case 'zip': raise('caution', 'Archiv: Der Inhalt wird nicht geprüft' + (d.note ? ' (' + d.note + ')' : '') + '.'); break;
      case 'archive': case 'cab': raise('caution', 'Archiv: Der Inhalt wird nicht geprüft.'); break;
      case 'rtf': raise('caution', 'RTF-Dokument: Dieses Format wird häufig für Angriffe auf Textverarbeitungen genutzt.'); break;
      case 'unknown': raise('caution', 'Das Format ist unbekannt.'); break;
      default: break;
    }
    if (d.id === 'text' && (ext === 'csv' || /csv/i.test(declaredMime || '')) && csvFormulaRisk(textHead(b))) raise('caution', 'CSV-Datei mit Zellen, die eine Tabellenkalkulation als Formel ausführt (Beginn mit =, +, - oder @).');
    if (DANGEROUS_EXTENSIONS.has(ext)) raise('danger', 'Die Dateiendung „.' + ext + '“ bezeichnet ein ausführbares Format.');
    else if (!ext) raise('caution', 'Der Dateiname hat keine Endung.');
    // declared type vs. content
    const dm = String(declaredMime || '').toLowerCase().split(';')[0].trim();
    const fam = Object.keys(MIME_FAMILY).find((k) => MIME_FAMILY[k].includes(dm));
    const contentFam = { jpeg: 'jpeg', png: 'png', gif: 'gif', tiff: 'tiff', bmp: 'bmp', webp: 'webp', pdf: 'pdf', xml: 'xml', text: 'text', ooxml: 'ooxml', 'ooxml-macro': 'ooxml', odf: 'odf', 'odf-macro': 'odf', zip: 'zip', 'zip-exec': 'zip', jar: 'zip' }[d.id] || null;
    if (fam && contentFam && fam !== contentFam && !(fam === 'text' && contentFam === 'xml') && !(fam === 'xml' && contentFam === 'text') && !(fam === 'zip' && (contentFam === 'ooxml' || contentFam === 'odf'))) {
      raise('caution', 'Der angegebene Typ „' + dm + '“ passt nicht zum Inhalt: ' + TYPE_LABEL[d.id] + '.');
    } else if (fam && !contentFam && d.id !== 'empty') {
      raise(['pe', 'elf', 'macho', 'javaclass', 'script', 'lnk', 'html', 'svg'].includes(d.id) ? 'danger' : 'caution', 'Der angegebene Typ „' + dm + '“ passt nicht zum Inhalt: ' + TYPE_LABEL[d.id] + '.');
    }
    const extFam = { pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', tif: 'tiff', tiff: 'tiff', bmp: 'bmp', webp: 'webp', xml: 'xml', csv: 'text', txt: 'text', xlsx: 'ooxml', docx: 'ooxml', pptx: 'ooxml', ods: 'odf', odt: 'odf', odp: 'odf', zip: 'zip' }[ext];
    if (extFam && contentFam && extFam !== contentFam && !(extFam === 'text' && contentFam === 'xml') && !(extFam === 'xml' && contentFam === 'text')) {
      raise('caution', 'Die Dateiendung „.' + ext + '“ passt nicht zum Inhalt: ' + TYPE_LABEL[d.id] + '.');
    } else if (extFam && !contentFam && d.id !== 'empty' && d.id !== 'unknown') {
      raise(['pe', 'elf', 'macho', 'javaclass', 'script', 'lnk', 'html', 'svg'].includes(d.id) ? 'danger' : 'caution', 'Die Dateiendung „.' + ext + '“ passt nicht zum Inhalt: ' + TYPE_LABEL[d.id] + '.');
    }
    return { risk, type: TYPE_LABEL[d.id] || d.id, detected: d.id, extension: ext, reasons, safeName, downloadName: risk === 'danger' ? safeName + '.gesperrt' : safeName };
  }

  return { classify, addPdfFindings, safeFileName, csvFormulaRisk, decodeBase64, detect, zipNames, DANGEROUS_EXTENSIONS, TYPE_LABEL };
});
