# Komponenten und Sorgfaltsprüfung (Art. 13 Abs. 5 der Verordnung (EU) 2024/2847)

Stand: **21.10.2026** (Version 0.4.0; Funde der Prüfumgebung bewertet am 25.10.2026). Für jede Komponente Dritter:
verwendete und neueste Version, Lizenz, Pflege, bekannte Schwachstellen und Integrität. Die Stückliste mit allen Einzelheiten ist `sbom.cdx.json` (Programm) bzw.
`test-environment.cdx.json` (Prüfumgebung); die Bewertung bekannter Schwachstellen `security/vex.json`
(`vex.cdx.json`, CSAF-VEX). Laufende Überwachung: OSV-Scanner bei jedem Push und wöchentlich (Check-Runs
„vulnerability scan“, „vulnerability scan (weekly)“), neue Versionen der Quellen wöchentlich (`drift.yml`, bewusst nicht
übernommene Versionen mit Begründung in `build/drift-acknowledged.json`), Dependabot für Actions und Testwerkzeuge
(`package.json` und `package-lock.json`).

Prüfmethode: neueste Version über die Tags der Quell-Repositorys (`git ls-remote`, 21.10.2026); bekannte Schwachstellen
über OSV-Scanner 2.7.0 (Datenbank osv.dev; lokal zusätzlich mit der GitHub Advisory Database vom 21.10.2026) für das
Programm einschließlich der Vorläufer, aus denen es abgeleitet ist (Ergebnis: keine bekannte Schwachstelle; frühere
Schwachstellen von Apache Xerces-J sind in `security/vex.json` als „nicht betroffen“ bewertet); Integrität über den
Commit bzw. die SHA-256 jeder Quelle (`build/STANDARDS_MANIFEST.json`, geprüft in jedem Lauf).

## 1. Im Programm enthalten (NOTICE Teil A)

| Komponente | verwendet | neueste | Lizenz | Pflege | Bewertung |
|---|---|---|---|---|---|
| fontoxpath (XPath-3.1-Engine), mit Patch | 3.34.0 + 2 Commits (`7506ae0cd03d`, 30.06.2026) | 3.34.0; Commit = Stand des Hauptzweigs | MIT | aktiv (FontoXML) | aktuell; Patch eigener Code (`patches/`), Engine in jedem Lauf byte-gleich nachgebaut |
| xspattern (XML-Schema-Muster), mit Patch | 3.1.0 + 2 Commits (`953c958bf18f`) | 3.1.0; Commit = Hauptzweig | MIT | gering (stabil) | aktuell; Patch: Kategorie Cn |
| whynot | 5.0.0 | 5.0.0 | MIT | gering (stabil, 2022) | aktuell; keine bekannten Schwachstellen |
| prsc | 4.0.0 | 4.0.0 | MIT | gering (stabil, 2022) | aktuell; keine bekannten Schwachstellen |
| esbuild (Hilfscode im Bundle) | 0.28.2 | 0.28.2 | MIT | aktiv | aktuell; GHSA-67mh-4wv8-2f99 betrifft nur < 0.25.0 und den Entwicklungsserver |
| Unicode Character Database (Tabellen von xspattern) | 15.0.0 | 17.0.0 | Unicode-3.0 | – | Zeichenklassen in Mustern für Zeichen, die erst nach Unicode 15 vergeben wurden; kein Sicherheitsbezug; folgt xspattern |
| Apache Xerces-J (Vorläufer von `src/xsd-validator.js`) | 2.12.2 (OpenJDK 21) | 2.12.2 | Apache-2.0 | – | nur Validierungslogik übersetzt, kein Parser, kein Laden von Schemata; CVE-2020-14338, CVE-2022-23437, CVE-2013-4002, CVE-2012-0881, CVE-2009-2625 nicht betroffen (VEX) |
| CEN eInvoicing-EN16931 (Regeln) | validation-1.3.16 | validation-1.3.17 | EUPL-1.2 | aktiv | 1.3.17 bewusst noch nicht übernommen: die KoSIT-Konfiguration v2026-08-31 verlangt 1.3.16 (Gleichstand mit dem offiziellen Validator) |
| KoSIT xrechnung-schematron | v2.6.0 | v2.6.0 | Apache-2.0 | aktiv | aktuell |
| KoSIT validator-configuration-xrechnung | v2026-08-31 | v2026-08-31 | Apache-2.0 | aktiv | aktuell |
| Factur-X / ZUGFeRD (über Mustangproject) | ZF 2.5.2 / Factur-X 1.09.2 (`c1618af86e68`) | core-2.26.0 + Hauptzweig | Apache-2.0 | aktiv | Regeln und Schemata der aktuellen Spezifikation |
| OASIS UBL 2.1 (Schemata) | os-UBL-2.1 | neuere OASIS-Fassungen | OASIS IPR | – | von XRechnung und EN 16931 verlangt (2.1); keine Aktualisierung vorgesehen |
| UN/CEFACT CII D16B (Schemata) | D16B | – | UN/CEFACT | – | von EN 16931 verlangt |
| KoSIT xrechnung-visualization (Pfade der Geschäftsbegriffe) | v2026-08-31 | v2026-10-13 | Apache-2.0 | aktiv | v2026-10-13 behebt Skriptinjektion in der HTML-Ansicht von KoSIT; die verwendeten Stylesheets sind unverändert, die Ansicht ist nicht enthalten (geprüft, `build/drift-acknowledged.json`) |
| Adobe Core14 AFM (Zeichenbreiten, über matplotlib) | matplotlib v3.10.7 | v3.11.2 | Adobe-Erlaubnis (APAFML) | – | die AFM-Dateien sind seit Jahrzehnten unverändert; nur Zahlen übernommen |

