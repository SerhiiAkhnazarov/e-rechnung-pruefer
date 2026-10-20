#!/usr/bin/env node
/* run-saxon.cjs — evaluates expressions.txt with Saxon HE (XSLT 3.0 xsl:evaluate) and writes expected.json.
 * Usage: node run-saxon.cjs <saxon-dir> */
'use strict';
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const saxonDir = process.argv[2] || process.env.SAXON_DIR || require('path').join(__dirname, '..', '..', 'build', 'ext', 'saxon');
const lines = fs.readFileSync(path.join(__dirname, 'expressions.txt'), 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l && !l.startsWith('#'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// each expression is evaluated separately with xsl:try so that errors are reported, not fatal
let xsl = `<?xml version="1.0"?>\n<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0" exclude-result-prefixes="xs">\n<xsl:output method="text" encoding="UTF-8"/>\n<xsl:template name="xsl:initial-template">\n`;
lines.forEach((e, i) => {
  xsl += `<xsl:text>${i}\t</xsl:text><xsl:try><xsl:value-of select="string-join(for $v in (${esc(e)}) return string($v), ' ')"/><xsl:catch><xsl:text>ERROR </xsl:text><xsl:value-of select="$err:code"/></xsl:catch></xsl:try><xsl:text>&#10;</xsl:text>\n`;
});
xsl += `</xsl:template>\n</xsl:stylesheet>\n`;
xsl = xsl.replace('xmlns:xs="http://www.w3.org/2001/XMLSchema"', 'xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:err="http://www.w3.org/2005/xqt-errors"');
const xslPath = path.join(__dirname, 'battery.xsl');
fs.writeFileSync(xslPath, xsl);
const out = execFileSync('java', ['-cp', `${saxonDir}/saxon-he-12.8.jar:${saxonDir}/lib/*`, 'net.sf.saxon.Transform', '-it', `-xsl:${xslPath}`], { encoding: 'utf8', maxBuffer: 1 << 26, env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
const expected = {};
for (const l of out.split('\n')) { const m = /^(\d+)\t(.*)$/.exec(l); if (m) expected[lines[parseInt(m[1], 10)]] = m[2]; }
fs.writeFileSync(path.join(__dirname, 'expected.json'), JSON.stringify({ engine: 'Saxon HE 12.8', expressions: lines, expected }, null, 1));
console.log(`${Object.keys(expected).length} expressions evaluated by Saxon -> expected.json`);
