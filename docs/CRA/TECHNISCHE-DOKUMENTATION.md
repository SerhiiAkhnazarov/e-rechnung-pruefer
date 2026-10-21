# Technische Dokumentation (Anhang VII der Verordnung (EU) 2024/2847)

Stand: **21.10.2026**, Version **0.4.0**. Die Verordnung ist auf den E-Rechnung Prüfer derzeit nicht anwendbar
(Einordnung: `docs/SICHERHEIT.md`, Abschnitt 1); diese Dokumentation ist nach Anhang VII gegliedert und wird mit jeder
Version fortgeschrieben, damit sie bei einer Geschäftstätigkeit vollständig vorliegt (Aufbewahrung zehn Jahre nach dem
Inverkehrbringen bzw. für den Unterstützungszeitraum, Art. 13 Abs. 13). Hersteller: Serhii Akhnazarov, Wien,
Österreich, ahnazarovser@gmail.com.

## 1. Allgemeine Beschreibung

**(a) Zweckbestimmung.** Technische Prüfung elektronischer Rechnungen – XRechnung (UBL, CII), ZUGFeRD / Factur-X
(PDF/A-3 mit eingebetteter CII-XML), EN 16931 – nach den offiziellen Regelwerken (CEN, KoSIT, FeRD, auf Wunsch Peppol
BIS), mit Bericht, Prüfprotokoll, Lesefassung, Datenexport und umsatzsteuerlicher Einordnung der Befunde für
Deutschland. Nutzer: Unternehmen, Steuerberatungen, Entwickler. Betrieb: eine HTML-Datei, die im Browser des Nutzers
läuft – von GitHub Pages oder als gespeicherte Datei; keine Installation, keine Konten, keine Netzwerkverbindung.

**(b) Versionen, die die Einhaltung der wesentlichen Anforderungen beeinflussen.** Jede Version x.y.z
(`CHANGELOG.md`); die eindeutige Kennung ist die SHA-256 des Programms (`programSha256` in `BUILD_INFO.json`, in der
Fußzeile der Seite) und der Datei (`SHA256SUMS.txt` jedes Releases). Sicherheitsupdates erscheinen nach Möglichkeit als
Korrekturversion x.y.z+1.

**(c) Abbildungen.** Entfällt (Software ohne Hardware).

**(d) Informationen und Anleitungen für Nutzer (Anhang II).** `docs/BENUTZERINFORMATION.md`, in der Seite (Abschnitt
„Sicherheit, Unterstützung und Herstellerangaben“) und als Seite ohne JavaScript:
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/benutzerinformation/.

## 2. Entwurf, Entwicklung, Herstellung und Behandlung von Schwachstellen

### (a) Entwurf und Systemarchitektur

Die Seite enthält alle Teile byte-gleich als eingebettete `<script>`- und `<style>`-Elemente und JSON-Datenblöcke
(Stückliste `sbom.cdx.json`, Komponenten mit SHA-512). Verarbeitung einer Datei:

```
Datei (XML oder PDF)
  │  src/xml-encoding.js   Zeichenkodierung nach XML 1.0 §4.3.3
  │  src/pdf-embedded.js   PDF: eingebettete Dateien, XMP (Grenzen: 64 MiB je Strom, 256 MiB je Dokument)
  │  src/pdfa3-checks.js   PDF/A-3- und ZUGFeRD-Containerprüfungen, aktive Inhalte (JavaScript, Aktionen)
  ▼
src/xml-parse.js           DOMParser (application/xml) über die Trusted-Types-Richtlinie "pruefer-xml"
  │                        (DOCTYPE vorher abgewiesen, Verschachtelung ≤ 5 000: src/pruefer-core.js)
  ▼
src/pruefer-core.js        Szenarioauswahl wie der KoSIT-Validator (build/scenarios.json)
  ├─ src/xsd-validator.js  XML-Schema-Prüfung gegen die eingebetteten Modelle (build/xsd), Urteile wie JDK 21 Xerces
  ├─ src/schematron.js     Schematron-Regeln (build/schemas) auf der XPath-Engine fontoxpath (vendor/)
  ├─ src/invoice-model.js  Geschäftsbegriffe der EN 16931 (build/bt-paths.json)
  └─ src/vat-relevance.js  umsatzsteuerliche Einordnung (legal/ust-pflichtangaben.json)
  ▼
src/file-safety.js         Einstufung der Anlagen und eingebetteten Dateien, sichere Dateinamen
src/reports.js, src/pdf-writer.js, src/pdf-fonts.js   CSV (Formeln neutralisiert), JSON, PDF
src/app.js, src/app.css    Oberfläche: nur Textknoten, kein HTML aus Zeichenketten
```

