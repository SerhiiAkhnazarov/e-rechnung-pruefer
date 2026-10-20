#!/usr/bin/env node
/*
 * run-sha256-tests.cjs — src/sha256.js (used in the browser when WebCrypto is unavailable and by the rule-set import)
 * against Node's crypto (OpenSSL): every length from 0 to 1 100 bytes (all padding cases around the 64-byte block
 * boundaries), random data of 1 MiB and 16 MiB + 7 bytes, strings with characters of all UTF-8 lengths, the FIPS 180-4
 * example "abc" and every file of the corpus (build/corpus) and the shipped rule sets.
 *
 * Usage: node test/run-sha256-tests.cjs
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sha256 = require(path.join(__dirname, '..', 'src', 'sha256.js'));
const root = path.join(__dirname, '..');
const node = (b) => crypto.createHash('sha256').update(b).digest('hex');
let n = 0, bytes = 0, fail = 0;
const failures = [];
function cmp(label, input, nodeInput) {
  n++;
  const a = Sha256.hex(input), b = node(nodeInput === undefined ? Buffer.from(input) : nodeInput);
  bytes += typeof input === 'string' ? Buffer.byteLength(input) : input.length;
  if (a !== b) { fail++; if (failures.length < 20) failures.push(label + ': ' + a + ' vs ' + b); }
}
// FIPS 180-4 example (SHA-256 of "abc")
if (Sha256.hex('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') { fail++; failures.push('FIPS 180-4 example "abc"'); }
n++;
// a deterministic generator, so that the test inputs are the same on every machine
let seed = 0x12345678;
const rnd = (len) => { const out = new Uint8Array(len); for (let i = 0; i < len; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; out[i] = seed & 0xff; } return out; };
for (let len = 0; len <= 1100; len++) cmp('random ' + len + ' bytes', rnd(len));
cmp('random 1 MiB', rnd(1 << 20));
cmp('random 16 MiB + 7', rnd((16 << 20) + 7));
for (const s of ['', 'a', 'Prüfprotokoll', '€ „Gutschrift“', '中文 𝄞 😀', 'x'.repeat(55), 'y'.repeat(56), 'ä'.repeat(32)]) cmp('string ' + JSON.stringify(s.slice(0, 20)), s, Buffer.from(s, 'utf8'));
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const files = walk(path.join(root, 'build', 'corpus')).concat(walk(path.join(root, 'build', 'schemas')), walk(path.join(root, 'build', 'xsd')));
for (const f of files) cmp(path.relative(root, f), new Uint8Array(fs.readFileSync(f)));
for (const m of failures) console.log('FAIL ' + m);
console.log('SHA-256 (src/sha256.js) vs Node crypto (OpenSSL ' + process.versions.openssl + '): ' + n + ' inputs (' + files.length + ' files, ' + (bytes / 1048576).toFixed(1) + ' MiB), ' + (n - fail) + ' identical, ' + fail + ' differences');
process.exit(fail ? 1 : 0);