## 2. Prüfumgebung (nicht im Programm)

| Werkzeug | verwendet | neueste | Lizenz | Bewertung |
|---|---|---|---|---|
| Playwright (Browser der Tests) | 1.64.1 | 1.64.1 | Apache-2.0 | aktuell; Browser vom offiziellen CDN; ohne Installationsskripte installiert |
| pdf.js (`pdfjs-dist`, unabhängiger PDF-Leser) | 6.4.299 | 6.4.299 | Apache-2.0 | aktuell |
| esbuild (Nachbau der Engine) | 0.28.2 | 0.28.2 | MIT | aktuell; bewusst fest, damit das Bundle byte-gleich bleibt |
| fast-check (eigenschaftsbasiertes Fuzzing, `test/fuzz-properties.js`) | 4.10.2 | 4.10.2 | MIT | aktuell; mit Herkunftsnachweis (npm provenance) veröffentlicht |
| pure-rand (Zufallszahlen für fast-check) | 8.4.2 | 8.4.2 | MIT | aktuell |
| npm-Pakete insgesamt (`package-lock.json`) | 44 Pakete, davon 38 plattformabhängige optionale (esbuild, @napi-rs/canvas) | – | MIT / Apache-2.0 | jedes mit SHA-512 aus registry.npmjs.org, installiert mit `npm ci --ignore-scripts`, Signaturen geprüft (`npm audit signatures`); `npm audit` am 21.10.2026: keine Funde |
| Saxon HE (Referenz für XPath und Schematron) | 12.8 | 12.9 (im KoSIT-Validator enthalten) | MPL-2.0 | SHA-256 geprüft; die Erwartungswerte der Tests sind mit 12.8 festgelegt, der offizielle Validator läuft mit 12.9 |
| KoSIT-Validator (offizielle Referenz) | 1.6.3 | 1.6.3 (2.0.0 nur Vorabversionen) | Apache-2.0 | SHA-256 geprüft, byte-gleich mit Maven Central |
| veraPDF (PDF/A-Referenz) | 1.30.3 | 1.30.3 | GPL-3.0-or-later / MPL-2.0 | Prüfsummen durch Maven geprüft |
| slimdom (XML-DOM für Node) | 4.3.5 | 4.3.5 | MIT | aktuell |
| OSV-Scanner | 2.7.0 | 2.7.0 | Apache-2.0 | SHA-256 des Release geprüft |
| CycloneDX-Schemata | 1.6.2 | 1.7.2 | Apache-2.0 | BSI TR-03183-2 verlangt CycloneDX 1.6 oder neuer; Stückliste bleibt bei 1.6 |
| OASIS CSAF-Schemata | CSAF 2.0 (Commit `161045c5d2c7`) | CSAF 2.0 (2.1 Entwurf) | OASIS IPR | CSAF 2.0 ist der geltende Standard |
| Node.js | 22 (jeweils neueste 22.x) | 24 LTS | MIT | 22 wird bis April 2027 gepflegt |
| Java (Temurin) | 21 (jeweils neueste 21.x) | 25 LTS | GPL-2.0 mit Classpath-Ausnahme | 21 ist LTS; Referenzurteile gelten für JDK 21 |
| Python, `jsonschema` | System des Runners | – | PSF / MIT | nur Schemaprüfung |
| git (System des Runners `ubuntu-24.04`, PPA git-core) | 2.55.0 (`1:2.55.0-0ppa1~ubuntu24.04.2`) | 2.56.0 | GPL-2.0-only | OSV-Scanner meldet UBUNTU-CVE-2018-1000021 (Ubuntu-Priorität „low“) und UBUNTU-CVE-2024-52005 („medium“, für Ubuntu 24.04 „fix deferred“): Meldungen eines Git-Servers gelangen samt Terminal-Steuersequenzen ungefiltert auf die Fehlerausgabe. Bewertung (25.10.2026): im Projekt nicht ausnutzbar – git spricht nur über HTTPS mit github.com (Checkout dieses Repositorys, `git ls-remote` der festgelegten Quellen in `drift`), die Ausgabe landet im Protokoll des Laufs statt auf einem Terminal, eine Ausnutzung setzte einen kompromittierten GitHub-Server voraus (Restrisiko „Kompromittierung von GitHub selbst“, `docs/SICHERHEIT.md` Abschnitt 3); nicht im Programm. Ubuntu bietet keine korrigierte Fassung an; weiter gemeldet in jedem Check-Run „vulnerability scan“ |
| curl (System des Runners `ubuntu-24.04`) | 8.5.0: `8.5.0-2ubuntu10.16` im Lauf vom 21.10.2026 (Abbild ubuntu24 20261018.339.1), `8.5.0-2ubuntu10.15` im Lauf vom 25.10.2026 – welches Abbild ein Lauf erhält, bestimmt GitHub | `8.5.0-2ubuntu10.16` (Korrektur USN-8932-1 vom 14.10.2026) | curl | Für `10.15` meldet OSV-Scanner USN-8932-1 mit CVE-2026-86409, CVE-2026-86414, CVE-2026-87862, CVE-2026-87863, CVE-2026-87864, CVE-2026-92388, CVE-2026-92389, CVE-2026-92391, CVE-2026-94266 (AWS SigV4, Anmeldedaten an einen HTTP-Proxy, HSTS-Speicher, IMAP, FTP-Platzhalter, TFTP, verschachteltes MIME, `.netrc`). Bewertung (25.10.2026): im Projekt nicht ausnutzbar – curl lädt nur feste HTTPS-Adressen (github.com mit Weiterleitung auf die Dateiserver von GitHub, repo1.maven.org, www.unicode.org), ohne Proxy, Zugangsdaten, `.netrc`, HSTS-Datei, MIME-Formular, FTP-Platzhalter, TFTP oder IMAP; eine Ausnutzung setzte einen kompromittierten Server dieser Hosts voraus. Das Geladene ist über Prüfsummen gesichert: OSV-Scanner und KoSIT-Validator über festgelegte SHA-256, die Unicode-Daten über die SHA-256 des daraus gepackten Ergebnisses, die `.sha1`-Dateien von Maven Central sind selbst Vergleichswerte; nicht im Programm |
| GitHub Actions | `actions/checkout` 7.0.1, `setup-node` 7.1.0, `setup-java` 6.1.0, `upload-artifact` 7.0.2, `download-artifact` 8.0.2, `configure-pages` 6.0.0, `upload-pages-artifact` 5.0.0, `deploy-pages` 5.0.1, `attest-build-provenance` 4.2.2, `attest-sbom` 4.1.0, `github/codeql-action` 4.39.1, `ossf/scorecard-action` 2.5.0 | jeweils neueste | MIT / Apache-2.0 | auf Commits festgelegt (Testreihe `sbom`) |

## 3. Nicht verwendet

Das Programm hat keine npm-, Maven- oder Python-Abhängigkeiten zur Laufzeit; es lädt nichts nach. Peppol BIS
(OpenPeppol) wird nicht weitergegeben (keine Weitergabelizenz): der Nutzer lädt die offiziellen Dateien selbst
(`docs/RULESETS.md`).