Vom Nutzer geladene Peppol-Regelwerke übersetzt `src/sch-compiler.js` im Browser; gespeichert werden sie nur, wenn sie
byte-gleich mit der geprüften Fassung sind (SHA-256 in der Seite, `build/importable.json`). Schutzschicht der Seite:
Content-Security-Policy mit `default-src 'none'`, SHA-256 jedes Skripts und Stils, `connect-src 'none'`, Trusted Types
(`tools/build-standalone.cjs`). Einzelheiten: `docs/XSD-VALIDATION.md`, `docs/RULESETS.md`, `docs/PDFA3-CHECKS.md`,
`docs/UST-EINORDNUNG.md`, `docs/KOSIT-REFERENCE.md`.

### (b) Behandlung von Schwachstellen

| Element | Ort |
|---|---|
| Software-Stückliste | `sbom.cdx.json` (CycloneDX 1.6, BSI TR-03183-2 v2.1.0): GitHub Pages und jedes Release; Erzeugung `tools/make-sbom.cjs`, Prüfung Testreihe `sbom` |
| Richtlinie zur koordinierten Offenlegung | `SECURITY.md`, https://serhiiakhnazarov.github.io/e-rechnung-pruefer/cvd-policy/ |
| Nachweis der Kontaktadresse | https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-contact/, `security.txt` (RFC 9116), private Schwachstellenmeldung auf GitHub (eingeschaltet), E-Mail ahnazarovser@gmail.com |
| Sichere Verteilung von Updates | HTTPS (GitHub Pages, GitHub Releases); Releases nur aus Commits, deren Prüfungen alle bestanden haben (`release.yml`); `SHA256SUMS.txt`; Herkunftsnachweis jeder veröffentlichten Datei (GitHub Artifact Attestation, Sigstore; `gh attestation verify`), im Release zusätzlich als Bundle-Datei `E-Rechnung-Pruefer-<Version>.intoto.jsonl` für die Prüfung ohne GitHub-API; jede veröffentlichte Datei wird nach dem Deployment abgerufen und byte-genau verglichen (`tools/check-published.cjs`); veröffentlicht nur vom Job `pages` desselben Laufs, der alle Prüfungen ausgeführt hat |
| Bewertung von Schwachstellen in Komponenten | `security/vex.json` → `vex.cdx.json` (CycloneDX VEX) und CSAF-VEX-Dokument |
| Veröffentlichung behobener Schwachstellen | CSAF 2.0 unter `/.well-known/csaf/` (Rolle „CSAF publisher“), Seite „Sicherheitshinweise“, GitHub Security Advisories |
| Suche nach bekannten und unbekannten Schwachstellen | OSV-Scanner bei jedem Push (Check-Run „vulnerability scan“) und wöchentlich (`security.yml`); CodeQL (security-extended, Programm und Workflows; Check-Runs „code scanning (javascript-typescript)“ und „code scanning (actions)“); eigenschaftsbasiertes Fuzzing (Testreihe `fuzz`, fast-check); OpenSSF Scorecard |
| Meldung an CSIRT und ENISA | `docs/CRA/MELDEVERFAHREN-ART14.md` |

### (c) Herstellung, Überwachung und deren Validierung

Herstellung ist der Build der Seite aus festgelegten Quellen: `tools/fetch-sources.cjs` holt jede Quelle am Commit bzw.
mit der SHA-256 aus `build/STANDARDS_MANIFEST.json`; Regelwerke, Schemamodelle, Szenarien und die Engine werden daraus
erzeugt und in jedem CI-Lauf byte-gleich reproduziert (Testreihen `engine-reproducible`, `build-reproducible`);
`tools/build-standalone.cjs` baut die Seite (`docs/BUILD-RULES.md`). Validierung bei jeder Änderung
(`.github/workflows/verify.yml`): alle Testreihen auf Linux und Windows, darunter der Vergleich mit dem offiziellen
KoSIT-Validator 1.6.3, mit Saxon HE 12.8, JDK 21 Xerces und veraPDF 1.30.3, die Browser Chromium, WebKit, Firefox,
Microsoft Edge und Google Chrome; der Freigabeschritt verlangt, dass jede Testreihe mit dem Fingerabdruck der aktuellen
Eingaben gelaufen und bestanden ist. Die Testwerkzeuge kommen nur aus `package-lock.json` (`npm ci`, SHA-512 jedes
Pakets, Signaturen der npm-Registry geprüft); die Veröffentlichung auf GitHub Pages ist ein Job desselben Laufs und folgt
nur, wenn alle Prüfjobs bestanden sind. Überwachung: wöchentlicher Versionsabgleich der Quellen und Ablaufprüfung von
`security.txt` (`drift.yml`), wöchentliche Schwachstellensuche (`security.yml`), Dependabot (sieben Tage Wartezeit).

