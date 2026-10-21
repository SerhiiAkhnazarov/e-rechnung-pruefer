# Sicherheit und Verordnung (EU) 2024/2847 (Cyber Resilience Act)

Stand: **21.10.2026** (Version 0.4.0). Meldeweg für Schwachstellen: `SECURITY.md`
(https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-contact/). Informationen für Nutzer nach Anhang II:
`docs/BENUTZERINFORMATION.md`. Technische Dokumentation nach Anhang VII: `docs/CRA/TECHNISCHE-DOKUMENTATION.md`.
Meldeverfahren nach Art. 14: `docs/CRA/MELDEVERFAHREN-ART14.md`. Sorgfaltsprüfung der Komponenten (Art. 13 Abs. 5):
`docs/KOMPONENTEN.md`.

## 1. Gilt die Verordnung für den E-Rechnung Prüfer?

### Rechtsgrundlagen (gelesen am 21.10.2026)

| Stelle | Inhalt | Quelle |
|---|---|---|
| Art. 2 Abs. 1 | gilt für Produkte mit digitalen Elementen, die **auf dem Markt bereitgestellt** werden und deren beabsichtigte Zweckbestimmung oder vernünftigerweise vorhersehbare Verwendung eine direkte oder indirekte logische oder physische Datenverbindung mit einem Gerät oder Netz einschließt | Amtsblatttext (Wiedergabe springlex.eu, „Source: OJ L 2024/2847“) |
| Art. 3 Nr. 1, 13, 22 | Produkt mit digitalen Elementen; Hersteller (auch „free of charge“); Bereitstellung auf dem Markt nur „in the course of a commercial activity“ | dito |
| Erwägungsgründe 15 und 18 | nicht monetarisierte freie und quelloffene Software wird nicht im Rahmen einer Geschäftstätigkeit bereitgestellt; Spenden ohne Gewinnerzielungsabsicht sind keine Geschäftstätigkeit | EUR-Lex |
| Art. 13 Abs. 8, 10, 19 | Unterstützungszeitraum mindestens fünf Jahre; Pflichten zur Schwachstellenbehandlung genügen für die zuletzt in Verkehr gebrachte Version, wenn ältere kostenlos aktualisiert werden können; Hinweis auf das Ende des Unterstützungszeitraums | springlex.eu |
| Art. 14, Art. 64 Abs. 10 | Meldung aktiv ausgenutzter Schwachstellen und schwerwiegender Sicherheitsvorfälle (24 h, 72 h, 14 Tage bzw. ein Monat) über die zentrale Meldeplattform; keine Geldbußen gegen Kleinst- und Kleinunternehmen wegen verspäteter Frühwarnung | european-cyber-resilience-act.com, springlex.eu |
| Art. 69 Abs. 2, 3; Art. 71 Abs. 2 | vor dem 11.12.2027 in Verkehr gebrachte Produkte nur bei wesentlicher Änderung, **Art. 14 gilt auch für sie**; Anwendung ab **11.12.2027**, Art. 14 ab **11.09.2026** | springlex.eu |
| Anhänge I, II, V, VII | wesentliche Anforderungen, Informationen für Nutzer, EU-Konformitätserklärung, technische Dokumentation | prighter.com (Wiedergabe) |
| Leitlinien der Kommission C(2026) 5252 vom 27.07.2026 (nicht verbindlich) | Rn. 20 und Beispiel 4: Software „developed using web technologies but supplied for local execution“ ist ein Produkt mit digitalen Elementen; Rn. 21 und Beispiel 5: eine nur im Browser aufgerufene Webanwendung nicht; Rn. 13: jede Version gilt mit ihrer ersten Bereitstellung als in Verkehr gebracht; Rn. 42, 53, 56, 61, 65: nicht monetarisierte freie Software einer natürlichen Person wird nicht in Verkehr gebracht, auch nicht bei bloßen Spendenlinks; Rn. 51, 54, 57, 62: Preis für die Software, kostenpflichtige Ausgabe, Monetarisierung anderer Leistungen über die Software, personenbezogene Daten als Nutzungsbedingung, Zugang oder Updates nur gegen Spende machen sie zum Inverkehrbringen; Rn. 43: juristische Personen können als Verwalter quelloffener Software (Art. 24) Pflichten haben; Rn. 128–131: Unterstützungszeitraum je wesentlich geänderter Version, Art. 13 Abs. 10 | Spiegel des Dokuments https://www.cyber-resilience.tech/downloads/eu-cra-commission-guidance-c2026-5252.pdf, gelesen bis Rn. 135 (Abschnitte 6–9 nicht abrufbar) |
| Durchführungsverordnung (EU) 2025/2392 | Beschreibung der wichtigen und kritischen Produkte (Anhänge III, IV) | EUR-Lex CELEX 32025R2392 |

