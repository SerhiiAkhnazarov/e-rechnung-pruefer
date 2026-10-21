/*
 * robustness-inputs.cjs — the hostile and damaged input files of test/run-robustness-tests.cjs (Node) and
 * test/robustness-browser.cjs (the page in the browsers), generated deterministically.
 * Licence: EUPL-1.2
 */
'use strict';
const zlib = require('zlib');

const UBL = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

/** entity expansion: 10^9 times "lol" from 1 kB ("billion laughs") */
function billionLaughs() {
  const l = ['<?xml version="1.0"?>', '<!DOCTYPE Invoice [', '<!ENTITY lol "lol">'];
  for (let i = 1; i <= 9; i++) l.push('<!ENTITY lol' + i + ' "' + ('&lol' + (i === 1 ? '' : i - 1) + ';').repeat(10) + '">');
  l.push(']>', '<Invoice xmlns="' + UBL + '"><Note xmlns="' + CBC + '">&lol9;</Note></Invoice>');
  return utf8(l.join('\n'));
}
/** quadratic blow-up: one entity of 100 kB referenced 20 000 times (2 GB) */
function quadraticBlowup() {
  return utf8('<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY a "' + 'x'.repeat(100000) + '">]><Invoice xmlns="' + UBL + '"><Note xmlns="' + CBC + '">' + '&a;'.repeat(20000) + '</Note></Invoice>');
}
/** external entities: local files (Unix and Windows) and a network address (a local listener on `port`) */
function xxe(port) {
  return utf8('<?xml version="1.0"?>\n<!DOCTYPE Invoice [ <!ENTITY f SYSTEM "file:///etc/passwd"> <!ENTITY w SYSTEM "file:///C:/Windows/win.ini"> <!ENTITY n SYSTEM "http://127.0.0.1:' + port + '/xxe"> <!ENTITY % p SYSTEM "http://127.0.0.1:' + port + '/dtd"> %p; ]>\n<Invoice xmlns="' + UBL + '"><Note xmlns="' + CBC + '">&f;&w;&n;</Note></Invoice>');
}
/** what a disclosed local file would look like in the result */
const LEAK = /root:[^:\n]*:0:0:|\[fonts\]|for 16-bit app support/;
/** `total` nested elements including the root element */
const nested = (total) => utf8('<?xml version="1.0"?><Invoice xmlns="' + UBL + '">' + '<a>'.repeat(total - 1) + '</a>'.repeat(total - 1) + '</Invoice>');
/** zlib stream of `size` zero bytes (zeros compress about 1000:1: 200 MiB -> about 200 KiB) */
const zeroBomb = (size) => zlib.deflateSync(Buffer.alloc(size), { level: 9 });

/**
 * a minimal PDF with embedded files ({name: {data} | {deflated}, length?}) and extra objects, with a valid xref table
 */
function pdf(files, extra) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const names = [], specs = [];
  const catalog = add(null), pages = add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>');
  for (const [name, f] of Object.entries(files)) {
    const stream = f.deflated || zlib.deflateSync(f.data);
    const ef = add({ dict: '<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode /Length ' + (f.length !== undefined ? f.length : stream.length) + ' >>', stream });
    const spec = add('<< /Type /Filespec /F (' + name + ') /UF (' + name + ') /AFRelationship /Alternative /EF << /F ' + ef + ' 0 R /UF ' + ef + ' 0 R >> >>');
    names.push('(' + name + ') ' + spec + ' 0 R');
    specs.push(spec + ' 0 R');
  }
  for (const e of extra || []) add(e);
  objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pages + ' 0 R /Names << /EmbeddedFiles << /Names [' + names.join(' ') + '] >> >> /AF [' + specs.join(' ') + '] >>';
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    const head = Buffer.from((i + 1) + ' 0 obj\n' + (typeof o === 'string' ? o + '\nendobj\n' : o.dict + '\nstream\n'), 'latin1');
    const chunk = typeof o === 'string' ? [head] : [head, o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
    for (const c of chunk) { parts.push(c); pos += c.length; }
  });
  const xref = ['xref', '0 ' + (objs.length + 1), '0000000000 65535 f '].concat(offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n ')).join('\n');
  parts.push(Buffer.from(xref + '\ntrailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n', 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** deterministic pseudo-random bytes (xorshift32) */
function randomBytes(n, seed) {
  let x = seed >>> 0 || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 255; }
  return out;
}

module.exports = { UBL, CBC, utf8, billionLaughs, quadraticBlowup, xxe, LEAK, nested, zeroBomb, pdf, randomBytes };
