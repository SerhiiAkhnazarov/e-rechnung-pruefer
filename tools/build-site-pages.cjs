#!/usr/bin/env node
/*
 * build-site-pages.cjs — the static pages of the GitHub Pages site besides the program, readable without JavaScript
 * (BSI TR-03183-3 v1.0.0, 4.5.1 b/d and 4.5.2: the page for vulnerability reports and the CVD policy must be fully
 * accessible without client-side scripts), and security.txt (RFC 9116; TR-03183-3 4.2):
 *
 *   security-contact/index.html          Schwachstelle melden          <- docs/SCHWACHSTELLE-MELDEN.md
 *   cvd-policy/index.html                Richtlinie zur koordinierten Offenlegung  <- SECURITY.md
 *   security-acknowledgements/index.html Danksagungen                  <- docs/DANKSAGUNGEN.md
 *   benutzerinformation/index.html       Informationen für Nutzer (Anhang II CRA) <- docs/BENUTZERINFORMATION.md
 *   advisories/index.html                Sicherheitshinweise           <- the CSAF documents (tools/make-csaf.cjs)
 *   impressum/index.html, datenschutz/index.html                       <- legal/impressum.json, legal/datenschutz.txt
 *   .well-known/security.txt                                           <- legal/security.json
 *   .well-known/csaf/…                   CSAF 2.0 distribution         <- security/csaf/, security/vex.json
 *
 * Every page: no script, a Content-Security-Policy that allows nothing but its own inline style (hash), links to the
 * other pages. Markdown: a strict subset (headings, paragraphs, lists, tables, emphasis, code, links) – anything else
 * is an error, so that a page never shows unrendered syntax. The same renderer produces the section "Sicherheit,
 * Unterstützung und Herstellerangaben" of the program (tools/build-standalone.cjs).
 *
 * Usage: node tools/build-site-pages.cjs <out-dir>   (reads dist/BUILD_INFO.json; tools/build-standalone.cjs: dist/site-pages)
 * Licence: EUPL-1.2
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------------------------------------
// Markdown subset
// ------------------------------------------------------------------------------------------------
/** inline markup: `code`, **bold**, *emphasis*, [text](url), <https://…>, bare https:// URLs; everything escaped */
function inline(text, opts) {
  opts = opts || {};
  const out = [];
  let rest = String(text);
  const linkTarget = (u) => {
    if (/^(https:\/\/|mailto:)/.test(u)) return u;
    if (opts.resolve) { const r = opts.resolve(u); if (r) return r; }
    throw new Error('markdown: link target not absolute (https:// or mailto:) and not resolvable: ' + u);
  };
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|\[([^\]]+)\]\(([^)\s]+)\)|<((?:https:\/\/|mailto:)[^>\s]+)>|(https:\/\/[^\s<>()]*[^\s<>().,;:!?“”"'])/g;
  let last = 0, m;
  while ((m = re.exec(rest))) {
    out.push(esc(rest.slice(last, m.index)));
    if (m[1] !== undefined) out.push('<code>' + esc(m[1]) + '</code>');
    else if (m[2] !== undefined) out.push('<strong>' + inline(m[2], opts) + '</strong>');
    else if (m[3] !== undefined) out.push('<em>' + inline(m[3], opts) + '</em>');
    else if (m[4] !== undefined) out.push('<a href="' + esc(linkTarget(m[5])) + '">' + inline(m[4], opts) + '</a>');
    else { const u = m[6] || m[7]; out.push('<a href="' + esc(u) + '">' + esc(u.replace(/^mailto:/, '')) + '</a>'); }
    last = m.index + m[0].length;
  }
  out.push(esc(rest.slice(last)));
  return out.join('');
}

/** block markup: # headings, paragraphs, - / 1. lists (two-space indentation for nesting), | tables |, --- rules */
function renderMarkdown(md, opts) {
  opts = opts || {};
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const listItem = (l) => /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      const lvl = m[1].length + (opts.headingOffset || 0);
      const id = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push('<h' + Math.min(lvl, 6) + ' id="' + id + '">' + inline(m[2], opts) + '</h' + Math.min(lvl, 6) + '>');
      i++; continue;
    }
    if (/^-{3,}\s*$/.test(l)) { html.push('<hr>'); i++; continue; }
    if (/^```/.test(l)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      if (i >= lines.length) throw new Error('markdown: unterminated code block');
      i++;
      html.push('<pre>' + esc(body.join('\n')) + '</pre>');
      continue;
    }
    if (isTableRow(l)) {
      const head = cells(l);
      if (!lines[i + 1] || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) throw new Error('markdown: table without separator line: ' + l);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      html.push('<div class="table"><table><thead><tr>' + head.map((c) => '<th>' + inline(c, opts) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c, opts) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (listItem(l)) {
      // nested lists by indentation (two spaces per level); a continuation line (indented, no marker) joins the item
      const stack = [];
      const open = (indent, ordered) => { html.push(ordered ? '<ol>' : '<ul>'); stack.push({ indent, ordered }); };
      const close = () => { const s = stack.pop(); html.push('</li>' + (s.ordered ? '</ol>' : '</ul>')); };
      let first = true;
      while (i < lines.length && lines[i].trim()) {
        const li = listItem(lines[i]);
        if (!li) {
          if (/^\s+\S/.test(lines[i]) && stack.length) { html[html.length - 1] += ' ' + inline(lines[i].trim(), opts); i++; continue; }
          break;
        }
        const indent = li[1].length, ordered = /\d/.test(li[2]);
        if (!stack.length || indent > stack[stack.length - 1].indent) open(indent, ordered);
        else {
          while (stack.length && indent < stack[stack.length - 1].indent) close();
          if (!first) html.push('</li>');
        }
        html.push('<li>' + inline(li[3], opts));
        first = false;
        i++;
      }
      while (stack.length) close();
      continue;
    }
    if (/^\s*[<>]/.test(l) && !/^\s*<https:\/\//.test(l)) throw new Error('markdown: raw HTML or quote not supported: ' + l);
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !isTableRow(lines[i]) && !listItem(lines[i]) && !/^```/.test(lines[i]) && !/^-{3,}\s*$/.test(lines[i])) para.push(lines[i++].trim());
    html.push('<p>' + inline(para.join(' '), opts) + '</p>');
  }
  return html.join('\n');
}

