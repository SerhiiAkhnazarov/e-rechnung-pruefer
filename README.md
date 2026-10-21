# E-Rechnung Prüfer

Offline-Prüfung elektronischer Rechnungen – XRechnung, ZUGFeRD / Factur-X, EN 16931, Peppol BIS –
**vollständig im Browser**: eine einzige HTML-Datei, keine Installation, kein Upload. Online:
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/ (einmal laden, geprüft wird nur im Browser) – oder die
Datei `E-Rechnung-Pruefer.html` aus den [Releases](https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/releases)
öffnen, ohne Netzwerkverbindung. XML- oder PDF-Datei hineinziehen.

Die Prüfung folgt dem Ablauf des offiziellen KoSIT-Validators (Zeichenkodierung → XML Schema →
Schematron → Bewertung) und liefert für XRechnung/EN 16931 nachweislich dieselben Ergebnisse wie das
Original (Abschnitt „Nachweise“). Darüber hinaus ordnet der Prüfer jeden Befund **umsatzsteuerlich** ein
(Formatfehler, Fehler mit oder ohne Bezug zu einer Rechnungspflichtangabe – BMF-Schreiben vom 15.10.2025 und
15.10.2026), zeigt, ob die Pflichtangaben im strukturierten Teil vorhanden sind, und schreibt je Rechnung ein
**Prüfprotokoll** (PDF) zum Aufbewahren, eine **Lesefassung** (PDF) und für alle geprüften Dateien zusammen die Rechnungsdaten als **CSV**.

## Was geprüft wird

| Schritt | Grundlage | Stand |
|---|---|---|
| Zeichenkodierung (BOM, Deklaration, unzulässige Bytefolgen); Dokumenttyp-Deklaration (DOCTYPE) abgewiesen wie beim KoSIT-Validator | XML 1.0 (5th ed.) Abschnitt 4.3.3 und Anhang F; KoSIT-Validator 1.6.3 (`disallow-doctype-decl`) | – |
| XML Schema (XSD 1.0) | OASIS UBL 2.1 (Invoice, CreditNote), UN/CEFACT CII D16B, Factur-X-/ZUGFeRD-Profilschemata | UBL 2.1, CII D16B, ZF 2.5.2 |
| Geschäftsregeln EN 16931 (UBL, CII, Codelisten) | CEN eInvoicing-EN16931, Schematron | validation-1.3.16 |
| XRechnung-Regeln (inkl. der von KoSIT übernommenen Peppol-Regeln) | KoSIT xrechnung-schematron | v2.6.0 = XRechnung 3.0.2 |
| Szenarien, Fehlerstufen (customLevel), Annahmeempfehlung | KoSIT validator-configuration-xrechnung | v2026-08-31 („Summer 2026 Bugfix“) |
| Factur-X / ZUGFeRD (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED) | FNFE-MPE/FeRD-Schematron und -Schemata (über Mustangproject) | Factur-X 1.09.2 / ZUGFeRD 2.5.2 |
| Hybride PDF (ZUGFeRD/Factur-X): eingebettete XML, PDF/A-3-Container (Anhang, AF, XMP, Dateiname) | ISO 19005-3, Factur-X/ZUGFeRD-Spezifikation; `docs/PDFA3-CHECKS.md` | – |
| Peppol BIS Billing 3.0 (vollständig) | OpenPeppol – **nicht mitgeliefert**, die offiziellen `.sch`-Dateien lädt der Nutzer selbst | geprüft: 3.0.21 |
| Umsatzsteuerliche Einordnung jedes Befunds, Gesamturteil, Übersicht der Pflichtangaben (Deutschland) | §§ 14, 14a, 15, 22c, 27 Abs. 38 UStG, §§ 31, 33, 34a UStDV, BMF-Schreiben vom 15.10.2024 und 15.10.2025 (in Kopien gelesen) und vom 15.10.2026 (am Original geprüft), Zuordnungstabelle von KoSIT/FeRD (von der Finanzverwaltung empfohlen, BMF-Schreiben vom 15.10.2026, Rn. 8 und 9); `docs/UST-EINORDNUNG.md` | Rechtsstand 21.10.2026 |
| Rechnungsdaten (alle Geschäftsbegriffe der EN 16931) | Syntaxbindung der KoSIT-Visualisierung (`build/bt-paths.json`) | xrechnung-visualization v2026-08-31 |