### Einordnung (Bewertung, keine Rechtsberatung)

* **Ist der Prüfer ein Produkt mit digitalen Elementen?** Die heruntergeladene oder gespeicherte Datei
  (`E-Rechnung-Pruefer.html` aus den Releases) ist Software, die auf dem Gerät des Nutzers ausgeführt wird – nach Rn. 20
  der Leitlinien ein Produkt mit digitalen Elementen. Die Seite auf GitHub Pages ist für sich genommen eine
  Webanwendung (Rn. 21, Beispiel 5), aber byte-gleich mit dieser Datei. Maßgeblich ist daher die nächste Frage.
* **Wird er auf dem Markt bereitgestellt?** Der Prüfer ist freie Software (EUPL-1.2) einer natürlichen Person, ohne
  Preis, ohne kostenpflichtige Ausgabe oder Unterstützung, ohne Spenden, ohne Werbung und ohne Erhebung
  personenbezogener Daten. Nach dieser Bewertung wird er derzeit **nicht im Rahmen einer Geschäftstätigkeit**
  bereitgestellt (Art. 3 Nr. 22, Erwägungsgründe 15, 18; Rn. 42, 53, 65 der Leitlinien). Die Pflichten der Verordnung
  gelten dann nicht, auch die Meldepflicht des Art. 14 nicht.
* **Was das ändern würde:** ein Preis für die Datei, eine kostenpflichtige Ausgabe, entgeltliche Leistungen, die über
  den Prüfer vermarktet werden (Rn. 54), personenbezogene Daten als Bedingung der Nutzung (Rn. 54), Zugang oder Updates
  nur gegen Spende (Rn. 62) oder ein Wechsel zu einer juristischen Person als Herausgeber (Rn. 43). Dann gälten sofort
  die Meldepflichten des Art. 14 (auch für Versionen vor dem 11.12.2027, Art. 69 Abs. 3) und für jede ab dem
  11.12.2027 in Verkehr gebrachte Version alle Anforderungen (Konformitätsbewertung nach Modul A – interne Kontrolle –,
  weil der Prüfer zu keiner Kategorie der Anhänge III und IV gehört; EU-Konformitätserklärung, CE-Kennzeichnung).
* **Freiwillige Umsetzung:** Unabhängig davon sind die Anforderungen der Verordnung, soweit sie ohne Geschäftstätigkeit
  sinnvoll sind, bereits umgesetzt (Abschnitt 2). Nicht ausgestellt werden dürfen vor der Anwendbarkeit eine
  EU-Konformitätserklärung und die CE-Kennzeichnung (Art. 71 Abs. 2; Art. 30 Abs. 2 der Verordnung (EG) Nr. 765/2008);
  ein Entwurf liegt in `docs/CRA/EU-KONFORMITAETSERKLAERUNG-ENTWURF.md`.

## 2. Umsetzung im Überblick