// ------------------------------------------------------------------------------------------------
// pages
// ------------------------------------------------------------------------------------------------
const STYLE = 'body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2430;background:#f4f6f8;margin:0}' +
  'main{max-width:860px;margin:0 auto;padding:24px 18px 48px;background:#fff;min-height:100vh}h1{font-size:26px;margin:8px 0 16px}h2{font-size:20px;margin:26px 0 8px}h3{font-size:17px;margin:20px 0 6px}' +
  'a{color:#0b5cad}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;background:#eef1f4;border-radius:4px}code{padding:1px 4px}pre{padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}' +
  'div.table{overflow-x:auto}table{border-collapse:collapse;margin:8px 0;font-size:15px}th,td{border:1px solid #d9e0e7;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eef1f4}' +
  'nav{font-size:14px;border-bottom:1px solid #d9e0e7;padding-bottom:10px;margin-bottom:10px}nav a{margin-right:12px;display:inline-block}footer{font-size:13px;color:#5d6b7a;border-top:1px solid #d9e0e7;margin-top:30px;padding-top:10px}';
const styleHash = () => "'sha256-" + crypto.createHash('sha256').update(STYLE, 'utf8').digest('base64') + "'";
const CSP = () => "default-src 'none'; style-src " + styleHash() + "; form-action 'none'; base-uri 'none'";

