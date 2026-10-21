/*
 * xml-encoding.js — character encoding of an XML document entity according to XML 1.0 (Fifth Edition)
 * §4.3.3 "Character Encoding in Entities" and Appendix F "Autodetection of Character Encodings":
 *
 *  1. byte order mark: EF BB BF = UTF-8, FE FF = UTF-16BE, FF FE = UTF-16LE (FF FE 00 00 / 00 00 FE FF =
 *     UCS-4, not supported by the WHATWG Encoding Standard / TextDecoder → error);
 *  2. without BOM, the first four bytes of '<?xm' identify the encoding family (3C 3F 78 6D = ASCII-
 *     compatible, 00 3C 00 3F / 3C 00 3F 00 = UTF-16 without BOM, 4C 6F A7 94 = EBCDIC); then the
 *     encoding declaration names the encoding; without declaration the entity is UTF-8;
 *  3. fatal errors (§4.3.3): an entity encoded in UTF-16 must begin with the BOM; it is a fatal error when
 *     an entity is presented in an encoding other than the one named in its declaration (BOM vs.
 *     declaration), and when it contains byte sequences that are not legal in its encoding.
 *
 * Decoding uses TextDecoder with fatal: true, so illegal byte sequences are detected instead of being
 * replaced by U+FFFD. Labels are mapped by the WHATWG Encoding Standard (what browsers and Node do).
 *
 * decode(bytes) → { ok, text, encoding, declared, bom, errors: [{code, message}], notes: [] }
 * Licence: EUPL-1.2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XmlEncoding = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const asciiPrefix = (bytes, n) => {
    let s = '';
    for (let i = 0; i < Math.min(n, bytes.length); i++) s += String.fromCharCode(bytes[i]);
    return s;
  };

  /** the encoding declaration of an ASCII-compatible XML declaration (null when there is none) */
  function declaredEncoding(head) {
    const m = /^<\?xml\s[^>]*?\bencoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(head);
    return m ? m[2] : null;
  }

  /*
   * The WHATWG Encoding Standard (TextDecoder) maps the labels ISO-8859-1 and US-ASCII to windows-1252;
   * XML names encodings by their IANA charset names (XML 1.0 §4.3.3), and an XML processor decodes
   * ISO-8859-1 as Latin-1 (0x80-0x9F = C1 control characters) and US-ASCII as 7 bits (as the JDK parser
   * does). Node.js 22 moreover decodes windows-1252 as Latin-1. These three single-byte charsets are
   * therefore decoded here, identically on every platform; all other encodings go through TextDecoder.
   */
  const CP1252_80_9F = [0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd,
    0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178];
  const SINGLE_BYTE = {
    'iso-8859-1': (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; },
    'us-ascii': (b) => { for (let i = 0; i < b.length; i++) if (b[i] > 0x7f) throw new Error('byte ' + b[i] + ' at offset ' + i + ' is not US-ASCII'); return SINGLE_BYTE['iso-8859-1'](b); },
    'windows-1252': (b) => { let s = ''; for (let i = 0; i < b.length; i++) { const c = b[i]; s += String.fromCharCode(c >= 0x80 && c <= 0x9f ? CP1252_80_9F[c - 0x80] : c); } return s; },
  };
  const IANA_SINGLE_BYTE = { 'iso-8859-1': 'iso-8859-1', 'iso_8859-1': 'iso-8859-1', latin1: 'iso-8859-1', 'l1': 'iso-8859-1', 'iso-ir-100': 'iso-8859-1', 'cp819': 'iso-8859-1', 'ibm819': 'iso-8859-1', 'csisolatin1': 'iso-8859-1',
    'us-ascii': 'us-ascii', ascii: 'us-ascii', 'iso646-us': 'us-ascii', 'ansi_x3.4-1968': 'us-ascii', 'us': 'us-ascii', 'csascii': 'us-ascii',
    'windows-1252': 'windows-1252', 'cp1252': 'windows-1252', 'x-cp1252': 'windows-1252' };

  /** canonical name of a label, or null when the platform does not know it */
  function canonical(label) {
    const l = label.toLowerCase();
    if (IANA_SINGLE_BYTE[l]) return IANA_SINGLE_BYTE[l];
    try { return new TextDecoder(label).encoding; } catch (e) { return null; }
  }
  function decodeWith(encoding, bytes, fatal) {
    if (SINGLE_BYTE[encoding]) return SINGLE_BYTE[encoding](bytes);
    return new TextDecoder(encoding, { fatal, ignoreBOM: false }).decode(bytes);
  }

  function decode(bytes) {
    const errors = [];
    const notes = [];
    let bom = null;
    let family = null;
    let offset = 0;
    const b = bytes;
    if (b.length >= 4 && ((b[0] === 0x00 && b[1] === 0x00 && b[2] === 0xfe && b[3] === 0xff) || (b[0] === 0xff && b[1] === 0xfe && b[2] === 0x00 && b[3] === 0x00))) {
      return { ok: false, text: null, encoding: 'UCS-4', declared: null, bom: 'UCS-4', errors: [{ code: 'XML-ENC-UNSUPPORTED', message: 'Das Dokument ist in UCS-4/UTF-32 kodiert (Byte-Order-Mark). Diese Kodierung wird von Browsern nicht unterstützt (XRechnung verlangt UTF-8).' }], notes };
    }
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { bom = 'UTF-8'; family = 'utf-8'; offset = 3; }
    else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { bom = 'UTF-16BE'; family = 'utf-16be'; offset = 2; }
    else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { bom = 'UTF-16LE'; family = 'utf-16le'; offset = 2; }
    else if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x3c && b[2] === 0x00 && b[3] === 0x3f) { family = 'utf-16be'; errors.push({ code: 'XML-ENC-UTF16-NOBOM', message: 'UTF-16 (Big Endian) ohne Byte-Order-Mark: Nach XML 1.0, Abschnitt 4.3.3, müssen UTF-16-Dokumente mit dem Byte-Order-Mark beginnen.' }); }
    else if (b.length >= 4 && b[0] === 0x3c && b[1] === 0x00 && b[2] === 0x3f && b[3] === 0x00) { family = 'utf-16le'; errors.push({ code: 'XML-ENC-UTF16-NOBOM', message: 'UTF-16 (Little Endian) ohne Byte-Order-Mark: Nach XML 1.0, Abschnitt 4.3.3, müssen UTF-16-Dokumente mit dem Byte-Order-Mark beginnen.' }); }
    else if (b.length >= 4 && b[0] === 0x4c && b[1] === 0x6f && b[2] === 0xa7 && b[3] === 0x94) {
      return { ok: false, text: null, encoding: 'EBCDIC', declared: null, bom: null, errors: [{ code: 'XML-ENC-UNSUPPORTED', message: 'Das Dokument ist EBCDIC-kodiert; diese Kodierung wird nicht unterstützt (XRechnung verlangt UTF-8).' }], notes };
    }

    // the XML declaration in the detected family
    let head;
    if (family === 'utf-16be' || family === 'utf-16le') {
      try { head = new TextDecoder(family).decode(b.subarray(offset, Math.min(b.length, offset + 512))); } catch (e) { head = ''; }
    } else {
      head = asciiPrefix(b.subarray(offset), 512);
    }
    const declared = declaredEncoding(head);
    let encoding;
    if (family === 'utf-16be' || family === 'utf-16le') {
      encoding = family;
      if (declared && !/^utf-?16(le|be)?$/i.test(declared)) errors.push({ code: 'XML-ENC-MISMATCH', message: 'Die Kodierungsangabe encoding="' + declared + '" widerspricht der tatsächlichen Kodierung UTF-16 (XML 1.0, Abschnitt 4.3.3: schwerwiegender Fehler).' });
    } else if (bom === 'UTF-8') {
      encoding = 'utf-8';
      if (declared && canonical(declared) !== 'utf-8') errors.push({ code: 'XML-ENC-MISMATCH', message: 'Die Datei beginnt mit dem UTF-8-Byte-Order-Mark, die XML-Deklaration nennt aber encoding="' + declared + '" (XML 1.0, Abschnitt 4.3.3: schwerwiegender Fehler).' });
    } else if (declared) {
      const c = canonical(declared);
      if (!c) {
        return { ok: false, text: null, encoding: declared, declared, bom, errors: errors.concat([{ code: 'XML-ENC-UNSUPPORTED', message: 'Die Kodierung „' + declared + '“ ist unbekannt bzw. wird von diesem Programm nicht unterstützt.' }]), notes };
      }
      if (c === 'utf-16le' || c === 'utf-16be') {
        errors.push({ code: 'XML-ENC-MISMATCH', message: 'Die XML-Deklaration nennt encoding="' + declared + '", die Datei ist aber nicht UTF-16-kodiert (kein Byte-Order-Mark, ASCII-kompatible Bytes).' });
        encoding = 'utf-8';
      } else encoding = c;
    } else {
      encoding = 'utf-8'; // XML 1.0 §4.3.3: no BOM and no declaration → UTF-8
    }
    let text = null;
    try {
      text = decodeWith(encoding, b, true);
    } catch (e) {
      errors.push({ code: 'XML-ENC-INVALID-BYTES', message: 'Die Datei enthält Bytefolgen, die in der Kodierung ' + encoding.toUpperCase() + ' nicht zulässig sind (XML 1.0, Abschnitt 4.3.3: schwerwiegender Fehler).' });
      try { text = SINGLE_BYTE[encoding] ? null : new TextDecoder(encoding).decode(b); } catch (e2) { text = null; }
    }
    if (bom) notes.push('Byte-Order-Mark ' + bom);
    return { ok: errors.length === 0, text, encoding: encoding.toUpperCase(), declared, bom, errors, notes };
  }

  return { decode, declaredEncoding };
});
