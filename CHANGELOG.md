# Changelog

## 0.2.0 (2026-10-20)

Prüfumfang
- XML-Schema-Prüfung (XSD 1.0) vor den Schematron-Regeln wie im KoSIT-Validator: UBL 2.1 Invoice/CreditNote,
  CII D16B, die fünf Factur-X-/ZUGFeRD-Profilschemata; Urteile und Fehlercodes identisch mit JDK-21-Xerces.
- Zeichenkodierung nach XML 1.0 §4.3.3 / Anhang F (BOM, Deklaration, unzulässige Bytefolgen; UTF-16 ohne
  BOM, Widersprüche und unbekannte Kodierungen sind schwerwiegende Fehler).
- Factur-X 1.09.2 / ZUGFeRD 2.5.2 (MINIMUM bis EXTENDED) mit eigenen Schematron-Regeln und Schemata;
  PDF/A-3-Container-Prüfungen für hybride Rechnungen (`docs/PDFA3-CHECKS.md`).
- Peppol BIS Billing 3.0: offizielle Regeldateien lassen sich im Programm laden (nicht mitgeliefert,
  keine Weitergabelizenz); Kompilierung im Browser inhaltsgleich mit dem Node-Build, SHA-256-Abgleich mit
  der geprüften Fassung 3.0.21.
- Dokumente ohne KoSIT-Szenario werden nach dem passenden Regelwerk aus `build/rulesets.json` geprüft und
  als „nicht anwendbar“ bzw. nach ihrem eigenen Regelwerk bewertet – nie als XRechnung angenommen.
- Ein Prüfablauf für Browser und Kommandozeile (`src/pruefer-core.js`).

Engine
- Exakte `xs:decimal`-Arithmetik wie Saxon (BigInt, `DIVIDE_PRECISION` 18, HALF_DOWN): die vier bisher
  dokumentierten Abweichungen der XML-Mutate-Tests entfallen (1 754 / 1 754).
- Dokumentindex und Pfad-Umschreibungen für große Rechnungen (Laufzeiten: README, Abschnitt „Nachweise“).
- Unicode-Tabellen aus UCD 15.0.0 (vorher versehentlich Kategorien aus 15.1.0), `\p{Cn}` für nicht
  zugewiesene Zeichen (`patches/xspattern-pruefer.patch`).
- Schematron-Compiler deterministisch auch bei mehreren Übersetzungen in einer Seite.

Nachweise
- Vergleich mit dem **offiziellen KoSIT-Validator 1.6.3** (Release-JAR) und dem Release-ZIP der Konfiguration
  v2026-08-31 über 4 158 Dokumente: 0 Abweichungen (Szenario und Annahme 4 158, XSD-Urteil 1 891,
  XSD-Fehlercodes 89, Meldungen 1 802, Bewertung 1 891 Dokumente); zusätzlich KoSIT-Nachbau
  `test/kosit-reference/`.
- `tools/verify-all.cjs`: Referenzen (Saxon, Xerces) bei jedem Lauf neu erzeugt, Reproduzierbarkeit von
  Engine, Regelwerken, XSD-Modellen und Szenarien, Fingerprint je Bericht, Freigabe mit
  `verify-manifest.cjs --reports --strict`.
- `tools/fetch-sources.cjs`: alle Quellen aus dem Manifest, Downloads SHA-256-geprüft; portable Manifest-Pfade.
- Browser-Testreihen (XSD im Browser, Ende-zu-Ende, Peppol-Import, Laufzeit): lokal in Chromium und WebKit,
  im CI zusätzlich in Firefox; Browser-Builds von Playwright 1.56.0 (im CI per `npx playwright install` vom
  offiziellen Playwright-CDN, lokal vorinstallierte Builds derselben Revisionen 1194 / 2215).
- Testreihe `page-build`: jeder Lauf baut die Seite aus den aktuellen Quellen. `pages.yml` veröffentlicht nur
  die Seite eines bestandenen `verify`-Laufs desselben Commits und prüft deren Statuszeile
  („N von N Testreihen bestanden, 0 fehlgeschlagen – GitHub Actions …“).
- Kennzeichen „mit Änderungen“ im Fingerprint nur noch bei geänderten Eingabedateien (nicht bei Berichten
  oder `dist/`).
