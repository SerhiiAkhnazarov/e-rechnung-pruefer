# Changelog

## 0.3.1 (2026-10-21)

Umsatzsteuerliche Einordnung – Abgleich mit dem Original des BMF-Schreibens vom 15.10.2026
- Das Original (GZ III C 5 - S 7287-a/00019/021/017, DOK COO.7005.100.3.15923106, 10 Seiten) ist vollständig gelesen;
  0.3.0 stützte sich auf Fachveröffentlichungen. Entfernt: die Aussagen „Validierung keine rechtliche Voraussetzung,
  kein staatliches Validierungswerkzeug, keine Empfehlung bestimmter Anwendungen“ – sie stehen weder in diesem noch
  im Schreiben vom 15.10.2025. Der Hinweis zum Validierungsbericht gibt jetzt Rn. 35a des Schreibens vom 15.10.2025
  wieder (gelesen in einer Kopie mit Kopfzeile, GZ und DOK).
- Mit Randnummern belegt: Geschäftsregelfehler nur mit Bezug zu einer Pflichtangabe ein Inhaltsfehler, die Datei
  bleibt umsatzsteuerlich prinzipiell eine E-Rechnung (Rn. 22, 23); Endrechnung mit BT-113 und BT-22 oder
  eingebettetem Anhang bis 30.06.2030 (Rn. 3, 4); Empfehlung der Zuordnungstabelle von KoSIT und FeRD (Rn. 8, 9,
  Fundstellen in `legal/ust-pflichtangaben.json`); allgemeiner Hinweis auf Entgeltminderungen (Rn. 15, 16);
  Berichtigung (Rn. 20, 21); Leistungsbeschreibung (Rn. 10–12, nicht geprüft – Hinweis in der Übersicht).
- Neu: Folge für den Vorsteuerabzug nach Abschn. 15.11 Abs. 3 Satz 2 UStAE n. F. im Urteil „Pflichtangabe fehlt“;
  Hinweis zu Anlagen (BG-24: Pflichtangaben im strukturierten Teil, Anlagen bei Endrechnung, Bauleistung,
  Bruttopreisrechnung – BMF-Schreiben vom 15.10.2025, Rn. 35; vom 15.10.2026, Rn. 4, 14, 19); bei einer möglichen
  Endrechnung zeigt die Übersicht, ob eine Bemerkung (BT-22) und eingebettete Anlagen vorhanden sind; Berichtigung durch
  Gutschrift des Leistungsempfängers (Abschn. 14.11 Abs. 2 Satz 7 UStAE n. F.).
- § 14 Abs. 4 Satz 1 Nr. 6a UStG: erstmals für Rechnungen, die nach dem 31.12.2027 ausgestellt werden (§ 27 Abs. 41
  UStG n. F.; übereinstimmend EY, Ebner Stolz, FGS, NWB) – unverändert umgesetzt, Quellenlage in
  `docs/UST-EINORDNUNG.md`.
- Tests: jedes im Programm zitierte BMF-Schreiben ist eine Quelle der Tabelle; jede zitierte Randnummer des
  Schreibens vom 15.10.2026 existiert (1–28); neue Fälle für Anlagen, Endrechnung und Berichtigung.

## 0.3.0 (2026-10-20)

Umsatzsteuerliche Einordnung (Deutschland) – `docs/UST-EINORDNUNG.md`
- Jeder Befund wird eingeordnet: Formatfehler (keine E-Rechnung, BMF-Schreiben vom 15.10.2025, Rn. 6a),
  PDF-Container, Geschäftsregelfehler mit Bezug zu einer Rechnungspflichtangabe (§ 14 Abs. 4 Satz 1 Nr. 1–10 und
  ab 1.1.2028 Nr. 6a, § 14 Abs. 5 Satz 2, § 14a, § 22c UStG, § 31 Abs. 5 UStDV) oder ohne diesen Bezug
  (umsatzsteuerlich unbeachtlich, Rn. 35a; BMF-Schreiben vom 15.10.2026), „prüfen“, wo die betroffene Angabe nicht
  feststellbar ist – nie „unbeachtlich“ im Zweifel. Zuordnung der Pflichtangaben zu den Geschäftsbegriffen nach den
  Empfehlungen von KoSIT und FeRD, auf die das BMF-Schreiben vom 15.10.2026 verweist; Syntaxbindung aus der
  KoSIT-Visualisierung (`build/bt-paths.json`, reproduzierbar). Daten: `legal/ust-pflichtangaben.json`.
