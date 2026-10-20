/*
 * resolve-tool.cjs — locates the test-only npm packages (Playwright, pdf.js) without hard-coded paths:
 * 1. the directory in the environment variable (PLAYWRIGHT_MODULE / PDFJS_MODULE),
 * 2. node_modules of the project (npm install --no-save playwright@1.56.0 pdfjs-dist@6.2.108 esbuild@0.28.2,
 *    as in .github/workflows/verify.yml).
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function locate(name, envVar) {
  const c = [process.env[envVar], path.join(root, 'node_modules', name)].filter(Boolean);
  for (const d of c) if (fs.existsSync(path.join(d, 'package.json'))) return d;
  throw new Error(name + ' not found (tried ' + c.join(', ') + '); install it with npm or set ' + envVar);
}
module.exports = {
  playwright: () => require(locate('playwright', 'PLAYWRIGHT_MODULE')),
  pdfjsUrl: () => 'file://' + path.join(locate('pdfjs-dist', 'PDFJS_MODULE'), 'legacy', 'build', 'pdf.mjs'),
  /** true when Playwright has a browser binary for this engine (no download is attempted) */
  hasBrowser: (engineName) => { try { const e = module.exports.playwright()[engineName]; return fs.existsSync(e.executablePath()); } catch (e) { return false; } },
};
