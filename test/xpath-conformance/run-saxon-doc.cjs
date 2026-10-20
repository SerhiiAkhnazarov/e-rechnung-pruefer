#!/usr/bin/env node
/* run-saxon-doc.cjs — evaluates expressions-doc.txt with Saxon HE against doc.xml (context item = document node)
 * and writes expected-doc.json. Nodes are rendered with fn:path(), atomic values with string().
 * Usage: node run-saxon-doc.cjs <saxon-dir> */
'use strict';
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const saxonDir = process.argv[2] || process.env.SAXON_DIR || require('path').join(process.env.EXT_DIR || require('path').join(__dirname, '..', '..', 'ext'), 'saxon');
const lines = fs.readFileSync(path.join(__dirname, 'expressions-doc.txt'), 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l && !l.startsWith('#'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let xsl = `<?xml version="1.0"?>\n<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:err="http://www.w3.org/2005/xqt-errors" xmlns:inv="urn:test:inv" xmlns:cac="urn:test:cac" xmlns:cbc="urn:test:cbc" xmlns:x="urn:test:x" xmlns:cn="urn:test:cn" version="3.0" exclude-result-prefixes="#all">\n<xsl:output method="text" encoding="UTF-8"/>\n<xsl:template match="/">\n`;
lines.forEach((e, i) => {
  xsl += `<xsl:text>${i}\t</xsl:text><xsl:try><xsl:value-of select="string-join(for $v in (${esc(e)}) return (if ($v instance of node()) then path($v) else string($v)), ' ')"/><xsl:catch><xsl:text>ERROR </xsl:text><xsl:value-of select="$err:code"/></xsl:catch></xsl:try><xsl:text>&#10;</xsl:text>\n`;
});
xsl += `</xsl:template>\n</xsl:stylesheet>\n`;
const xslPath = path.join(__dirname, 'battery-doc.xsl');
fs.writeFileSync(xslPath, xsl);
const out = execFileSync('java', ['-cp', `${saxonDir}/saxon-he-12.8.jar:${saxonDir}/lib/*`, 'net.sf.saxon.Transform', `-s:${path.join(__dirname, 'doc.xml')}`, `-xsl:${xslPath}`], { encoding: 'utf8', maxBuffer: 1 << 26, env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '', TZ: 'UTC' }) }); // implicit timezone UTC (as run-fontoxpath*.cjs)
const expected = {};
for (const l of out.split('\n')) { const m = /^(\d+)\t(.*)$/.exec(l); if (m) expected[lines[parseInt(m[1], 10)]] = m[2]; }
fs.writeFileSync(path.join(__dirname, 'expected-doc.json'), JSON.stringify({ engine: 'Saxon HE 12.8', document: 'doc.xml', expressions: lines, expected }, null, 1));
console.log(`${Object.keys(expected).length} expressions evaluated by Saxon -> expected-doc.json`);