| Anforderung | Umsetzung | Nachweis |
|---|---|---|
| Anhang I Teil I (wesentliche Sicherheitsanforderungen) | Abschnitt 4 | Testreihen, Check-Runs |
| Risikobewertung (Art. 13 Abs. 2) | Abschnitt 3 | – |
| Sorgfalt bei Komponenten Dritter (Art. 13 Abs. 5) | `docs/KOMPONENTEN.md`: Versionen, Lizenzen, Pflege, bekannte Schwachstellen, Integrität jeder Komponente | Testreihe `manifest`, Workflow `drift`, Check-Run „vulnerability scan“ |
| Meldung von Schwachstellen in Komponenten an deren Hersteller (Art. 13 Abs. 6) | `SECURITY.md` Abschnitt 2 | – |
| Dokumentation der Schwachstellen (Art. 13 Abs. 7) | `security/vex.json` → `vex.cdx.json` (CycloneDX VEX) und CSAF-VEX-Dokument | Testreihen `sbom`, `security` |
| Unterstützungszeitraum (Art. 13 Abs. 8, 19) | bis **Dezember 2031**; Hinweis in der Seite nach dessen Ende und bei gespeicherten Fassungen, die älter als sechs Monate sind | Testreihe `security-browser-*` |
| Informationen für Nutzer (Art. 13 Abs. 18, Anhang II) | `docs/BENUTZERINFORMATION.md`, in der Seite (Abschnitt „Sicherheit“) und als Seite ohne JavaScript | Testreihe `security` |
| Herstellerangaben (Art. 13 Abs. 16) | Name, Ort, E-Mail; Postanschrift wird nicht veröffentlicht (nicht kommerzielles Angebot, § 25 Abs. 5 MedienG) – bei Geschäftstätigkeit nachzutragen | Impressum |
| Technische Dokumentation (Anhang VII) | `docs/CRA/TECHNISCHE-DOKUMENTATION.md` | – |
| Meldepflichten (Art. 14) | Ablauf vorbereitet: `docs/CRA/MELDEVERFAHREN-ART14.md` | – |
| Anhang I Teil II (Schwachstellenbehandlung) | Abschnitt 5 | – |

## 3. Risikobewertung