Versionsstand (geprüft am 20.10.2026, `xeinkauf.de/xrechnung/versionen-und-bundles`): XRechnung 3.0 ist seit
01.02.2024 in Kraft und bleibt es „bis mindestens 31.07.2027“; jüngstes Bundle „3.0.2 Summer 2026
Bugfix“ vom 31.08.2026 = die verwendete Konfiguration. Das danach veröffentlichte Paket „XRechnung Bugfix
Visualization 2026-10-13“ ändert in `xrechnung-visualization` nur die HTML-Darstellung (`xrechnung-html.xsl`:
Schutz vor eingeschleustem Skript über BT-122/BT-125); die Stylesheets, aus denen der Prüfer die Syntaxbindung
übernimmt (`ubl-invoice-xr.xsl`, `ubl-creditnote-xr.xsl`, `cii-xr.xsl`), sind unverändert (`git diff v2026-08-31
v2026-10-13`, `build/drift-acknowledged.json`). XRechnung 4.0 liegt nur als Vorabversion vor (15.09.2026, finale Fassung voraussichtlich
Frühjahr 2027). CEN hat am 09.10.2026 validation-1.3.17 veröffentlicht; KoSIT verwendet weiterhin 1.3.16 –
der Prüfer folgt KoSIT. Peppol BIS Billing: verwendet 3.0.21 (Release Mai 2026, laut
`docs.peppol.eu/poacc/billing/3.0/release-notes/` veröffentlicht am 20.05.2026, verpflichtend ab 17.08.2026).
Begründungen in `build/drift-acknowledged.json`, wöchentliche Kontrolle `tools/check-drift.cjs`.

**Nicht** geprüft: elektronische Signaturen (für Rechnungen weder in Deutschland – § 14 Abs. 3 UStG –
noch in Österreich – § 11 Abs. 2 UStG 1994 – vorgeschrieben); vollständige PDF/A-3-Konformität von Schriften,
Farbräumen usw. (das leistet nur ein vollständiger PDF/A-Validator; veraPDF läuft als Vergleich im CI);
Peppol-Transport (SBDH/AS4).

## Was der Prüfer liefert

* **Je Datei:** Ergebnis wie beim KoSIT-Validator; **umsatzsteuerliche Einordnung** – keine E-Rechnung
  (Formatfehler, Profil MINIMUM/BASIC WL), Pflichtangaben betroffen, Pflichtangabe fehlt, Fehler ohne
  umsatzsteuerliche Bedeutung, keine Fehler – mit Übergangsregelung, Ausnahmen, Kleinbetrag, Kleinunternehmer,
  Reverse Charge; **Übersicht der Pflichtangaben** (vorhanden, fehlt, prüfen, entfällt, nicht zutreffend);
  Rechnungsdaten mit allen Positionen, Zeilennummer jedes Befunds in der XML.
* **Dateien je Rechnung:** Prüfprotokoll (PDF: Datei mit SHA-256, Prüfweg, Regelstand, Befunde mit Einordnung,
  Pflichtangaben, Zeitpunkt – zum Aufbewahren mit der Rechnung), Lesefassung (PDF; maßgeblich bleibt die XML), die
  XML einer ZUGFeRD-/Factur-X-PDF, die eingebetteten Dateien der PDF und die Anlagen der Rechnung (BG-24).
* **Für alle geprüften Dateien:** Prüfbericht (CSV, ein Befund je Zeile mit Einordnung), Rechnungsdaten (CSV, eine
  Rechnung je Zeile, Umsatzsteuer je Kategorie und Satz), Positionen (CSV), JSON mit Datenmodell. CSV mit
  Byte-Order-Mark, `;`, Dezimalkomma und TT.MM.JJJJ für deutsche Tabellenkalkulationen.

Die Einordnung ist eine Hilfe zur Prüfung, keine Steuerberatung: Sie zeigt, welche Pflichtangaben ein Befund
nach der Zuordnung des Werkzeugs betrifft und ob die Angaben vorhanden sind – nicht, ob sie richtig sind.
Grundlagen, Zuordnung, Grenzen und die unabhängigen Durchsichten: `docs/UST-EINORDNUNG.md`.

## Wie es funktioniert

* **Ein Prüfablauf für Browser und Kommandozeile:** `src/pruefer-core.js` (`analyzeBytes`) – dieselbe
  Funktion in der Seite und in `tools/pruefer-cli.cjs`; die Browser-Tests vergleichen beide Ergebnisse.