- Gesamturteil je Rechnung statt pauschaler Empfehlung zur Zurückweisung: keine E-Rechnung, nicht einordenbar,
  Formatfehler, Profil (MINIMUM, BASIC WL, ZUGFeRD 1.0), Pflichtangaben betroffen, Pflichtangabe fehlt, Fehler ohne
  USt-Bedeutung, keine Fehler, unvollständig – mit Übergangsregelung (§ 27 Abs. 38 UStG), Ausnahmen von der
  E-Rechnungspflicht, Kleinbetragsrechnung (§ 33 UStDV), Kleinunternehmer (§ 34a UStDV), Steuerschuldnerschaft
  des Leistungsempfängers (§ 15 Abs. 1 Satz 1 Nr. 4 UStG), hybride Rechnungen (BMF-Schreiben vom 15.10.2024,
  Rz. 31, 32), Folgen nach § 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG und Rückwirkung der Berichtigung (Rz. 49).
- Übersicht „Pflichtangaben“: ob jede Pflichtangabe im strukturierten Teil vorhanden ist (vorhanden, fehlt,
  prüfen, entfällt, nicht zutreffend), mit Gutschrift-Codes, Endrechnung (BT-113), § 14a Abs. 1, 3, 4, 6, 7,
  Fiskalvertretung im Inland, Steuer in Euro (Art. 230 MwStSystRL) und den beiden BFH-Urteilen zum
  Leistungszeitpunkt.
- Unabhängige rechtliche Durchsicht vom 20.10.2026 eingearbeitet (u. a. BMF-Schreiben vom 15.10.2026, Endrechnung,
  Kleinbetrag nur bis zu einem Gesamtbetrag von 250 Euro auch bei Korrekturen, BT-7/BT-8 kein Leistungszeitpunkt,
  § 22c nur bei Fiskalvertretung im Inland, Kategorie O, alle Gutschrift- und Berichtigungs-Codes, Texte ohne
  Überzeichnung). Der Wortlaut des BMF-Schreibens vom 15.10.2026 war nicht abrufbar; sein Inhalt stammt aus
  Fachveröffentlichungen vom 16.10.2026 und ist am Original zu prüfen.

Dateien
- Je Rechnung: Prüfprotokoll (PDF) zum Aufbewahren mit der Rechnung (Datei, SHA-256, Prüfweg, Regelstand,
  Befunde mit Einordnung, Pflichtangaben, Zeitpunkt), Lesefassung (PDF; maßgeblich bleibt die XML), die XML einer
  ZUGFeRD-/Factur-X-PDF, die eingebetteten Dateien der PDF und die Anlagen (BG-24) zum Herunterladen.
- Für alle Dateien: Prüfbericht (CSV) mit USt-Einordnung, Rechnungsdaten (CSV, eine Zeile je Rechnung, Umsatzsteuer
  je Kategorie und Satz), Positionen (CSV), JSON mit Datenmodell und Einordnung; CSV mit Byte-Order-Mark, `;`,
  Dezimalkomma und TT.MM.JJJJ für deutsche Tabellenkalkulationen.
- Eigener PDF-Schreiber (`src/pdf-writer.js`, PDF 1.4, Standardschriften, Zeichenbreiten aus den Adobe-AFM-Dateien,
  `src/pdf-fonts.js`, reproduzierbar; NOTICE A.12, E.14); gleiche Bytes in jedem Browser und in Node.

Rechnungsdaten
- Datenmodell neu (`src/invoice-model.js`): Syntaxbindung wie die KoSIT-Visualisierung, alle Geschäftsbegriffe
  der Kopf-, Parteien-, Liefer-, Zahlungs-, Steuer- und Positionsdaten mit Nachlässen, Zuschlägen, Merkmalen und
  Anlagen; Datumswerte nach ihrem Format; Beträge ohne Rundung.