| Bedrohung | Angriffsweg | Maßnahme | Nachweis | Restrisiko |
|---|---|---|---|---|
| Abfluss von Rechnungsdaten | Netzwerkzugriff der Seite | Content-Security-Policy `default-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`, kein Nachladen; `referrer` `no-referrer` | Testreihen `robustness-browser-*` (jede Anfrage aufgezeichnet) und `security-browser-*` (`fetch` und Bilder anderer Sites abgewiesen, bevor eine Anfrage das Netz erreicht) | Browser-Erweiterungen, Schadsoftware auf dem Gerät |
| Ausführung fremden Codes in der Seite (XSS) | HTML/Skript in Rechnungsinhalten, Dateinamen, Anlagen | Ausgabe nur als Text (`textContent`), kein HTML aus Zeichenketten; nur die Skripte der Seite laufen (SHA-256 jedes Skripts und Stils in der CSP, kein `'unsafe-inline'`, kein `'unsafe-eval'`); Trusted Types erzwungen (`require-trusted-types-for 'script'`, einzige Richtlinie `pruefer-xml` für `DOMParser` mit `application/xml`); der Build bricht bei Inline-Ereignissen, Stilattributen und Skripten mit Attributen ab | Testreihen `security` (Prüfsummen, keine Senken im Quelltext) und `security-browser-*` (Zeichenkette an `innerHTML` → `TypeError`, `eval` abgewiesen, eingeschleustes Skript läuft nicht) | Browser ohne Trusted Types (die CSP-Prüfsummen schützen weiterhin) |
| Schadsoftware in Anlagen | Anlagen der Rechnung (BG-24) und im PDF eingebettete Dateien | nie geöffnet; Einstufung nach Inhalt (Signaturen, ZIP-Inhaltsverzeichnis), Endung und angegebenem Typ: Programme, Skripte, HTML/SVG, Office mit Makros, Archive mit Programmen, Verknüpfungen, Datenträgerabbilder, PDF mit JavaScript oder Launch, EICAR-Testdatei → „Gefährlich“, Download erst nach zweitem Klick als „….gesperrt“; Office, Archive, RTF, abweichender Typ → „Vorsicht“ mit Begründung; sichere Dateinamen (keine Steuer- und Richtungszeichen, keine reservierten Windows-Namen) | Testreihen `security` (Einstufung, Dateinamen), `security-browser-*` (EICAR-Datei des ZUGFeRD-Korpus) | eine harmlos wirkende Datei mit unbekannter Schadsoftware; der Nutzer öffnet eine Datei trotz Warnung |
| Formeln in CSV-Exporten (CWE-1236) | Rechnungsdaten und Dateinamen in den CSV-Dateien | Zellen, die eine Tabellenkalkulation als Formel liest, beginnen mit einem Apostroph (seit 0.4.0; Sicherheitshinweis E-RECHNUNG-PRUEFER-SA-2026-001 für 0.2.0–0.3.1) | Testreihen `reports`, `security` (präparierte Rechnungen durch die ganze Verarbeitung) | CSV-Dateien aus älteren Versionen |
| Aktive Inhalte in PDF-Rechnungen | JavaScript, Start- und Zusatzaktionen | gemeldet (Prüfungen PDFA3-ACTIONS, PDFA3-AA, PDF-JAVASCRIPT, auch ohne lesbare Querverweistabelle); Sicherheitshinweis im Ergebnis und im Prüfprotokoll | Testreihe `pdfa3-container-checks` (synthetische PDFs), veraPDF-Vergleich, `security-browser-*` | das Öffnen der PDF in einem Programm mit aktiviertem JavaScript |
| Lesen lokaler Dateien | externe XML-Entitäten (XXE) | jede Dokumenttyp-Deklaration wird vor dem Parsen abgewiesen, wie im KoSIT-Validator | Testreihen `robustness`, `robustness-browser-*`, `kosit-official` | – |
| Hängen / Absturz | Entity-Expansion, tiefe Verschachtelung, PDF-Dekompressionsbomben, große Dateien | DOCTYPE abgewiesen; Tiefe > 5 000 abgewiesen; entpackte PDF-Ströme ≤ 64 MiB je Strom, ≤ 256 MiB je Dokument; Datei ≤ 100 MB | Testreihen `robustness`, `robustness-browser-*` | große gültige Dokumente bleiben langsam (nur der eigene Tab) |
| Manipulierte gespeicherte Regelwerke | ein anderes Dokument desselben Ursprungs schreibt in den Browserspeicher | gespeichert und verwendet nur, wenn byte-gleich mit der geprüften Fassung (SHA-256 in der Seite); sonst gelöscht und gemeldet | Testreihen `security-browser-*`, `peppol-import-*` | – |
| Falsches Ergebnis durch manipulierte Regelwerke oder Programmteile | Lieferkette (Quellen, Build) | Quellen festgelegt (Commit bzw. SHA-256, `build/STANDARDS_MANIFEST.json`), bei jedem Lauf geprüft; reproduzierbarer Build; Abgleich mit dem offiziellen KoSIT-Validator | Testreihen `manifest`, `engine-reproducible`, `build-reproducible`, `kosit-official` | Kompromittierung eines Quellprojekts vor dem Festlegen |
| Manipulierte Werkzeuge der Prüfumgebung | GitHub Actions, npm-Pakete, heruntergeladene Programme | Actions auf Commits festgelegt; Testwerkzeuge mit festen Versionen (package.json, Lockdatei), ohne Installationsskripte; OSV-Scanner nur mit geprüfter SHA-256; Anmeldedaten des Checkouts nicht gespeichert; geringste Rechte je Job; Dependabot mit sieben Tagen Wartezeit | Testreihe `sbom` (Festlegung), Workflow `security` (CodeQL für Workflows), OpenSSF Scorecard | Kompromittierung von GitHub selbst |
| Manipulierte Download-Datei | Verteilung | nur über HTTPS; Releases nur aus geprüften Commits (sieben Check-Runs); `SHA256SUMS.txt`; Herkunftsnachweis jeder veröffentlichten Datei (GitHub Artifact Attestation, Sigstore); Abruf und Byte-Vergleich jeder veröffentlichten Datei nach dem Deployment | Check-Runs „pages report“, „release report“ | Nutzer prüfen Prüfsumme oder Herkunft nicht |
| Bekannte Schwachstellen in Komponenten | Drittkomponenten und deren Vorläufer | Stückliste mit Herkunft (`sbom.cdx.json`), Bewertung in `security/vex.json`; OSV-Scanner bei jedem Push und wöchentlich (Programm und Prüfumgebung), unbewertete Funde des Programms brechen ab; wöchentlicher Versionsabgleich der Quellen (`drift.yml`) | Check-Runs „vulnerability scan“, „vulnerability scan (weekly)“, „drift report“ | eine Schwachstelle wird erst bekannt, wenn sie veröffentlicht ist |
| Versteckte Zeichen im Quelltext („Trojan Source“) | Richtungs- und Formatzeichen in Code und Texten | verboten; Escape-Sequenzen, wo Tests sie brauchen | Testreihe `security` | – |
| Geheimnisse im Repository | Zugangsdaten in Commits | keine Geheimnisse nötig (nur das Token der Workflows); Secret Scanning mit Push Protection; Prüfung der gesamten Historie mit gitleaks 8.30.1 am 21.10.2026: keine Funde | GitHub Secret Scanning | – |
| Veraltete Sicherheitsangaben | `security.txt` abgelaufen, Richtlinie nicht überprüft | Ablauf `Expires` höchstens ein Jahr; wöchentliche Prüfung (Ablauf in weniger als 30 Tagen → rot); jährliche Überprüfung der Richtlinie | Workflow `drift`, Testreihe `security` | – |

