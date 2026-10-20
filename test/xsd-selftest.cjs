#!/usr/bin/env node
/*
 * xsd-selftest.cjs — proves the XSD constructs that the invoice schemas do not use (but
 * src/xsd-validator.js implements) against Xerces with the synthetic schema
 * test/xsd-selftest/features.xsd: every instance below is validated by the oracle in
 * single-schema mode and by our validator; the verdicts must agree (and the expectations noted
 * here document the behaviour).
 *
 * Usage: node test/xsd-selftest.cjs [--report file]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const slimdom = require(path.join(__dirname, '..', 'vendor', 'slimdom.cjs'));
const XV = require(path.join(__dirname, '..', 'src', 'xsd-validator.js'));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function opt(n, d) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }
const reportFile = opt('--report', null);
const schema = path.join(root, 'test', 'xsd-selftest', 'features.xsd');
const outDir = path.join(root, 'build', 'corpus', 'xsd-selftest');
const modelFile = path.join(root, 'build', 'oracle', 'xsd-selftest', 'features-model.json');
const oracleOut = path.join(root, 'build', 'oracle', 'xsd-selftest', 'features.jsonl');

const HEAD = '<f:root xmlns:f="urn:erechnung-pruefer:xsd-selftest" xmlns:o="urn:erechnung-pruefer:xsd-selftest:other" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
function doc(rootAttrs, body) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + HEAD + ' id="r1" ref="r1" refs="r1 r1" lang="en" version="1.0" flag="true"' + (rootAttrs || '') + '>\n  <f:code>AB123</f:code>\n' + (body || '') + '</f:root>\n';
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cases = [];
const add = (id, expect, xml, note) => cases.push({ id, expect, xml, note: note || '' });
const el = (name, value, attrs) => '  <f:' + name + (attrs || '') + '>' + value + '</f:' + name + '>\n';

add('base', true, doc(), 'minimal valid instance');
// occurrence counting (repeating leaves): Xerces-specific error codes
const rep = (wrapper, inner) => doc('', '  <f:' + wrapper + '>' + inner + '</f:' + wrapper + '>\n');
const n = (name, k) => Array.from({ length: k }, () => '<f:' + name + '>x</f:' + name + '>').join('');
add('count-two3-2', true, rep('counts', n('two3', 2)), 'minOccurs=2 maxOccurs=3: 2 occurrences');
add('count-two3-3-after', true, rep('counts', n('two3', 3) + n('after', 1)), '3 occurrences + after');
add('count-two3-1-after', false, rep('counts', n('two3', 1) + n('after', 1)), '1 of min 2, then another element (2.4.i expected)');
add('count-two3-1-end', false, rep('counts', n('two3', 1)), '1 of min 2 at the end (incomplete)');
add('count-two3-4', false, rep('counts', n('two3', 4)), '4 of max 3 (2.4.e expected: after is still allowed)');
add('count-two3-4-after', false, rep('counts', n('two3', 4) + n('after', 1)), '4 of max 3, then after');
add('count-upTo2-3', false, rep('countsEnd', n('upTo2', 3)), '3 of max 2, nothing else allowed (2.4.f expected)');
add('count-upTo2-0', false, rep('countsEnd', ''), '0 of min 1');
add('count-min3-1-tail', false, rep('countsMin3', n('atLeast3', 1) + n('tail', 1)), '1 of min 3 then tail (2.4.j expected)');
add('count-min3-2-tail', false, rep('countsMin3', n('atLeast3', 2) + n('tail', 1)), '2 of min 3 then tail (2.4.i expected)');
add('count-min3-2-end', false, rep('countsMin3', n('atLeast3', 2)), '2 of min 3 at the end');
add('count-min3-5-tail', true, rep('countsMin3', n('atLeast3', 5) + n('tail', 1)), '5 of min 3 (unbounded) then tail');
add('count-min3-3-end', false, rep('countsMin3', n('atLeast3', 3)), '3 then missing tail');
// patterns
for (const [v, ok] of Object.entries({ AB123: true, ab123: false, AB1234: false, AB12: false, 'AB١٢٣': true, ' AB123': false })) add('pattern-code-' + v.replace(/\W/g, '_'), ok, doc('', '').replace('<f:code>AB123</f:code>', '<f:code>' + esc(v) + '</f:code>'), 'code [A-Z]{2}\\d{3} = ' + JSON.stringify(v) + (v === 'AB١٢٣' ? ' (\\d is \\p{Nd} in XSD)' : v === ' AB123' ? ' (xs:string: not collapsed)' : ''));
for (const [v, ok] of Object.entries({ 'Grüße': true, a1: true, '1a': false, '': false, ' x ': true, 'a-b.c': true, 'a b': false })) add('pattern-word-' + Buffer.from(v).toString('hex'), ok, doc('', el('word', esc(v))), 'word (token; \\p{L}+ | \\i\\c*) = ' + JSON.stringify(v));
for (const [v, ok] of Object.entries({ bcd: true, bad: false, '': false, BCD: false })) add('pattern-consonants-' + v, ok, doc('', el('consonants', v)), 'consonants [a-z-[aeiou]]+ = ' + JSON.stringify(v));
// decimal facets
for (const [v, ok] of Object.entries({ '999.99': true, '1000': false, '-1': false, '12.345': false, '1234567': false, '0000.5': true, '999.990': true, '1e3': false, '0': true, '999.999': false, '123456': false, '12345.67': false, '0123.45': true })) add('money-' + v.replace(/\W/g, '_'), ok, doc('', el('money', v)), 'money (totalDigits 6, fractionDigits 2, minInclusive 0, maxExclusive 1000) = ' + v);
for (const [v, ok] of Object.entries({ '0': false, '1': true, '100': true, '101': false, '50.0': false, '+7': true })) add('percent-' + v.replace(/\W/g, '_'), ok, doc('', el('percent', v)), 'percent (integer, minExclusive 0, maxInclusive 100) = ' + v);
for (const [v, ok] of Object.entries({ '1': true, '1.0': true, '2.50': true, '3': true, '2': false, '03.0': true })) add('rating-' + v.replace(/\W/g, '_'), ok, doc('', el('rating', v)), 'rating (decimal enumeration 1, 2.5, 3.0; value-space comparison) = ' + v);
for (const [v, ok] of Object.entries({ abc: true, ' abc ': true, abcd: false, ab: false, 'a c': true })) add('fixed3-' + v.replace(/\W/g, '_'), ok, doc('', el('fixed3', v)), 'fixed3 (length 3, collapse) = ' + JSON.stringify(v));
// list / union
for (const [v, ok] of Object.entries({ '1 2 3': true, '1 2 3 4': false, '1 x': false, '': true, '  1   2 ': true, '99999999999': false, '-5': true })) add('ints-' + Buffer.from(v).toString('hex'), ok, doc('', el('ints', v)), 'ints (list of xs:int, maxLength 3) = ' + JSON.stringify(v));
for (const [v, ok] of Object.entries({ '12': true, Hallo: true, '1a': false, '-5': true, 'x y': false, '': false })) add('union-' + Buffer.from(v).toString('hex'), ok, doc('', el('intOrWord', v)), 'intOrWord (union int|Word) = ' + JSON.stringify(v));
for (const [v, ok] of Object.entries({ red: true, blue: false, ' green ': true })) add('colour-' + v.trim(), ok, doc('', el('colour', v)), 'colour (NMTOKEN enumeration) = ' + JSON.stringify(v));
for (const [v, ok] of Object.entries({ 'a b c': true, '': false, 'a:b c': true, 'a b/c': false })) add('tokens-' + Buffer.from(v).toString('hex'), ok, doc('', el('tokens', v)), 'tokens (NMTOKENS) = ' + JSON.stringify(v));
// QName and other primitives
for (const [v, ok] of Object.entries({ 'f:root': true, 'zz:x': false, root: true, '1x': false, 'xsi:type': true })) add('qname-' + v.replace(/\W/g, '_'), ok, doc('', el('qname', v)), 'qname = ' + v);
for (const [v, ok] of Object.entries({ '1.5': true, '1e3': true, INF: true, '-INF': true, NaN: true, '+INF': false, Infinity: false, '1f': false, '1.e5': true, '.5': true, e5: false, '1e': false, '1e40': true, '0x1p3': false, '+NaN': false })) add('float-' + Buffer.from(v).toString('hex'), ok, doc('', el('float', v)), 'float = ' + v);
for (const [v, ok] of Object.entries({ '1.5E-300': true, '1e400': true, '-0': true, 'abc': false })) add('double-' + v.replace(/\W/g, '_'), ok, doc('', el('double', v)), 'double = ' + v);
for (const [v, ok] of Object.entries({ '0A1b': true, '0A1': false, zz: false, '': true, ' 0a ': true })) add('hex-' + v.replace(/\W/g, '_'), ok, doc('', el('hex', v)), 'hexBinary = ' + JSON.stringify(v));
for (const [v, ok] of Object.entries({ '32767': true, '32768': false, '-32768': true, '-32769': false, '+0032767': true })) add('short-' + v.replace(/\W/g, '_'), ok, doc('', el('short', v)), 'short = ' + v);
for (const [v, ok] of Object.entries({ '127': true, '128': false, '-128': true })) add('byte-' + v.replace(/\W/g, '_'), ok, doc('', el('byte', v)), 'byte = ' + v);
for (const [v, ok] of Object.entries({ '4294967295': true, '4294967296': false, '-1': false, '0': true })) add('uint-' + v.replace(/\W/g, '_'), ok, doc('', el('uint', v)), 'unsignedInt = ' + v);
for (const [v, ok] of Object.entries({ 'a:b': true, '1a': false, 'a b': false, _x: true })) add('name-' + Buffer.from(v).toString('hex'), ok, doc('', el('name', v)), 'Name = ' + JSON.stringify(v));
// gregorian + duration
for (const [v, ok] of Object.entries({ '2024': true, '0000': false, '-0001': true, '2024Z': true, '24': false, '02024': false, '12024': true, '2024+01:00': true, '2024-01': false })) add('gYear-' + v.replace(/\W/g, '_'), ok, doc('', el('year', v)), 'gYear = ' + v);
for (const [v, ok] of Object.entries({ '2024-01': true, '2024-13': false, '2024-1': false, '2024-01Z': true, '2024-01+01:00': true, '2024-01-01': false })) add('gYearMonth-' + v.replace(/\W/g, '_'), ok, doc('', el('yearMonth', v)), 'gYearMonth = ' + v);
for (const [v, ok] of Object.entries({ '--01': true, '--13': false, '--01--': true, '--01-': false, '--01Z': true, '--1': false })) add('gMonth-' + v.replace(/\W/g, '_'), ok, doc('', el('month', v)), 'gMonth = ' + v);
for (const [v, ok] of Object.entries({ '--02-29': true, '--02-30': false, '--04-31': false, '--12-31Z': true, '--12-31-05:00': true })) add('gMonthDay-' + v.replace(/\W/g, '_'), ok, doc('', el('monthDay', v)), 'gMonthDay = ' + v);
for (const [v, ok] of Object.entries({ '---31': true, '---32': false, '---00': false, '---01+01:00': true, '--01': false })) add('gDay-' + v.replace(/\W/g, '_'), ok, doc('', el('day', v)), 'gDay = ' + v);
for (const [v, ok] of Object.entries({ 'P1Y2M3DT4H5M6.7S': true, P: false, PT: false, P1D: true, '-P1D': true, P1S: false, PT1H: true, 'P1.5Y': false, 'PT1.5H': false, P0D: true, P1W: false, P1Y2M3DT: false, PT6S: true, PT06S: true, 'PT6.7S': true, 'PT06.70S': true, 'P1Y2M3DT4H5M06.7S': true, 'PT.5S': true, 'PT5.S': false, 'P1M1Y': false, 'PT1M1H': false, 'P1DT': false, 'P-1D': false, 'P1Y ': true })) add('duration-' + v.replace(/\W/g, '_'), ok, doc('', el('duration', v)), 'duration = ' + JSON.stringify(v));
// bounded choice (0..2 of a | (b1 b2?))
for (const [k, [body, ok]] of Object.entries({ 'a-a': ['<f:a/><f:a/>', true], 'a-a-a': ['<f:a/><f:a/><f:a/>', false], 'b1-b2-a': ['<f:b1/><f:b2/><f:a/>', true], 'b1-b1': ['<f:b1/><f:b1/>', true], b2: ['<f:b2/>', false], 'a-b1': ['<f:a/><f:b1/>', true], 'b1-b2-b2': ['<f:b1/><f:b2/><f:b2/>', false], 'a-b1-b2-a': ['<f:a/><f:b1/><f:b2/><f:a/>', false] })) add('choice-' + k, ok, doc('', '  ' + body + '\n'), 'choice{0,2} of (a | b1 b2?): ' + body);
// code occurrences 1..3
add('code-x3', true, doc('', '  <f:code>AB123</f:code><f:code>AB123</f:code>\n'), 'three codes');
add('code-x4', false, doc('', '  <f:code>AB123</f:code><f:code>AB123</f:code><f:code>AB123</f:code>\n'), 'four codes');
add('code-x0', false, doc().replace('  <f:code>AB123</f:code>\n', ''), 'no code');
// substitution group
add('subst-circle', true, doc('', '  <f:circle name="c"><f:radius>1</f:radius></f:circle>\n'), 'circle substitutes shape');
add('subst-abstract-head', false, doc('', '  <f:shape name="x"/>\n'), 'abstract head element used directly');
add('subst-square', true, doc('', '  <f:square name="s" side="2"/>\n'), 'square substitutes shape');
add('subst-square-noside', false, doc('', '  <f:square name="s"/>\n'), 'square without required side');
add('subst-circle-badname', false, doc('', '  <f:circle name="1c"><f:radius>1</f:radius></f:circle>\n'), 'NCName attribute invalid');
add('subst-circle-xsitype', true, doc('', '  <f:circle name="c" xsi:type="f:CircleType"><f:radius>1</f:radius></f:circle>\n'), 'xsi:type = own type');
add('subst-head-xsitype', false, doc('', '  <f:shape name="x" xsi:type="f:CircleType"><f:radius>1</f:radius></f:shape>\n'), 'abstract head with xsi:type');
add('subst-mixed', true, doc('', '  <f:circle name="c"><f:radius>1</f:radius></f:circle><f:square name="s" side="1"/><f:circle name="d"><f:radius>2</f:radius></f:circle>\n'), 'several substitutes');
add('subst-circle-extra', false, doc('', '  <f:circle name="c"><f:radius>1</f:radius><f:radius>2</f:radius></f:circle>\n'), 'circle with two radius');
// mixed content + complexContent extension + anyAttribute ##other lax
add('para-ok', true, doc('', '  <f:para>text<f:b>x</f:b>more<f:i>y</f:i>tail</f:para>\n'), 'mixed with b then i');
add('para-3i', false, doc('', '  <f:para><f:i>1</f:i><f:i>2</f:i><f:i>3</f:i></f:para>\n'), 'three i (maxOccurs 2)');
add('para-i-before-b', false, doc('', '  <f:para><f:i>1</f:i><f:b>2</f:b></f:para>\n'), 'i before b (extension appends)');
add('para-attr-other-unknown', true, doc('', '  <f:para o:anything="1">t</f:para>\n'), 'anyAttribute ##other lax: undeclared attribute');
add('para-attr-other-global-ok', true, doc('', '  <f:para o:globalAttr="12">t</f:para>\n'), 'anyAttribute lax: global attribute declaration found, valid');
add('para-attr-other-global-bad', false, doc('', '  <f:para o:globalAttr="x">t</f:para>\n'), 'anyAttribute lax: global attribute declaration found, invalid value');
add('para-attr-nsless', false, doc('', '  <f:para local="x">t</f:para>\n'), 'anyAttribute ##other excludes absent namespace');
add('para-attr-own-ns', false, doc('', '  <f:para f:x="1">t</f:para>\n'), 'anyAttribute ##other excludes the target namespace');
// nillable
add('nil-true', true, doc('', '  <f:nil xsi:nil="true"/>\n'), 'nillable element nilled');
add('nil-true-content', false, doc('', '  <f:nil xsi:nil="true">1</f:nil>\n'), 'nilled element with content');
add('nil-false', true, doc('', '  <f:nil xsi:nil="false">1</f:nil>\n'), 'xsi:nil=false with content');
add('nil-bad-value', false, doc('', '  <f:nil xsi:nil="maybe"/>\n'), 'xsi:nil with invalid boolean');
add('nil-empty', false, doc('', '  <f:nil/>\n'), 'empty xs:int element');
add('nil-1', true, doc('', '  <f:nil xsi:nil="1"/>\n'), 'xsi:nil=1');
add('nil-true-ws', false, doc('', '  <f:nil xsi:nil=" true "> </f:nil>\n'), 'xsi:nil with whitespace, whitespace content');
// fixed / default element values
add('fixedEl-ok', true, doc('', el('fixedEl', 'constant')), 'fixed element value');
add('fixedEl-other', false, doc('', el('fixedEl', 'other')), 'other value for a fixed element');
add('fixedEl-empty', true, doc('', '  <f:fixedEl/>\n'), 'empty element with fixed value (value supplied by the schema)');
add('fixedEl-ws', false, doc('', el('fixedEl', ' constant ')), 'fixed xs:string compared literally');
add('fixedEl-ws-only', false, doc('', el('fixedEl', ' ')), 'whitespace-only element with fixed value (whitespace counts as character children: no default applied)');
add('defaultEl-ws-only', false, doc('', el('defaultEl', ' ')), 'whitespace-only element with default (no default applied -> empty int)');
add('defaultEl-comment', true, doc('', el('defaultEl', '<!--c-->')), 'element with only a comment and a default');
add('defaultEl-empty', true, doc('', '  <f:defaultEl/>\n'), 'empty element with default');
add('defaultEl-bad', false, doc('', el('defaultEl', 'x')), 'invalid value for int with default');
// skip wildcard
add('skipper', false, doc('', '  <f:skipper anything="x" xmlns:q="urn:q" q:a="1"><q:junk bad="1"><f:code>bad</f:code></q:junk>text</f:skipper>\n'), 'processContents skip: the wildcard content is not assessed, but the text child violates the element-only content type');
add('skipper-ok', true, doc('', '  <f:skipper anything="x" xmlns:q="urn:q" q:a="1"><q:junk bad="1"><f:code>bad</f:code></q:junk></f:skipper>\n'), 'processContents skip: nothing inside is assessed');
// strict attribute wildcard
add('strictAttr-ok', true, doc('', '  <f:strictAttr o:globalAttr="5"/>\n'), 'strict anyAttribute with declared attribute');
add('strictAttr-bad', false, doc('', '  <f:strictAttr o:globalAttr="x"/>\n'), 'strict anyAttribute with invalid value');
add('strictAttr-unknown', false, doc('', '  <f:strictAttr o:unknown="5"/>\n'), 'strict anyAttribute without declaration');
add('strictAttr-foreign', false, doc('', '  <f:strictAttr xmlns:q="urn:q" q:a="1"/>\n'), 'strict anyAttribute, unknown namespace');
// imported namespace with attributeFormDefault=qualified, global attribute ref
add('other-ok', true, doc('', '  <o:other o:globalAttr="1" local="x" o:qualified="y">http://x</o:other>\n'), 'qualified/unqualified attributes as declared');
add('other-unqualified-qualified', false, doc('', '  <o:other qualified="y">http://x</o:other>\n'), 'declared qualified, written unqualified');
add('other-qualified-local', false, doc('', '  <o:other o:local="x">http://x</o:other>\n'), 'declared unqualified, written qualified');
add('other-bad-uri', false, doc('', '  <o:other>%zz</o:other>\n'), 'anyURI simpleContent invalid');
add('other-bad-global', false, doc('', '  <o:other o:globalAttr="1.5">x</o:other>\n'), 'global attribute (int) invalid');
// chameleon include
add('chameleon-ok', true, doc('', el('chameleon', '2024-01-01')), 'element from a chameleon include');
add('chameleon-bad', false, doc('', el('chameleon', 'x')), 'chameleon element with invalid date');
// inline simple type, empty element type with attributes
add('inline-ok', true, doc('', el('inline', 'ab')), 'inline simpleType maxLength 2');
add('inline-bad', false, doc('', el('inline', 'abc')), 'inline simpleType maxLength 2 exceeded');
add('empty-n0', true, doc('', '  <f:emptyWithAttrs n="0"/>\n'), 'nonNegativeInteger 0');
add('empty-n-1', false, doc('', '  <f:emptyWithAttrs n="-1"/>\n'), 'nonNegativeInteger -1');
add('empty-no-n', false, doc('', '  <f:emptyWithAttrs/>\n'), 'required attribute missing');
add('empty-q-ok', true, doc('', '  <f:emptyWithAttrs n="1" q="f:x"/>\n'), 'QName attribute');
add('empty-q-bad', false, doc('', '  <f:emptyWithAttrs n="1" q="zz:x"/>\n'), 'QName attribute with undeclared prefix');
add('empty-content', false, doc('', '  <f:emptyWithAttrs n="1">x</f:emptyWithAttrs>\n'), 'empty content type with text');
// root attributes: ID/IDREF/IDREFS/fixed/default/boolean
add('idref-unresolved', false, doc().replace('ref="r1"', 'ref="nope"'), 'IDREF without matching ID');
add('idrefs-unresolved', false, doc().replace('refs="r1 r1"', 'refs="r1 nope"'), 'IDREFS with one unresolved item');
add('idrefs-empty', false, doc().replace('refs="r1 r1"', 'refs=""'), 'IDREFS empty (minLength 1)');
add('idref-forward', true, doc().replace('ref="r1"', 'ref="c1"').replace('<f:code>AB123</f:code>\n', '<f:code>AB123</f:code>\n  <f:para o:anything="1">t</f:para>\n'), 'placeholder');
cases.pop();
add('version-fixed-bad', false, doc().replace(' version="1.0" flag', ' version="2.0" flag'), 'fixed attribute value differs');
add('version-absent', true, doc().replace(' version="1.0" flag', ' flag'), 'fixed attribute absent (optional)');
add('lang-bad', false, doc().replace('lang="en"', 'lang="e n"'), 'xs:language invalid');
add('flag-bad', false, doc().replace('flag="true"', 'flag="yes"'), 'boolean attribute invalid');
add('id-bad', false, doc().replace('id="r1" ref="r1" refs="r1 r1"', 'id="1r" ref="1r" refs="1r"'), 'ID not an NCName');
add('unknown-root', false, doc().replace('<f:root ', '<f:rootx ').replace('</f:root>', '</f:rootx>'), 'undeclared root');

function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of cases) fs.writeFileSync(path.join(outDir, c.id + '.xml'), c.xml);
  fs.mkdirSync(path.dirname(oracleOut), { recursive: true });
  execFileSync('node', [path.join(root, 'tools', 'compile-xsd.cjs'), schema, modelFile], { stdio: 'inherit' });
  execFileSync('javac', ['-d', path.join(root, 'test', 'xsd-oracle'), path.join(root, 'test', 'xsd-oracle', 'XsdOracle.java')], { stdio: ['ignore', 'inherit', 'ignore'] });
  const run = spawnSync('java', ['-cp', path.join(root, 'test', 'xsd-oracle'), 'XsdOracle', '--schema', schema, oracleOut, outDir], { encoding: 'utf8' });
  const log = (run.stdout || '') + (run.stderr || '');
  const oracle = new Map(fs.readFileSync(oracleOut, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [path.basename(r.file, '.xml'), r]; }));
  const v = XV.create(JSON.parse(fs.readFileSync(modelFile, 'utf8')));
  const lines = [];
  const out = (s) => { lines.push(s); console.log(s); };
  out('XSD feature self-test (test/xsd-selftest/features.xsd) vs Xerces');
  let same = 0, diff = 0, unexpected = 0;
  for (const c of cases) {
    const o = oracle.get(c.id);
    const r = v.validate(slimdom.parseXmlDocument(c.xml));
    if (!o) { out('  no oracle result for ' + c.id); diff++; continue; }
    // verdict AND error-code multiset (Xerces message keys) must agree
    const ourCodes = r.errors.map((e) => e.code).sort().join(' ');
    const xCodes = o.errors.filter((e) => e.severity !== 'warning').map((e) => { const m = /^([A-Za-z][A-Za-z0-9.-]*?)(?=:)/.exec(e.message); return m ? m[1] : '?'; }).sort().join(' ');
    if (o.valid === r.valid && ourCodes === xCodes) same++;
    else if (o.valid === r.valid) { diff++; out('  CODE MISMATCH ' + c.id + ': xerces [' + xCodes + '] ours [' + ourCodes + ']  (' + c.note + ')'); for (const e of o.errors.slice(0, 3)) out('      xerces: ' + e.message.slice(0, 200)); }
    else { diff++; out('  MISMATCH ' + c.id + ': xerces=' + (o.valid ? 'valid' : 'invalid') + ' ours=' + (r.valid ? 'valid' : 'invalid') + '  (' + c.note + ')'); for (const e of o.errors.slice(0, 2)) out('      xerces: ' + e.message.slice(0, 200)); for (const e of r.errors.slice(0, 2)) out('      ours:   ' + e.code + ' ' + e.location + ' ' + e.message.slice(0, 200)); }
    if (o.valid !== c.expect) { unexpected++; out('  note: Xerces says ' + (o.valid ? 'valid' : 'invalid') + ' for ' + c.id + ' (' + c.note + ')' + (o.errors[0] ? ': ' + o.errors[0].message.slice(0, 160) : '')); }
  }
  out('instances ' + cases.length + '   identical verdicts+codes ' + same + '   mismatches ' + diff + '   (expectation notes: ' + unexpected + ')');
  out('oracle: ' + log.trim().split('\n').filter((l) => /files:/.test(l)).join(' '));
  if (reportFile) fs.appendFileSync(reportFile, '\n' + lines.join('\n') + '\n');
  process.exit(diff ? 1 : 0);
}
main();
