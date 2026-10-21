/*
 * resolve-tool.cjs — locates the test-only npm packages (Playwright, pdf.js) without hard-coded paths:
 * 1. the directory in the environment variable (PLAYWRIGHT_MODULE / PDFJS_MODULE),
 * 2. node_modules of the project (npm ci --ignore-scripts: package.json / package-lock.json, as in
 *    .github/workflows/verify.yml).
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
function locate(name, envVar) {
  const c = [process.env[envVar], path.join(root, 'node_modules', name)].filter(Boolean);
  for (const d of c) if (fs.existsSync(path.join(d, 'package.json'))) return d;
  throw new Error(name + ' not found (tried ' + c.join(', ') + '); install it with npm or set ' + envVar);
}
const channels = {};
module.exports = {
  playwright: () => require(locate('playwright', 'PLAYWRIGHT_MODULE')),
  // file: URLs from paths with url.pathToFileURL (file:///C:/... on Windows, percent-encoding of special characters)
  pdfjsUrl: () => pathToFileURL(path.join(locate('pdfjs-dist', 'PDFJS_MODULE'), 'legacy', 'build', 'pdf.mjs')).href,
  fileUrl: (file) => pathToFileURL(path.resolve(file)).href,
  /**
   * true when the browser can be used without a download: for an engine, Playwright's own build of it is
   * installed; for a channel (msedge, chrome: the Microsoft Edge / Google Chrome installation of the machine),
   * Playwright can launch it (checked once per process by launching it in a child process)
   */
  hasBrowser: (engineName, channel) => {
    if (!channel) { try { const e = module.exports.playwright()[engineName]; return fs.existsSync(e.executablePath()); } catch (e) { return false; } }
    if (!(channel in channels)) {
      let pw;
      try { pw = locate('playwright', 'PLAYWRIGHT_MODULE'); } catch (e) { return (channels[channel] = false); }
      const probe = 'require(' + JSON.stringify(pw) + ').' + engineName + '.launch({ channel: ' + JSON.stringify(channel) + ' })' +
        '.then(async (b) => { await b.close(); }).then(() => process.exit(0), () => process.exit(1));';
      channels[channel] = spawnSync(process.execPath, ['-e', probe], { stdio: 'ignore', timeout: 120000 }).status === 0;
    }
    return channels[channel];
  },
};