## 4. Anhang I Teil I

| | Anforderung | Umsetzung |
|---|---|---|
| (1) | angemessenes Cybersicherheitsniveau aufgrund der Risiken | Abschnitt 3 |
| (2 a) | ohne bekannte ausnutzbare Schwachstellen | OSV-Scanner bei jedem Push und wöchentlich; keine unbewertete bekannte Schwachstelle (`vex.cdx.json`) |
| (2 b) | sichere Standardkonfiguration | keine Konfiguration, keine Konten; Netzwerk gesperrt |
| (2 c) | Behebung durch Sicherheitsupdates | neue Version; GitHub Pages bei jedem Aufruf aktuell; gespeicherte Dateien: Hinweis nach sechs Monaten (keine automatische Aktualisierung, weil keine Netzwerkverbindung – bewusste Schutzmaßnahme) |
| (2 d) | Schutz vor unbefugtem Zugriff | keine Rechnungsdaten außerhalb des Browsertabs, keine Konten, keine Schnittstellen |
| (2 e) | Vertraulichkeit | Daten verlassen das Gerät nicht (CSP) |
| (2 f) | Integrität von Daten, Programm und Konfiguration | SHA-256 jeder geprüften Datei im Protokoll; Programm reproduzierbar; nur Skripte mit bekannter Prüfsumme laufen; gespeicherte Regelwerke nur unverändert |
| (2 g) | Datenminimierung | keine Erhebung; gespeichert werden nur selbst geladene Peppol-Regelwerke |
| (2 h) | Verfügbarkeit, Schutz gegen Überlastung | Grenzen und Tests (Abschnitt 3) |
| (2 i) | keine Beeinträchtigung anderer Geräte oder Netze | keine Netzwerkverbindung |
| (2 j) | geringe Angriffsfläche | eine statische Seite ohne Server, Erweiterungen und Nachladen |
| (2 k) | Folgen von Vorfällen begrenzen | Isolation des Browsertabs; Fehler je Datei abgefangen; gefährliche Anlagen gesperrt |
| (2 l) | Aufzeichnung sicherheitsrelevanter Vorgänge | nicht anwendbar (keine Konten, keine Daten außerhalb des Tabs); Sicherheitshinweise je Ergebnis im Prüfprotokoll |
| (2 m) | Daten sicher löschen | „Liste leeren“ bzw. Tab schließen; „Geladene Regelwerke löschen“ |

## 5. Anhang I Teil II