- CI in Chromium, WebKit und Firefox; KoSIT-JAR gegen Maven Central; veraPDF 1.30.3; wöchentliche
  Versionskontrolle (`tools/check-drift.cjs`, geprüfte Ausnahmen in `build/drift-acknowledged.json`).
  Jeder Job veröffentlicht sein Ergebnis als Check-Run des Commits (über die REST-API lesbar).
- Versionskontrolle wirksam für alle Quellen: das Manifest trägt `git describe --tags` aus vollständigen
  Klonen (vorher bei 9 Quellen nur ein Commit-Kürzel, gegen das kein Tag als neuer erkannt wurde).
  Geprüft und begründet: Peppol `v3.0.20` (Release November 2025, älter als das verwendete 3.0.21),
  KoSIT-Validator `v2.0.0-alpha1`, `-tp1`, `-tp2` (Vorabversionen der 2.x-Linie).
- Quellstand des KoSIT-Validators auf den Release-Tag `v1.6.3` gepinnt (= Quellstand des verglichenen
  Release-JAR; vorher der danach gemergte `main`-Stand `6ac5167f`, `src/` identisch).
- Berichte ohne Rechnerangaben (Pfade als `<ext>`, `.`, `<tmp>`; JVM-Optionen des Rechners werden nicht an
  die Testreihen weitergegeben); keine Abhängigkeit mehr von Pfaden der Entwicklungsumgebung.
- XPath-Batterien ohne doppelte Ausdrücke (378 und 267).
- Windows: CI-Job `windows` (Windows Server 2025) – die vier Browser-Testreihen in Microsoft Edge und Google
  Chrome des Runner-Images (Playwright-Kanäle `msedge`, `chrome`), mit Korpus, Xerces-Referenz und Seite unter
  Windows gebaut; Job `platforms` vergleicht Eingaben (`filesId`) und Programm (`programSha256`) mit dem
  Linux-Lauf; Check-Runs „Windows report“ und „platform comparison“.
- Plattformunabhängig: Fingerprint-Schlüssel mit `/` auf jedem System; Reihenfolge von Korpus und
  Xerces-Referenz unabhängig von Dateisystem und Groß-/Kleinschreibung (unter Linux byte-gleich mit vorher,
  7 778 Dateien); `file:`-URLs über `pathToFileURL`; Zip-Archive unter Windows mit dem `tar.exe` des Systems;
  Pfade in Shell-Befehlen gequotet; Zeitzone der Browser = `TZ` der Testreihen.
- `programSha256` in `BUILD_INFO.json` (SHA-256 der Seite ohne den Build-Vermerk): `pages.yml` veröffentlicht nur
  das getestete Programm und liest die veröffentlichten Dateien danach über HTTPS zurück
  (`tools/check-published.cjs`); `release.yml` (von Hand gestartet) veröffentlicht genau diese Dateien als
  Release, wenn alle Check-Runs des Commits bestanden sind.
- Seite (`dist/`) und Berichte (`build/reports/`) nicht mehr im Repository: die dort liegende Seite war ein
  älterer Build (ohne die Lizenzhinweise der Folgecommits, Statuszeile eines früheren lokalen Laufs); jede Kopie
  entsteht jetzt aus den Quellen im CI. Check-Runs enthalten `VERIFICATION.json` vollständig.

Recht
- `NOTICE` mit dem vollständigen Wortlaut aller erforderlichen Lizenztexte und NOTICE-Dateien (MIT: fontoxpath,
  xspattern, whynot, prsc, slimdom, esbuild; Unicode License V3; Apache License 2.0; NOTICE von Apache Xerces,
  KoSIT-Validator und -Konfiguration, Mustangproject; Erklärung von KoSIT zu CEN/DIN), mit den Änderungen je
  Bestandteil; im Programm wörtlich enthalten.
- Teile von `src/xsd-validator.js` sind als Übertragung von Apache Xerces-J (Apache-2.0) gekennzeichnet, mit
  den Hinweisen der Originaldateien; Lizenzkopf in jedem Engine-Bundle (`vendor/`).
- Kompilierte Regelwerke tragen die Hinweise ihrer Quelldateien (`notices`) und einen Änderungsvermerk
  (`generator`).
- Fußzeile des Programms: Erklärung nach DIN/CEN (sichtbar) und Link zum Quellcode (EUPL-1.2 Art. 5).
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
