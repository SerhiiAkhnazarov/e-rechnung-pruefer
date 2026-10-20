# E-Rechnung Prüfer

Offline-Prüfung elektronischer Rechnungen – XRechnung, ZUGFeRD / Factur-X, EN 16931, Peppol BIS –
**vollständig im Browser**: eine einzige HTML-Datei, keine Installation, kein Upload, keine
Netzwerkverbindung. `dist/E-Rechnung-Pruefer.html` öffnen, XML- oder PDF-Datei hineinziehen.

Die Prüfung folgt dem Ablauf des offiziellen KoSIT-Validators (Zeichenkodierung → XML Schema →
Schematron → Bewertung) und liefert für XRechnung/EN 16931 nachweislich dieselben Ergebnisse wie das
Original (Abschnitt „Nachweise“).

## Was geprüft wird

| Schritt | Grundlage | Stand |
|---|---|---|
| Zeichenkodierung (BOM, Deklaration, unzulässige Bytefolgen) | XML 1.0 (5th ed.) §4.3.3 und Anhang F | – |
| XML Schema (XSD 1.0) | OASIS UBL 2.1 (Invoice, CreditNote), UN/CEFACT CII D16B, Factur-X-/ZUGFeRD-Profilschemata | UBL 2.1, CII D16B, ZF 2.5.2 |
| Geschäftsregeln EN 16931 (UBL, CII, Codelisten) | CEN eInvoicing-EN16931, Schematron | validation-1.3.16 |
| XRechnung-Regeln (inkl. der von KoSIT übernommenen Peppol-Regeln) | KoSIT xrechnung-schematron | v2.6.0 = XRechnung 3.0.2 |
| Szenarien, Fehlerstufen (customLevel), Annahmeempfehlung | KoSIT validator-configuration-xrechnung | v2026-08-31 („Summer 2026 Bugfix“) |
| Factur-X / ZUGFeRD (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED) | FNFE-MPE/FeRD-Schematron und -Schemata (über Mustangproject) | Factur-X 1.09.2 / ZUGFeRD 2.5.2 |
| Hybride PDF (ZUGFeRD/Factur-X): eingebettete XML, PDF/A-3-Container (Anhang, AF, XMP, Dateiname) | ISO 19005-3, Factur-X/ZUGFeRD-Spezifikation; `docs/PDFA3-CHECKS.md` | – |
| Peppol BIS Billing 3.0 (vollständig) | OpenPeppol – **nicht mitgeliefert**, die offiziellen `.sch` lädt der Benutzer selbst | geprüft: 3.0.21 |

Rechtsstand (geprüft 2026-10-19, `xeinkauf.de/xrechnung/versionen-und-bundles`): XRechnung 3.0 ist seit
01.02.2024 in Kraft und bleibt es „bis mindestens 31.07.2027“; jüngstes Bundle „3.0.2 Summer 2026
Bugfix“ vom 31.08.2026 = die verwendete Konfiguration. XRechnung 4.0 liegt nur als Vorabversion vor
(15.09.2026, finale Fassung voraussichtlich Frühjahr 2027). CEN hat am 09.10.2026 validation-1.3.17
veröffentlicht; KoSIT verwendet weiterhin 1.3.16 – der Prüfer folgt KoSIT (Begründung in
`build/drift-acknowledged.json`, wöchentliche Kontrolle `tools/check-drift.cjs`).

**Nicht** geprüft: elektronische Signaturen (für Rechnungen weder in Deutschland – § 14 Abs. 1 UStG –
noch in Österreich – § 11 UStG – vorgeschrieben); vollständige PDF/A-3-Konformität von Schriften,
Farbräumen usw. (das leistet nur ein vollständiger PDF/A-Validator; veraPDF läuft als Vergleich im CI);
Peppol-Transport (SBDH/AS4).

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
* **XRechnung-Regelwerk:** wie bei KoSIT fügt das Original-Stylesheet `peppol-into-xr.xsl` die
  Peppol-Regeln der Whitelist ein (`tools/merge-xrechnung-sch.sh`); Ergebnis byte-gleich mit dem Manifest.

## Nachweise