function pageHtml(title, bodyHtml, sec, current) {
  const nav = [['', 'E-Rechnung Prüfer'], ['security-contact/', 'Schwachstelle melden'], ['cvd-policy/', 'Richtlinie zur Offenlegung'], ['advisories/', 'Sicherheitshinweise'], ['security-acknowledgements/', 'Danksagungen'], ['benutzerinformation/', 'Informationen für Nutzer'], ['impressum/', 'Impressum'], ['datenschutz/', 'Datenschutz']];
  return '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta http-equiv="Content-Security-Policy" content="' + esc(CSP()) + '">\n<meta name="referrer" content="no-referrer">\n' +
    '<title>' + esc(title) + ' – E-Rechnung Prüfer</title>\n<style>' + STYLE + '</style>\n</head>\n<body>\n<main>\n<nav>' +
    nav.map(([p, t]) => (p === current ? '<strong>' + esc(t) + '</strong>' : '<a href="' + esc(sec.site + p) + '">' + esc(t) + '</a>')).join(' ') + '</nav>\n' +
    bodyHtml + '\n<footer>E-Rechnung Prüfer · ' + esc(sec.manufacturer) + ', ' + esc(sec.residence) + ' · <a href="mailto:' + esc(sec.contactEmail) + '">' + esc(sec.contactEmail) + '</a> · Quellcode: <a href="' + esc(sec.repository) + '">' + esc(sec.repository.replace(/^https:\/\//, '')) + '</a> · diese Seite verwendet kein JavaScript und keine Cookies</footer>\n</main>\n</body>\n</html>\n';
}

/** security.txt (RFC 9116; the comments and fields in the order of BSI TR-03183-3 4.2) */
function securityTxt(sec) {
  return [
    '# security.txt of ' + sec.product + ' (' + sec.site + ') – RFC 9116',
    '# Our canonical URI',
    ...sec.securityTxtCanonical.map((u) => 'Canonical: ' + u),
    '# Our security addresses',
    'Contact: mailto:' + sec.contactEmail,
    'Contact: ' + sec.site + 'security-contact/',
    'Contact: ' + sec.reportForm,
    '# Our security policy',
    'Policy: ' + sec.site + 'cvd-policy/',
    '# Our security advisories (OASIS CSAF 2.0)',
    'CSAF: ' + sec.site + '.well-known/csaf/provider-metadata.json',
    '# Our security acknowledgements page',
    'Acknowledgments: ' + sec.site + 'security-acknowledgements/',
    '# Our preferred languages',
    'Preferred-Languages: ' + sec.preferredLanguages,
    'Expires: ' + sec.securityTxtExpires,
    '',
  ].join('\n');
}

function impressumBody(imp) {
  const lines = [['Medieninhaber', imp.name], ['Wohnort', imp.address], ['E-Mail', imp.email], ['Telefon', imp.phone], ['UID', imp.uid], ['Unternehmensgegenstand', imp.business], ['Aufsichtsbehörde', imp.authority], ['Kammer', imp.chamber], ['Grundlegende Richtung', imp.mediaOwnerPurpose]].filter(([, v]) => v);
  return '<h1>Impressum und Offenlegung</h1>\n<p>Offenlegung nach § 25 Mediengesetz (Österreich).</p>\n<table><tbody>' +
    lines.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + (k === 'E-Mail' ? '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>' : esc(v)) + '</td></tr>').join('') + '</tbody></table>';
}
function datenschutzBody(imp) {
  const controller = [imp.name, imp.address, imp.email ? 'E-Mail: ' + imp.email : ''].filter(Boolean).join(', ');
  const [title, ...paras] = read('legal/datenschutz.txt').replace(/\r\n/g, '\n').split(/\n[ \t]*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return '<h1>' + esc(title) + '</h1>\n' + paras.map((p) => '<p>' + inline(p.split('{{Verantwortlicher}}').join(controller)) + '</p>').join('\n');
}

/** links between the documents of the repository and the pages of the site */
function resolver(sec) {
  const map = { 'SECURITY.md': 'cvd-policy/', 'docs/SCHWACHSTELLE-MELDEN.md': 'security-contact/', 'docs/DANKSAGUNGEN.md': 'security-acknowledgements/', 'docs/BENUTZERINFORMATION.md': 'benutzerinformation/', 'legal/datenschutz.txt': 'datenschutz/', 'legal/impressum.json': 'impressum/' };
  return (u) => {
    const [p, frag] = u.split('#');
    const key = p.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
    if (map[key] !== undefined) return sec.site + map[key] + (frag ? '#' + frag : '');
    if (/^[\w./-]+$/.test(key) && fs.existsSync(path.join(root, key))) return sec.repository + '/blob/main/' + key + (frag ? '#' + frag : '');
    return null;
  };
}

const SEVERITY = { NONE: 'keine', LOW: 'niedrig', MEDIUM: 'mittel', HIGH: 'hoch', CRITICAL: 'kritisch' };
/** the page "Sicherheitshinweise": every CSAF document of the distribution (tools/make-csaf.cjs) */
function advisoriesBody(sec, csaf) {
  const url = (d) => sec.site + '.well-known/csaf/white/' + d.year + '/' + d.file;
  const versions = (doc, ids) => {
    const names = {};
    (function walk(bs) { for (const b of bs || []) { if (b.product) names[b.product.product_id] = b.name; walk(b.branches); } })(doc.product_tree.branches);
    return (ids || []).map((i) => names[i] || i).join(', ') || '–';
  };
  const date = (t) => t.slice(8, 10) + '.' + t.slice(5, 7) + '.' + t.slice(0, 4);
  const sa = csaf.documents.filter((d) => d.doc.document.category === 'csaf_security_advisory');
  const vex = csaf.documents.filter((d) => d.doc.document.category === 'csaf_vex');
  const rowsSa = sa.map((d) => {
    const doc = d.doc, t = doc.document.tracking;
    return doc.vulnerabilities.map((v) => {
      const s = ((v.scores || [])[0] || {}).cvss_v3;
      return '<tr><td>' + esc(t.id) + '</td><td>' + esc(v.title || doc.document.title) + (v.cwe ? ' (' + esc(v.cwe.id) + ')' : '') + '</td><td>' + date(t.initial_release_date) + (t.current_release_date !== t.initial_release_date ? ', aktualisiert ' + date(t.current_release_date) : '') + '</td><td>' +
        (s ? esc(s.baseScore.toFixed(1) + ' (' + (SEVERITY[s.baseSeverity] || s.baseSeverity) + ', CVSS ' + s.version + ')') : '–') + '</td><td>' + esc(versions(doc, v.product_status.known_affected)) + '</td><td>' + esc(versions(doc, v.product_status.fixed)) + '</td><td><a href="' + esc(url(d)) + '">CSAF</a></td></tr>';
    }).join('');
  }).join('');
  const rowsVex = vex.map((d) => {
    const doc = d.doc, t = doc.document.tracking;
    const states = { known_not_affected: 'nicht betroffen', known_affected: 'betroffen', fixed: 'behoben', under_investigation: 'in Prüfung' };
    return doc.vulnerabilities.map((v) => '<tr><td>' + esc(v.cve) + '</td><td>' + esc(Object.keys(v.product_status).map((k) => states[k] || k).join(', ')) + '</td><td>' + esc(versions(doc, Object.values(v.product_status)[0])) + '</td><td>' + date(t.current_release_date) + '</td><td><a href="' + esc(url(d)) + '">CSAF</a> · <a href="' + esc(sec.site + 'vex.cdx.json') + '">CycloneDX</a></td></tr>').join('');
  }).join('');
  return '<h1>Sicherheitshinweise</h1>\n<p>Behobene Schwachstellen des E-Rechnung Prüfers und die Bewertung bekannter Schwachstellen seiner Komponenten. Maschinenlesbar im Common Security Advisory Framework (CSAF 2.0, OASIS), wie von BSI und CERT.at empfohlen: <a href="' + esc(csaf.metadata.canonical_url) + '">provider-metadata.json</a>, Verzeichnis <a href="' + esc(csaf.metadata.distributions[0].directory_url) + '">' + esc(csaf.metadata.distributions[0].directory_url) + '</a>. Dieselben Hinweise erscheinen als GitHub Security Advisories: <a href="' + esc(sec.advisories) + '">' + esc(sec.advisories.replace(/^https:\/\//, '')) + '</a>.</p>\n' +
    '<h2>Behobene Schwachstellen</h2>\n' + (rowsSa ? '<div class="table"><table><thead><tr><th>Kennung</th><th>Schwachstelle</th><th>Veröffentlicht</th><th>Schweregrad</th><th>Betroffene Versionen</th><th>Behoben in</th><th>Dokument</th></tr></thead><tbody>' + rowsSa + '</tbody></table></div>' : '<p>Keine.</p>') + '\n' +
    '<p>Aktualisieren: Die Web-Fassung erhält Korrekturen durch Neuladen der Seite; eine gespeicherte Datei ersetzen Sie durch die neueste Datei (<a href="' + esc(sec.releases) + '">Releases</a>). Die Version steht in der Fußzeile des Prüfers.</p>\n' +
    '<h2>Bewertung von Schwachstellen der Komponenten (VEX)</h2>\n<p>Schwachstellen von Komponenten, aus denen der Prüfer abgeleitet ist, mit der Begründung, warum der Prüfer betroffen ist oder nicht (Einzelheiten im Dokument).</p>\n' +
    (rowsVex ? '<div class="table"><table><thead><tr><th>Schwachstelle</th><th>Status</th><th>Version</th><th>Stand</th><th>Dokument</th></tr></thead><tbody>' + rowsVex + '</tbody></table></div>' : '<p>Keine.</p>') + '\n' +
    '<h2>Neue Schwachstelle melden</h2>\n<p>Bitte vertraulich: <a href="' + esc(sec.site + 'security-contact/') + '">Schwachstelle melden</a> (Richtlinie: <a href="' + esc(sec.site + 'cvd-policy/') + '">koordinierte Offenlegung</a>).</p>';
}

function buildPages(outDir, info) {
  const sec = JSON.parse(read('legal/security.json'));
  const imp = JSON.parse(read('legal/impressum.json'));
  const opts = { resolve: resolver(sec) };
  const md = (f) => renderMarkdown(read(f), opts);
  // CSAF documents and their distribution below .well-known/csaf (tools/make-csaf.cjs)
  const csaf = require('./make-csaf.cjs').buildCsaf(outDir, info || JSON.parse(read('dist/BUILD_INFO.json')));
  const pages = {
    'advisories/index.html': ['Sicherheitshinweise', advisoriesBody(sec, csaf), 'advisories/'],
    'security-contact/index.html': ['Schwachstelle melden', md('docs/SCHWACHSTELLE-MELDEN.md'), 'security-contact/'],
    'cvd-policy/index.html': ['Richtlinie zur koordinierten Offenlegung', md('SECURITY.md'), 'cvd-policy/'],
    'security-acknowledgements/index.html': ['Danksagungen', md('docs/DANKSAGUNGEN.md'), 'security-acknowledgements/'],
    'benutzerinformation/index.html': ['Informationen für Nutzer', md('docs/BENUTZERINFORMATION.md'), 'benutzerinformation/'],
    'impressum/index.html': ['Impressum', impressumBody(imp), 'impressum/'],
    'datenschutz/index.html': ['Datenschutz', datenschutzBody(imp), 'datenschutz/'],
  };
  const written = {};
  for (const [file, [title, body, current]] of Object.entries(pages)) {
    const html = pageHtml(title, body, sec, current);
    const f = path.join(outDir, file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, html);
    written[file] = crypto.createHash('sha256').update(html).digest('hex');
  }
  const txt = securityTxt(sec);
  fs.mkdirSync(path.join(outDir, '.well-known'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '.well-known', 'security.txt'), txt);
  written['.well-known/security.txt'] = crypto.createHash('sha256').update(txt).digest('hex');
  return Object.assign(written, csaf.written);
}

module.exports = { renderMarkdown, inline, buildPages, securityTxt, pageHtml, resolver, advisoriesBody, STYLE, CSP };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/build-site-pages.cjs <out-dir>'); process.exit(2); }
  const w = buildPages(path.resolve(out));
  for (const [f, h] of Object.entries(w)) console.log(f + ' sha256:' + h);
}