## 3. Bewertung der Cybersicherheitsrisiken

`docs/SICHERHEIT.md`, Abschnitte 3 bis 5 (Risiken mit Angriffsweg, Maßnahme, Nachweis und Restrisiko; Abgleich mit
Anhang I Teil I und II).

## 4. Unterstützungszeitraum (Art. 13 Abs. 8)

**Bis Dezember 2031.** Berücksichtigt: die Mindestdauer von fünf Jahren ab der ersten Bereitstellung (Oktober 2026);
die erwartete Nutzungsdauer eines Prüfwerkzeugs für E-Rechnungen, die über die Übergangsregelungen der E-Rechnungspflicht
(§ 27 Abs. 38 UStG) hinaus genutzt wird; die jährliche Folge neuer Regelwerksversionen (XRechnung, EN 16931, Factur-X),
die neue Versionen des Prüfers ohnehin erfordert; die laufende Aktualisierung der Browser, in denen er läuft. Unterstützt
wird jeweils die neueste Version; die Aktualisierung ist kostenlos (Art. 13 Abs. 10). Die Seite weist nach dem Ende des
Zeitraums darauf hin (Art. 13 Abs. 19).

## 5. Angewandte Normen und Spezifikationen

Harmonisierte Normen zur Verordnung waren am 21.10.2026 nicht im Amtsblatt veröffentlicht; gemeinsame Spezifikationen
und Zertifizierungsschemata wurden nicht angewandt. Angewandt (freiwillig, ganz oder in den genannten Teilen):

| Norm / Spezifikation | Anwendung |
|---|---|
| BSI TR-03183-2 v2.1.0 (Software Bill of Materials) | Stückliste des Lieferumfangs (8.3.4), Pflichtfelder 5.2, Lizenzen 8.2; geprüft (Testreihe `sbom`) |
| BSI TR-03183-3 v1.0.0 (Schwachstellenmeldungen) | CVD-Richtlinie, Meldeseite ohne JavaScript, `security.txt`, Fristen; Abweichungen in `SECURITY.md` Abschnitt 9 |
| ISO/IEC 29147:2018, ISO/IEC 30111:2019 | Offenlegung und Behandlung von Schwachstellen (`SECURITY.md`) |
| RFC 9116 | `security.txt` |
| OASIS CSAF 2.0 (ISO/IEC 20153:2025) | Sicherheitshinweise und VEX; Schema und Pflichttests 6.1 geprüft (Testreihe `security`) |
| CycloneDX 1.6 (ECMA-424) | SBOM, VEX, Stückliste der Prüfumgebung |
| FIRST CVSS 4.0 und 3.1 | Schweregrade |
| W3C Content Security Policy Level 3, Trusted Types | Schutz der Seite |
| OWASP CSV Injection | Neutralisierung der CSV-Zellen (Testreihen `security`, `fuzz`) |
| OpenSSF Scorecard | Bewertung der Sicherheitspraktiken des Repositorys (`docs/SICHERHEIT.md`, Abschnitt 8) |
| ISO 19005-3 (PDF/A-3), veraPDF-Regeln | Containerprüfungen (`docs/PDFA3-CHECKS.md`) |

## 6. Prüfberichte

Je Commit die Check-Runs „verification report“, „Windows report“, „platform comparison“, „veraPDF report“, „KoSIT JAR
vs. Maven Central“, „vulnerability scan“, „pages report“, „code scanning (javascript-typescript)“ und „code scanning
(actions)“ (`GET /repos/SerhiiAkhnazarov/e-rechnung-pruefer/commits/{sha}/check-runs`); `VERIFICATION.json` (alle
Testreihen mit Fingerabdruck der Eingaben) auf GitHub Pages und in jedem Release.

## 7. EU-Konformitätserklärung

Nicht ausgestellt (vor der Anwendbarkeit der Verordnung nicht zulässig). Entwurf: `docs/CRA/EU-KONFORMITAETSERKLAERUNG-ENTWURF.md`.

## 8. Software-Stückliste

`sbom.cdx.json` – öffentlich auf GitHub Pages und in jedem Release, nicht erst auf Verlangen einer
Marktüberwachungsbehörde; dazu `vex.cdx.json` und `test-environment.cdx.json` (Stückliste der Prüfumgebung).