Jeder Lauf von `node tools/verify-all.cjs` erzeugt die Referenzergebnisse neu aus den gepinnten
Quellen, prüft die Reproduzierbarkeit der Bausteine der ausgelieferten Seite (Engine-Bundles, Regelwerke,
XSD-Modelle, Szenarien) und schreibt jeden Bericht mit dem Fingerprint seiner Eingaben
(`build/reports/VERIFICATION.json`). Stand 2026-10-20 (lokaler Lauf; Firefox nur im CI):

| Testreihe | Ergebnis |
|---|---|
| **Offizieller KoSIT-Validator 1.6.3** (Release-JAR) + Konfiguration v2026-08-31 (Release-ZIP), 4 158 Dokumente | **0 Abweichungen**: Szenario und Annahme unter einem KoSIT-Szenario 4 158 / 4 158; XSD-Urteil 1 891 / 1 891 (Dokumente mit Szenario), XSD-Fehlercodes 89 / 89 (schemaungültige); Meldungen – Code, Stufe, Position – 1 802 / 1 802 (schemagültige mit Schematron); Bewertung 1 891 / 1 891 (`docs/KOSIT-REFERENCE.md` 5.2) |
| KoSIT-Nachbau `test/kosit-reference/` (JDK 21 + Saxon), Selbsttests der Konfiguration + 4 158 Dokumente | 325/325 Zusicherungen, 0 Abweichungen |
| CEN-Unit-Tests EN 16931 | 1 140 / 1 140 |
| KoSIT XML-Mutate-Tests XRechnung | 1 754 / 1 754 |
| Peppol-BIS-Unit-Tests | 1 024 / 1 024 |
| Saxon HE 12.8 (offizielle XSLT-Kompilate), Dokument × Regelwerk | 18 379 Vergleiche, 0 Abweichungen |
| XPath-Batterien gegen Saxon | 378 / 378 und 267 / 267 (Index an und aus) |
| XML Schema gegen JDK-21-Xerces (Urteil und Fehlercodes) | 6 608 / 6 608 Dokumente, 5 905 / 5 905 Factur-X-Profilprüfungen, 255 / 255 Selbsttest-Instanzen |
| Zeichenkodierung gegen JDK-Parser | 31 Fälle: 28 identisch, 3 von XML 1.0 vorgeschriebene schwerwiegende Fehler, die der JDK-Parser toleriert |
| PDF-Extraktion gegen pdf.js, ZUGFeRD-Korpus | 151 / 151 (auch bei zerstörter Querverweistabelle) |
| PDF/A-3-Container-Prüfungen | 151 Korpus-PDFs wie erwartet, 3 394 / 3 394 Mutationen erkannt, Mustang-Parität 15 / 15 (davon 1 Fall strenger als Mustang: `/AFRelationship /Unspecified` an der Rechnungs-XML, `docs/PDFA3-CHECKS.md`) |
| Browser Chromium und WebKit (Engine von Safari) lokal und im CI, Firefox nur im CI | XSD-Prüfung im Browser 1 053 / 1 053 identisch mit Node (Urteil, Codes, Fundstellen); Ende-zu-Ende-Prüfung im Browser = Node; Peppol-Import im Browser inhaltsgleich mit dem Node-Build (JSON ohne die Herkunftsfelder `sources`/`importedFrom`) |
| Reproduzierbarkeit | Engine-Bundles aus Upstream + Patches, alle Regelwerke, XSD-Modelle, Szenarien: byte-gleich (die Seite selbst enthält Datum und Prüfstatus des Builds) |

Laufzeit (2 Kerne, nach dem ersten Dokument): Chromium – 100 Positionen 0,3–0,6 s, 500 Positionen
0,8–1,4 s, 2 000 Positionen 3,0–5,2 s (sieben Läufe); WebKit – 0,4–0,6 s, 1,0–1,7 s, 3,9–5,0 s (vier Läufe)
(`test/perf.cjs`, Messwerte je Lauf in `build/reports/performance-*.txt`).