- Zeilennummern der Befunde im gemeinsamen Prüfablauf (Browser und Kommandozeile gleich; Zeilenenden nach
  XML 1.0 §2.11).

Nachweise (neue Testreihen)
- `invoice-model-vs-kosit`: Werte des Datenmodells gegen die offizielle KoSIT-Visualisierung (Saxon HE 12.8),
  4 157 Dokumente, 164 Geschäftsbegriffe, 184 676 Vergleiche, 0 Abweichungen auf den 2 072 schemagültigen
  Dokumenten (auf schemaungültigen ist das KoSIT-Ergebnis nicht definiert).
- `vat-relevance`: Rechtstabelle (jeder Geschäftsbegriff in der Syntaxbindung, jede Regel im Regelwerk),
  Einordnung mit von Hand begründeten Erwartungen, Übersicht und Urteil an konstruierten Rechnungen für jeden
  Status, Korpus mit Konsistenz von Urteil, Befunden und Übersicht.
- `reports`: CSV mit einem strengen Leser zurückgelesen und gegen die Daten verglichen; jede PDF mit
  `qpdf --check`, Text über poppler (`pdftotext`, `pdfinfo`) und Mozilla pdf.js; Anlagen gegen den
  Base64-Decoder von Node.
- `line-numbers-vs-expat`: Zeilennummern gegen libexpat über den ganzen Korpus und Grenzfälle.
- `sha256-vs-node-crypto`: `src/sha256.js` gegen OpenSSL.
- `reports-browser-*` (Chromium, WebKit, Firefox; Windows: Edge, Chrome): jede Datei der Seite byte-gleich mit
  Node, SHA-256 der Seite gleich OpenSSL, Anzeige von Urteil, Übersicht und Filter.
- `ref-kosit-visualization` (Referenzstufe); `build-reproducible` erzeugt `build/bt-paths.json` und
  `src/pdf-fonts.js` neu (byte-gleich).

Recht
- `LICENSE`: kanonischer Text der EUPL-1.2 (wie choosealicense.com/SPDX, ohne vorangestellten Kopf), damit
  GitHub die Lizenz erkennt (vorher „Other“); Lizenz unverändert.
- `NOTICE`: A.11 KoSIT xrechnung-visualization (Apache-2.0, Syntaxbindung), A.12 und E.14 Adobe-AFM-Zeichenbreiten
  (Erlaubnis von Adobe), Testwerkzeuge qpdf, poppler, Python/libexpat, matplotlib (Quelle der AFM-Dateien).
- Texte der Einordnung ohne Zusicherung einer Eignung: das BMF empfiehlt keine Validierungsanwendungen; das
  Protokoll dokumentiert die Prüfung, die Eignung beurteilt der Anwender.

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
- Datenschutzhinweise (`legal/datenschutz.txt`) neben dem Impressum: Verarbeitung der Rechnungen nur im Browser,
  `localStorage` nur für selbst geladene Peppol-Regelwerke, Bereitstellung über GitHub (IP-Protokollierung nach
  Angaben von GitHub; Art. 6 Abs. 1 lit. f DSGVO; EU-U.S. Data Privacy Framework), Betroffenenrechte,
  Aufsichtsbehörde; erscheinen zusammen mit dem Impressum, sobald `legal/impressum.json` ausgefüllt ist.

## 0.1.0 (2026-10-19)

Erste Version.
- Prüfung gegen CEN EN16931 Schematron 1.3.16 (UBL/CII) und KoSIT XRechnung Schematron 2.6.0 (XRechnung 3.0.2) inkl. Peppol-Regeln
  der KoSIT-Whitelist, Szenarien und Fehlerstufen der KoSIT-Validator-Konfiguration 2026-08-31.
- Extraktion eingebetteter Rechnungs-XML aus PDF (ZUGFeRD/Factur-X), XMP-Auswertung.
- Rechnungsdaten-Ansicht, CSV/JSON-Export, Zeilenangaben, SHA-256.
- Nachweise: CEN 1140/1140, KoSIT 1750/1754 (+4 dokumentiert), Saxon-Referenz 5902 Vergleiche ohne weitere Abweichung, pdf.js 151/151.
- Nicht enthalten: XSD-Prüfung, PDF/A-3-Prüfung.