* **XPath 3.1:** [fontoxpath](https://github.com/FontoXML/fontoxpath) 3.34.0 aus dem Quellcode,
  mit `patches/fontoxpath-pruefer.patch`: exakte `xs:decimal`-Arithmetik wie Saxon (BigInt-Mantisse,
  Division mit `DIVIDE_PRECISION = 18`, HALF_DOWN), Dokumentindex für `//name`-Pfade, Datumsprüfung
  und `24:00:00`-Übertrag nach XML Schema; `patches/xspattern-pruefer.patch`: `\p{Cn}` für nicht
  zugewiesene Zeichen. Unicode-Tabellen: UCD 15.0.0.
* **Schematron:** `src/schematron.js` führt die Original-Regeln (ISO Schematron, XSLT2-Binding) aus;
  `src/sch-compiler.js` übersetzt `.sch` nur in eine JSON-Struktur (in Node und – für Peppol – im Browser).
* **XML Schema:** `src/xsd-validator.js` – Inhaltsmodelle als Glushkov-Automaten mit der Semantik des
  JDK-21-Xerces (Fehlercodes identisch), alle eingebauten Datentypen; `docs/XSD-VALIDATION.md`.
* **XRechnung-Regelwerk:** Wie bei KoSIT fügt das Original-Stylesheet `peppol-into-xr.xsl` die
  Peppol-Regeln der Whitelist ein (`tools/merge-xrechnung-sch.sh`); Ergebnis byte-gleich mit dem im Manifest
  festgehaltenen Stand.

## Nachweise

Jeder Lauf von `node tools/verify-all.cjs` erzeugt die Referenzergebnisse neu aus den festgelegten
Quellen, prüft die Reproduzierbarkeit der Bausteine der ausgelieferten Seite (Engine-Bundles, Regelwerke,
XSD-Modelle, Szenarien) und schreibt jeden Bericht mit dem Fingerprint seiner Eingaben
(`build/reports/VERIFICATION.json`). Die Ergebnisse jedes Commits stehen in seinen Check-Runs (unten, „CI“);
die veröffentlichte Seite wird mit dem Bericht ihres CI-Laufs ausgeliefert (`VERIFICATION.json` und `BUILD_INFO.json`
neben der Seite und in jedem Release). Seite und Berichte liegen nicht im Repository – jede Kopie wird aus den
Quellen gebaut und geprüft. Ergebnisse der CI-Läufe (gleich in jedem Lauf; die Zahlen jedes Commits im
Check-Run „verification report“):

| Testreihe | Ergebnis |
|---|---|
| **Offizieller KoSIT-Validator 1.6.3** (Release-JAR) + Konfiguration v2026-08-31 (Release-ZIP), 4 166 Dokumente (4 158 aus den Korpora, 8 mit Dokumenttyp-Deklaration) | **0 Abweichungen**: Szenario 4 166 / 4 166, Annahme unter einem KoSIT-Szenario 4 158 / 4 158; Verarbeitungsfehler (DOCTYPE) 8 / 8 auf beiden Seiten; XSD-Urteil 1 891 / 1 891 (Dokumente mit Szenario), XSD-Fehlercodes 89 / 89 (schemaungültige); Meldungen – Code, Stufe, Position – 1 802 / 1 802 (schemagültige mit Schematron); Bewertung 1 891 / 1 891 (`docs/KOSIT-REFERENCE.md` 5.2) |
| KoSIT-Nachbau `test/kosit-reference/` (JDK 21 + Saxon), Selbsttests der Konfiguration + 4 158 Dokumente | 325 / 325 Zusicherungen, 0 Abweichungen |
| CEN-Unit-Tests EN 16931 | 1 140 / 1 140 |
| KoSIT XML-Mutate-Tests XRechnung | 1 754 / 1 754 |
| Peppol-BIS-Unit-Tests | 1 024 / 1 024 |
| Saxon HE 12.8 (offizielle XSLT-Kompilate), Dokument × Regelwerk | 18 379 Vergleiche, 0 Abweichungen |
| XPath-Batterien gegen Saxon | 378 / 378 Ausdrücke; Dokument-Batterie 267 / 267, je mit Index an und aus |
| XML Schema gegen JDK-21-Xerces (Urteil und Fehlercodes) | 6 608 / 6 608 Dokumente, 5 905 / 5 905 Factur-X-Profilprüfungen, 255 / 255 Selbsttest-Instanzen |
| Zeichenkodierung gegen JDK-Parser | 31 Fälle: 28 identisch, 3 von XML 1.0 vorgeschriebene schwerwiegende Fehler, die der JDK-Parser toleriert |
| PDF-Extraktion gegen pdf.js, ZUGFeRD-Korpus | 151 / 151 (auch bei zerstörter Querverweistabelle) |
| PDF/A-3-Container-Prüfungen | 151 Korpus-PDFs wie erwartet, 3 394 / 3 394 Mutationen erkannt, Mustang-Parität 15 / 15 (davon 1 Fall strenger als Mustang: `/AFRelationship /Unspecified` an der Rechnungs-XML, `docs/PDFA3-CHECKS.md`) |
| Rechnungsdaten gegen die offizielle KoSIT-Visualisierung (xrechnung-visualization, Saxon HE 12.8) | 4 157 Dokumente, 164 Geschäftsbegriffe, 184 676 Vergleiche: alle Werte identisch bei 2 072 / 2 072 schemagültigen Dokumenten (für schemaungültige ist das KoSIT-Ergebnis nicht definiert) |
| Umsatzsteuerliche Einordnung | 3 734 / 3 734 Prüfungen: Rechtstabelle, begründete Erwartungen je Regel, jeder Status der Übersicht und jedes Urteil an konstruierten Rechnungen, 3 140 Korpusdokumente mit 5 096 Befunden konsistent eingeordnet |
| Dateien: CSV, JSON, Prüfprotokoll und Lesefassung (PDF), Anlagen | 1 977 Dokumente, 3 952 PDFs: `qpdf --check`, Text über poppler (`pdftotext`, `pdfinfo`) und pdf.js; CSV mit strengem Leser gegen die Daten; 173 Anlagen gleich der Ausgabe des Base64-Decoders von Node; 20 708 / 20 708 Prüfungen |
| Zeilennummern der Befunde gegen libexpat (Python) | 7 795 Dokumente, 878 914 Elemente, 4 646 Befunde: 0 Abweichungen |
| SHA-256 (`src/sha256.js`) gegen OpenSSL | 8 928 / 8 928 Eingaben (172 MiB) |
| Feindliche und beschädigte Dateien (`test/run-robustness-tests.cjs`) | 246 / 246 Prüfungen: Dokumenttyp-Deklarationen vor dem Parsen abgewiesen – Entity-Expansion (Billion Laughs, quadratisch), externe Entitäten (lokale Datei, Netzadresse eines lokalen Servers: keine Verbindung), harmlose DOCTYPE wie bei KoSIT; „<!DOCTYPE“ in einem Kommentar wird nicht abgewiesen; Verschachtelung 5 000 / 5 001 / 200 000 Ebenen, PDF-Dekompressionsbomben (200 MiB in einem Strom, 6 × 60 MiB), PDF-Arrays 100 000 tief, falsche `/Length`, abgeschnittene XML und PDF, Zufallsbytes; 192 mutierte Fassungen von 8 Dokumenten (Fuzzing mit festem Startwert): jede mit Urteil, ohne geworfene Ausnahme, unter 60 s |
| Feindliche Dateien in der Seite (`test/robustness-browser.cjs`: 11 wie in der Node-Reihe und eine über 100 MB), fünf Browser | je 44 / 44 Prüfungen: Ergebnis zu jeder Datei, der Tab bleibt offen und bedienbar, keine Anfrage außer der Seite selbst, keine Verbindung zum lokalen Server, kein Dateiinhalt, keine Ausnahme in der Seite; Datei über 100 MB nicht gelesen |
| Stückliste `sbom.cdx.json` (`test/run-sbom-tests.cjs`) | 67 / 67 Prüfungen: gültig nach dem offiziellen CycloneDX-1.6-Schema (Python jsonschema; Gegenprobe mit fehlerhaftem Dokument), 15 Komponenten = NOTICE Teil A (12 mit Commit; Regelwerke, Schemata, Syntaxbindung und Zeichenbreiten mit SHA-256 jeder verwendeten Quelldatei), reproduzierbar |
| Browser: Linux – Chromium, WebKit (Engine von Safari), Firefox; Windows – Microsoft Edge, Google Chrome | XSD-Prüfung im Browser 1 053 / 1 053 identisch mit Node (Urteil, Codes, Fundstellen); Ende-zu-Ende-Prüfung im Browser = Node; jede Datei der Seite (Protokoll, Lesefassung, CSV, JSON, XML, Anlagen) byte-gleich mit Node, SHA-256 der Seite gleich OpenSSL; Peppol-Import im Browser inhaltsgleich mit dem Node-Build (JSON ohne die Herkunftsfelder `sources`/`importedFrom`) |
| Reproduzierbarkeit | Engine-Bundles aus Upstream + Patches, alle Regelwerke, XSD-Modelle, Szenarien, Syntaxbindung (`build/bt-paths.json`), Zeichenbreiten (`src/pdf-fonts.js`): byte-gleich; die Seite: unter Linux und Windows dasselbe Programm (`programSha256` in `BUILD_INFO.json` = SHA-256 der Seite ohne den Build-Vermerk mit Datum und Prüfstatus) |

Laufzeit (`test/perf.cjs`, je Dokument im Browser nach dem ersten Dokument): Grenzen 100 Positionen ≤ 3 s,
500 ≤ 8 s, 2 000 ≤ 30 s, geprüft in jedem CI-Lauf in allen fünf Browsern; die Messwerte des Laufs mit Prozessor,
Kernzahl und Browserversion stehen in den Berichten `performance-*` (Check-Runs „verification report“ und
„Windows report“).

CI (`.github/workflows/verify.yml`): dieselbe Pipeline unter Linux in Chromium, **WebKit und Firefox**,
Freigabe nur, wenn jede Testreihe mit dem aktuellen Fingerprint bestanden ist; **Windows** (Job `windows`): die
Browser-Testreihen in **Microsoft Edge und Google Chrome**, mit Korpus, Xerces-Referenz und Seite unter Windows
gebaut; Job `platforms`: Beide Läufe haben dieselben Eingaben (`filesId`) und dasselbe Programm
(`programSha256`) geprüft; Vergleich des KoSIT-JAR mit Maven Central; veraPDF 1.30.3 über den ZUGFeRD-Korpus.
Jeder Job veröffentlicht sein Ergebnis als Check-Run des Commits („verification report“, „Windows report“,
„platform comparison“, „KoSIT JAR vs. Maven Central“, „veraPDF report“, „pages report“; Tabelle aller
Testreihen, Berichtsende jeder nicht bestandenen, `VERIFICATION.json` vollständig), abrufbar über
`GET /repos/SerhiiAkhnazarov/e-rechnung-pruefer/commits/<sha>/check-runs`. `pages.yml` veröffentlicht die
Seite nur nach bestandenem `verify` desselben Commits, baut sie mit dem Verifikationsbericht (`VERIFICATION.json`) dieses CI-Laufs
(Statuszeile im Programm unter „Build“), verlangt dasselbe Programm wie die getestete Seite und liest die
veröffentlichten Dateien danach über HTTPS zurück (`tools/check-published.cjs`). `release.yml` (von Hand
gestartet) veröffentlicht genau diese Dateien als Release, wenn die sechs oben genannten Check-Runs des Commits bestanden sind.
`drift.yml`: wöchentlicher Abgleich mit neuen Versionen der Normgeber.

## Bauen und prüfen

Voraussetzungen: Node 22, JDK 21 (Referenzen), Git, curl, unzip, Python 3 (Referenz der Zeilennummern:
libexpat; Paket jsonschema für die Prüfung der Stückliste), qpdf und poppler-utils (Prüfung der PDF-Dateien). Dieselben Schritte wie im CI-Job `verify`:

```sh
npm install --no-save --no-audit --no-fund playwright@1.56.0 pdfjs-dist@6.2.108 esbuild@0.28.2   # Testwerkzeuge
npx playwright install --with-deps chromium webkit firefox   # Browser vom offiziellen Playwright-CDN
node tools/fetch-sources.cjs ext                    # alle Quellen in den festgelegten Ständen (SHA-256 geprüft)
sh tools/merge-xrechnung-sch.sh ext                 # KoSIT-Merge-Schritt (XRechnung + Peppol-Whitelist)
sh tools/compile-rules.sh ext                       # Regelwerke (byte-gleich mit build/schemas; Peppol nur lokal)
node tools/build-standalone.cjs --version 0.3.1     # dist/E-Rechnung-Pruefer.html, dist/BUILD_INFO.json, dist/sbom.cdx.json
node tools/verify-all.cjs --ext ext --skip pdfa-verapdf   # vollständige Prüfung (veraPDF: CI-Job pdfa-verapdf)
node tools/verify-manifest.cjs ext --reports --strict     # Freigabe
node tools/pruefer-cli.cjs rechnung.xml             # dieselbe Prüfung auf der Kommandozeile (JSON)
```

Unter Windows (Git Bash, wie im CI-Job `windows`; vorher `git config --global core.autocrlf false` und
`git config --global core.eol lf`, damit die Dateien byte-gleich ausgecheckt werden): die Browser-Testreihen in
den installierten Browsern Edge und Chrome – `node tools/verify-all.cjs --ext ext --only` mit den Namen aus
`node tools/verify-all.cjs --list` (`…-edge-win`, `…-chrome-win`; vorher `ref-corpus`, `ref-xerces`,
`xml-encoding`, `page-build`).

Liegen die Testwerkzeuge an anderer Stelle, gelten die Umgebungsvariablen `PLAYWRIGHT_MODULE`, `PDFJS_MODULE`
(Paketverzeichnisse) und `ESBUILD_BINARY` (`test/resolve-tool.cjs`, `tools/verify-all.cjs`).

Neue Versionen der Regelwerke: `docs/BUILD-RULES.md`.

## Sicherheit

* Schwachstellen bitte vertraulich melden: `SECURITY.md` (GitHub „Report a vulnerability“, Ziele für Antwort und
  Korrektur, koordinierte Offenlegung).
* Die Seite baut keine Netzwerkverbindung auf (Content-Security-Policy `connect-src 'none'`), führt keine Inhalte der
  Rechnung aus und begrenzt Verschachtelung, entpackte PDF-Datenströme und Dateigröße; geprüft mit feindlichen
  Dateien in allen fünf Browsern und mit Mutations-Fuzzing (Testreihen `robustness`, `robustness-browser-*`).
* Stückliste (SBOM) im Format CycloneDX 1.6: `sbom.cdx.json` neben der Seite auf GitHub Pages und in jedem Release
  (`tools/make-sbom.cjs`; gegen das offizielle CycloneDX-Schema geprüft, Testreihe `sbom`).
* Einordnung nach der Verordnung (EU) 2024/2847 (Cyber Resilience Act), Risikobewertung, Abgleich mit Anhang I:
  `docs/SICHERHEIT.md`.

## Lizenz

Eigener Code: **EUPL-1.2** (`LICENSE`). Enthaltene Fremdbestandteile, ihre Lizenzen und Änderungen:
`NOTICE` – mit dem vollständigen Wortlaut aller Lizenztexte und NOTICE-Dateien (Teil E) – und `legal/`
(CEN EUPL-1.2; KoSIT Apache-2.0; FeRD/FNFE Apache-2.0 mit Hinweis nach DIN/CEN; OASIS- und
UN/CEFACT-Hinweise; fontoxpath, xspattern, whynot, prsc, slimdom, esbuild-Hilfscode MIT; Unicode License V3;
Teile von `src/xsd-validator.js` aus Apache Xerces-J, Apache-2.0; Syntaxbindung aus der KoSIT-Visualisierung,
Apache-2.0; Zeichenbreiten aus den Adobe-AFM-Dateien mit Adobes Erlaubnis). `NOTICE` und die Lizenzhinweise aus `legal/` sind
wörtlich auch im Programm enthalten (Abschnitt „Lizenzen und Hinweise der Rechteinhaber“). Die Peppol-Regelwerke sind
mangels Weitergabelizenz nicht enthalten.
Impressum und Datenschutzhinweise der veröffentlichten Seite: `legal/impressum.json` (vom Anbieter auszufüllen)
und `legal/datenschutz.txt`; beide erscheinen in der Fußzeile, sobald das Impressum ausgefüllt ist.

Der E-Rechnung Prüfer ist eine Anwendung der Veröffentlichung ZUGFeRD 2.5.2 / Factur-X 1.09.2 und der
Europäischen Norm EN 16931. Die Wiedergabe von Inhalten der EN 16931 erfolgt mit Erlaubnis von CEN und
DIN (Inhaber der Urheberrechte).

Das Ergebnis ist eine technische Prüfung gegen die veröffentlichten Regelwerke mit einer umsatzsteuerlichen
Einordnung nach den veröffentlichten Verwaltungsanweisungen, keine steuerliche oder rechtliche Beratung.
