# Changelog

## 0.2.0 (2026-10-19)

Prüfumfang
- XML-Schema-Prüfung (XSD 1.0) vor den Schematron-Regeln wie im KoSIT-Validator: UBL 2.1 Invoice/CreditNote,
  CII D16B, die fünf Factur-X-/ZUGFeRD-Profilschemata; Urteile und Fehlercodes identisch mit JDK-21-Xerces.
- Zeichenkodierung nach XML 1.0 §4.3.3 / Anhang F (BOM, Deklaration, unzulässige Bytefolgen; UTF-16 ohne
  BOM, Widersprüche und unbekannte Kodierungen sind schwerwiegende Fehler).
- Factur-X 1.09.2 / ZUGFeRD 2.5.2 (MINIMUM bis EXTENDED) mit eigenen Schematron-Regeln und Schemata;
  PDF/A-3-Container-Prüfungen für hybride Rechnungen (`docs/PDFA3-CHECKS.md`).
- Peppol BIS Billing 3.0: offizielle Regeldateien lassen sich im Programm laden (nicht mitgeliefert,
  keine Weitergabelizenz); Kompilierung im Browser byte-gleich mit dem Node-Build, SHA-256-Abgleich mit der
  geprüften Fassung 3.0.21.
- Dokumente ohne KoSIT-Szenario werden nach dem passenden Regelwerk aus `build/rulesets.json` geprüft und
  als „nicht anwendbar“ bzw. nach ihrem eigenen Regelwerk bewertet – nie als XRechnung angenommen.
- Ein Prüfablauf für Browser und Kommandozeile (`src/pruefer-core.js`).

Engine
- Exakte `xs:decimal`-Arithmetik wie Saxon (BigInt, `DIVIDE_PRECISION` 18, HALF_DOWN): die vier bisher
  dokumentierten Abweichungen der XML-Mutate-Tests entfallen (1 754 / 1 754).
- Dokumentindex und Pfad-Umschreibungen für große Rechnungen (2 000 Positionen 3,0–5,2 s in Chromium, 3,9–5,0 s in WebKit).
- Unicode-Tabellen aus UCD 15.0.0 (vorher versehentlich Kategorien aus 15.1.0), `\p{Cn}` für nicht
  zugewiesene Zeichen (`patches/xspattern-pruefer.patch`).
- Schematron-Compiler deterministisch auch bei mehreren Übersetzungen in einer Seite.

Nachweise
- Vergleich mit dem **offiziellen KoSIT-Validator 1.6.3** (Release-JAR) und dem Release-ZIP der Konfiguration
  v2026-08-31 über 4 158 Dokumente: 0 Abweichungen (Szenario, XSD-Urteil und -Fehlercodes, Meldungen,
  Bewertung); zusätzlich KoSIT-Nachbau `test/kosit-reference/`.
- `tools/verify-all.cjs`: Referenzen (Saxon, Xerces) bei jedem Lauf neu erzeugt, Reproduzierbarkeit von
  Engine, Regelwerken, XSD-Modellen und Szenarien, Fingerprint je Bericht, Freigabe mit
  `verify-manifest.cjs --reports --strict`.
- `tools/fetch-sources.cjs`: alle Quellen aus dem Manifest, Downloads SHA-256-geprüft; portable Manifest-Pfade.
- Browser-Testreihen (XSD im Browser, Ende-zu-Ende, Peppol-Import, Laufzeit) in Chromium, WebKit und Firefox;
  Browser-Builds von Playwright 1.56.0 vom offiziellen Playwright-CDN (`npx playwright install`).
- CI in Chromium, WebKit und Firefox; KoSIT-JAR gegen Maven Central; veraPDF 1.30.3; wöchentliche
  Versionskontrolle (`tools/check-drift.cjs`, geprüfte Ausnahmen in `build/drift-acknowledged.json`).

Recht
- Lizenzhinweise OASIS, UN/CEFACT, FeRD/FNFE (Apache 2.0 + Hinweis nach DIN/CEN) im Programm und in `legal/`;
  Impressum-Daten in `legal/impressum.json` (vom Anbieter auszufüllen).

## 0.1.0 (2026-10-19)

Erste Version.
- Prüfung gegen CEN EN16931 Schematron 1.3.16 (UBL/CII) und KoSIT XRechnung Schematron 2.6.0 (XRechnung 3.0.2) inkl. Peppol-Regeln
  der KoSIT-Whitelist, Szenarien und Fehlerstufen der KoSIT-Validator-Konfiguration 2026-08-31.
- Extraktion eingebetteter Rechnungs-XML aus PDF (ZUGFeRD/Factur-X), XMP-Auswertung.
- Rechnungsdaten-Ansicht, CSV/JSON-Export, Zeilenangaben, SHA-256.
- Nachweise: CEN 1140/1140, KoSIT 1750/1754 (+4 dokumentiert), Saxon-Referenz 5902 Vergleiche ohne weitere Abweichung, pdf.js 151/151.
- Nicht enthalten: XSD-Prüfung, PDF/A-3-Prüfung.