CI (`.github/workflows/verify.yml`): dieselbe Pipeline in Chromium, **WebKit und Firefox**, Freigabe
nur wenn jede Testreihe mit dem aktuellen Fingerprint bestanden ist; Vergleich des KoSIT-JAR mit Maven
Central; veraPDF 1.30.3 über den ZUGFeRD-Korpus. Jeder Job veröffentlicht sein Ergebnis als Check-Run des
Commits („verification report“, „KoSIT JAR vs. Maven Central“, „veraPDF report“, „pages report“; Tabelle
aller Testreihen, Berichtsende jeder nicht bestandenen), abrufbar über
`GET /repos/SerhiiAkhnazarov/e-rechnung-pruefer/commits/<sha>/check-runs`. `pages.yml` veröffentlicht die
Seite nur nach bestandenem `verify` desselben Commits und baut sie mit dem Prüfbericht dieses CI-Laufs
(Statuszeile im Programm unter „Build“). `drift.yml`: wöchentlicher Abgleich mit neuen Versionen der
Normgeber.

## Bauen und prüfen

Voraussetzungen: Node 22, JDK 21 (Referenzen), Git, curl, unzip. Dieselben Schritte wie im CI-Job `verify`:

```sh
npm install --no-save --no-audit --no-fund playwright@1.56.0 pdfjs-dist@6.2.108 esbuild@0.28.2   # Testwerkzeuge
npx playwright install --with-deps chromium webkit firefox   # Browser vom offiziellen Playwright-CDN
node tools/fetch-sources.cjs ext                    # alle Quellen in den gepinnten Ständen (SHA-256 geprüft)
sh tools/merge-xrechnung-sch.sh ext                 # KoSIT-Merge-Schritt (XRechnung + Peppol-Whitelist)
sh tools/compile-rules.sh ext                       # Regelwerke (byte-gleich mit build/schemas; Peppol nur lokal)
node tools/build-standalone.cjs --version 0.2.0     # dist/E-Rechnung-Pruefer.html + dist/BUILD_INFO.json
node tools/verify-all.cjs --ext ext --skip pdfa-verapdf   # vollständige Prüfung (veraPDF: CI-Job pdfa-verapdf)
node tools/verify-manifest.cjs ext --reports --strict     # Freigabe
node tools/pruefer-cli.cjs rechnung.xml             # dieselbe Prüfung auf der Kommandozeile (JSON)
```

Liegen die Testwerkzeuge an anderer Stelle: `PLAYWRIGHT_MODULE`, `PDFJS_MODULE` (Paketverzeichnisse) und
`ESBUILD_BINARY` (`test/resolve-tool.cjs`, `tools/verify-all.cjs`).

Neue Versionen der Regelwerke: `docs/BUILD-RULES.md`.

## Lizenz

Eigener Code: **EUPL-1.2** (`LICENSE`). Enthaltene Fremdbestandteile, ihre Lizenzen und Änderungen:
`NOTICE` – mit dem vollständigen Wortlaut aller Lizenztexte und NOTICE-Dateien (Teil E) – und `legal/`
(CEN EUPL-1.2; KoSIT Apache-2.0; FeRD/FNFE Apache-2.0 mit Hinweis nach DIN/CEN; OASIS- und
UN/CEFACT-Hinweise; fontoxpath, xspattern, whynot, prsc, slimdom, esbuild-Hilfscode MIT; Unicode License V3;
Teile von `src/xsd-validator.js` aus Apache Xerces-J, Apache-2.0). `NOTICE` und `legal/` sind wörtlich auch
im Programm enthalten (Abschnitt „Lizenzen und Hinweise der Rechteinhaber“). Die Peppol-Regelwerke sind
mangels Weitergabelizenz nicht enthalten.

Der E-Rechnung Prüfer ist eine Anwendung der Veröffentlichung ZUGFeRD 2.5.2 / Factur-X 1.09.2 und der
Europäischen Norm EN 16931. Die Wiedergabe von Inhalten der EN 16931 erfolgt mit Erlaubnis von CEN und
DIN (Inhaber der Urheberrechte).

Das Ergebnis ist eine technische Prüfung gegen die veröffentlichten Regelwerke, keine steuerliche oder
rechtliche Beratung.
