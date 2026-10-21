/*
 * xml-parse.js — the only place where the Prüfer turns a string into a DOM document in the browser: DOMParser with
 * the MIME type application/xml (an XML document without script execution; no HTML parsing anywhere).
 *
 * The page enforces Trusted Types (Content-Security-Policy "require-trusted-types-for 'script'; trusted-types
 * pruefer-xml"): every string that reaches an HTML/DOM sink must come from a policy. DOMParser.parseFromString is
 * such a sink for every MIME type (HTML Standard, DOMParser: the TrustedHTML check precedes the switch on the type),
 * so the policy "pruefer-xml" exists for exactly this call and is kept inside this closure – no other code can use it,
 * and any other sink (innerHTML, insertAdjacentHTML, document.write …) throws a TypeError. Browsers without Trusted
 * Types (Firefox before 148, Safari before 26) parse the string directly; the Prüfer itself uses no such sink either.
 *
 * API: PrueferXml.parse(text) -> Document (a parsererror element marks a document that is not well-formed)
 * Licence: EUPL-1.2
 */
(function (root) {
  'use strict';
  let policy = null;
  try {
    if (root.trustedTypes && typeof root.trustedTypes.createPolicy === 'function') policy = root.trustedTypes.createPolicy('pruefer-xml', { createHTML: (s) => s });
  } catch (e) { /* policy refused (e.g. created twice): parse without, as in browsers without Trusted Types */ }
  root.PrueferXml = Object.freeze({
    parse(text) { return new DOMParser().parseFromString(policy ? policy.createHTML(String(text)) : String(text), 'application/xml'); },
    trustedTypes: !!policy,
  });
})(typeof self !== 'undefined' ? self : this);