| | Anforderung | Umsetzung |
|---|---|---|
| (1) | Schwachstellen und Komponenten erfassen, Stückliste | `sbom.cdx.json` (CycloneDX 1.6 nach BSI TR-03183-2, Lieferumfang vollständig aufgelöst), `test-environment.cdx.json` (Prüfumgebung) |
| (2) | Schwachstellen unverzüglich beheben, Sicherheitsupdates nach Möglichkeit getrennt von Funktionsupdates | `SECURITY.md` Abschnitte 4 und 8 (Korrekturversion x.y.z+1) |
| (3) | regelmäßige Prüfungen | alle Testreihen bei jeder Änderung; CodeQL (Programm und Workflows); OSV-Scanner wöchentlich; OpenSSF Scorecard |
| (4) | Veröffentlichung behobener Schwachstellen | GitHub Security Advisories, CSAF 2.0 (`/.well-known/csaf/`), Seite „Sicherheitshinweise“, EUVD auf Antrag über CERT.at |
| (5) | Richtlinie zur koordinierten Offenlegung | `SECURITY.md`, Seite `cvd-policy/` ohne JavaScript |
| (6) | Austausch von Informationen über Schwachstellen erleichtern | `security.txt` (RFC 9116) mit Kontakt, Richtlinie und CSAF; CSAF und VEX maschinenlesbar |
| (7) | sichere Verteilung von Updates | HTTPS, Releases aus geprüften Commits, `SHA256SUMS.txt`, Herkunftsnachweise (Sigstore) |
| (8) | Sicherheitsupdates kostenlos, mit Hinweisen | kostenlos; Hinweise in CHANGELOG, Release und Sicherheitshinweis |

## 6. Gefundene und behobene Schwachstellen

| Kennung | Schwachstelle | betroffen | behoben | veröffentlicht |
|---|---|---|---|---|
| E-RECHNUNG-PRUEFER-SA-2026-001 | CSV-Formelinjektion in den CSV-Exporten (CWE-1236), CVSS 4.0: 5.1, CVSS 3.1: 6.1 | 0.2.0, 0.3.0, 0.3.1 | 0.4.0 | CSAF 2.0 mit 0.4.0; GitHub Security Advisory durch den Hersteller |

Vor der Veröffentlichung von 0.4.0 bei der unabhängigen Sicherheitsprüfung gefunden und behoben (keine veröffentlichte
Version betroffen, daher kein Sicherheitshinweis, TR-03183-3 4.4.10 a): Aktive Inhalte eines PDF ohne lesbare
Querverweistabelle wurden nicht erkannt; die Erkennung der EICAR-Testdatei war auf 128 Byte begrenzt.

## 7. Maßnahmen des Anbieters (Einstellungen des Repositorys)

Diese Schritte kann nur der Inhaber des Repositorys ausführen; der Stand wird über die API geprüft:

* Dependabot alerts und Dependabot security updates einschalten; Secret Scanning für generische Muster
  („non-provider patterns“) einschalten.
* Regelsatz für `main`: kein Force-Push, kein Löschen.
* Den öffentlichen Spiegel `pw-webkit-mirror` auf privat stellen (nicht Teil des Projekts).
* Optional: Benutzer-Repository `SerhiiAkhnazarov.github.io` mit `.well-known/security.txt` (gleicher Inhalt wie
  die Datei des Projekts), damit `security.txt` auch im Pfad `/.well-known/` der Domain liegt (RFC 9116) und die
  CSAF-Verteilung die Rolle „CSAF provider“ erfüllt (Anforderung 8).
* Den Sicherheitshinweis E-RECHNUNG-PRUEFER-SA-2026-001 als GitHub Security Advisory anlegen und veröffentlichen
  (über die Programmierschnittstelle nicht möglich).
* Bei Aufnahme einer Geschäftstätigkeit: Postanschrift in Impressum und Herstellerangaben, ein Postfach auf eigener
  Domain (CERT.at bestätigt Konten der Meldeplattform nicht für Freemail-Adressen), Registrierung auf der zentralen
  Meldeplattform der ENISA, Konformitätsbewertung (Modul A) vor dem 11.12.2027.
