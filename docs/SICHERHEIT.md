# Sicherheit und Verordnung (EU) 2024/2847 (Cyber Resilience Act)

Stand: **21.10.2026** (Version 0.3.1). Meldeweg für Schwachstellen: `SECURITY.md`.

## 1. Gilt die Verordnung für den E-Rechnung Prüfer?

### Rechtsgrundlagen (gelesen am 21.10.2026)

| Stelle | Inhalt | gelesen |
|---|---|---|
| Art. 2 Abs. 1 | gilt für Produkte mit digitalen Elementen, die **auf dem Markt bereitgestellt** werden und deren bestimmungsgemäßer oder vorhersehbarer Gebrauch eine direkte oder indirekte logische oder physische Datenverbindung mit einem Gerät oder Netz einschließt | Wiedergabe des Amtsblatttexts (springlex.eu, „Source: OJ L 2024/2847“) |
| Art. 3 Nr. 1 | Produkt mit digitalen Elementen: Software- oder Hardwareprodukt und seine Datenfernverarbeitungslösungen | dito |
| Art. 3 Nr. 13 | Hersteller: wer Produkte entwickelt und unter eigenem Namen vermarktet, „whether for payment, monetisation or free of charge“ | dito |
| Art. 3 Nr. 22 | Bereitstellung auf dem Markt: Abgabe zum Vertrieb oder zur Verwendung „**in the course of a commercial activity**, whether in return for payment or free of charge“ | dito |
| Erwägungsgründe 15 und 18 | Open-Source-Software fällt nur unter die Verordnung, wenn sie im Rahmen einer Geschäftstätigkeit bereitgestellt wird; nicht monetarisierte Open-Source-Software gilt nicht als Geschäftstätigkeit; Spenden ohne Gewinnerzielungsabsicht sind keine Geschäftstätigkeit | EUR-Lex (Erwägungsgründe) |
| Art. 4 Abs. 3 | unfertige Software, die der Verordnung nicht entspricht, darf nur für einen zum Testen nötigen begrenzten Zeitraum und mit sichtbarem Hinweis auf die Nichtkonformität bereitgestellt werden | springlex.eu |
| Art. 13 Abs. 8 | Unterstützungszeitraum mindestens fünf Jahre, kürzer nur bei kürzerer erwarteter Nutzungsdauer | springlex.eu |
| Art. 14 Abs. 1–4 | Meldung aktiv ausgenutzter Schwachstellen und schwerwiegender Vorfälle über die zentrale Meldeplattform an das koordinierende CSIRT und ENISA: Frühwarnung binnen 24 h, Meldung binnen 72 h nach Kenntnis; Abschlussbericht bei Schwachstellen spätestens 14 Tage, nachdem eine Korrektur oder Abhilfe verfügbar ist, bei Vorfällen binnen eines Monats nach der Meldung | springlex.eu |
| Art. 64 Abs. 10 | keine Geldbußen gegen Kleinst- und Kleinunternehmen wegen Versäumens der Frist für die Frühwarnung (Art. 14 Abs. 2 Buchst. a und Abs. 4 Buchst. a) | springlex.eu |
| Art. 69 Abs. 2, 3 | vor dem 11.12.2027 in Verkehr gebrachte Produkte nur bei wesentlicher Änderung ab diesem Tag; **Art. 14 gilt auch für sie** | springlex.eu |
| Art. 71 Abs. 2 | Anwendung ab **11.12.2027**; Art. 14 ab **11.09.2026**; Kapitel IV ab 11.06.2026 | springlex.eu |
| Leitlinien der Kommission C(2026) 5252 vom 27.07.2026 | Webanwendungen, die nur im Browser genutzt werden, sind in der Regel keine Produkte mit digitalen Elementen; heruntergeladene oder lokal installierte Software schon; das bloße Teilen von Quellcode in einem öffentlichen Repository ist in der Regel kein Inverkehrbringen; Monetarisierung (ein Preis für die Software oder für vorkompilierte Programme, eine kostenpflichtige Ausgabe, die Zugang, Unterstützung oder Leistung von einer Zahlung abhängig macht, eine Plattform zur Monetarisierung anderer Leistungen, Daten als Bedingung der Nutzung) macht die Bereitstellung zur Geschäftstätigkeit; jede Version gilt mit ihrer ersten Bereitstellung als in Verkehr gebracht; die Leitlinien sind nicht rechtsverbindlich | **nur Fachbeiträge** (Lewis Silkin 31.07.2026, GamingTechLaw 05.08.2026, cyberresilienceact.eu); das Dokument selbst (ec.europa.eu) war für das Werkzeug nicht abrufbar |

### Einordnung (Bewertung, keine Rechtsberatung)

* **Heute:** Der Prüfer ist freie Software (EUPL-1.2) eines Einzelentwicklers, ohne Preis, ohne kostenpflichtige
  Ausgabe oder Unterstützung, ohne Spenden, ohne Werbung und ohne Erhebung personenbezogener Daten. Nach dieser
  Bewertung wird er derzeit **nicht im Rahmen einer Geschäftstätigkeit** bereitgestellt (Art. 3 Nr. 22,
  Erwägungsgründe 15, 18); dann greifen die Pflichten der Verordnung nicht, auch die Meldepflicht des Art. 14 nicht.
  Ob die Seite auf GitHub Pages als bloße Webanwendung gilt (laut den Fachbeiträgen zu den Leitlinien in der Regel kein
  Produkt), ist zweifelhaft: Das Programm läuft vollständig auf dem Gerät des Nutzers und ist byte-gleich mit der
  herunterladbaren Datei aus den Releases, die Software im Sinne der Verordnung ist. Für die Bewertung kommt es daher
  allein auf die Geschäftstätigkeit an.
* **Sobald eine Geschäftstätigkeit hinzukommt** – Preis, kostenpflichtige Ausgabe oder Unterstützung, Vorbestellung,
  Nutzung des freien Werkzeugs als Plattform für entgeltliche Leistungen –, ist der Anbieter Hersteller (Art. 3 Nr. 13):
  * sofort die Meldepflichten des Art. 14 (anwendbar seit 11.09.2026, Art. 71 Abs. 2; nach Art. 69 Abs. 3 auch für vor
    dem 11.12.2027 in Verkehr gebrachte Versionen);
  * für jede ab dem 11.12.2027 in Verkehr gebrachte Version alle Anforderungen: Anhang I Teil I und II, Risikobewertung,
    technische Dokumentation (Anhang VII), Konformitätsbewertung – der Prüfer gehört zu keiner Kategorie der Anhänge
    III und IV, also interne Kontrolle (Modul A) –, EU-Konformitätserklärung (Anhang V), CE-Kennzeichnung,
    Informationen für Nutzer (Anhang II, darunter Name und Anschrift des Herstellers, Kontaktstelle für Schwachstellen,
    Ende des Unterstützungszeitraums), Unterstützungszeitraum (Art. 13 Abs. 8).
* **Testversionen** sind nicht ausgenommen: Nicht konforme unfertige Software darf nur befristet zu Testzwecken und mit
  sichtbarem Hinweis bereitgestellt werden (Art. 4 Abs. 3) – das betrifft nur Bereitstellungen im Rahmen einer
  Geschäftstätigkeit.

## 2. Risikobewertung

| Bedrohung | Angriffsweg | Maßnahme | Nachweis | Restrisiko |
|---|---|---|---|---|
| Abfluss von Rechnungsdaten | Netzwerkzugriff der Seite | Content-Security-Policy `default-src 'none'; connect-src 'none'; form-action 'none'`; kein Code von Dritten zur Laufzeit | `test/robustness-browser.cjs`: jede Anfrage der Seite wird aufgezeichnet (nur die Seite selbst); Testreihe e2e | Erweiterungen des Browsers, Schadsoftware auf dem Gerät |
| Ausführung fremden Codes | HTML/Skript in Rechnungsinhalten, Dateinamen, Anlagen | Ausgabe nur als Text (`textContent`), kein `innerHTML` mit Inhalten; Anlagen nur als Download | Code (`src/app.js`, Hilfsfunktion `h`) | – |
| Lesen lokaler Dateien | externe XML-Entitäten (XXE) | Browser laden keine externen Entitäten; Node-Umgebung (slimdom) ebenso | `test/run-robustness-tests.cjs`, `test/robustness-browser.cjs` (lokaler Server ohne Verbindung, kein Dateiinhalt im Ergebnis) | – |
| Hängen / Absturz (Verfügbarkeit) | Entity-Expansion, tiefe Verschachtelung, PDF-Dekompressionsbomben, sehr große Dateien | XML-Parser der Browser begrenzen die Expansion; Tiefe > 5 000 abgewiesen (`src/pruefer-core.js`, Grenze wie Chromium); PDF-Ströme ≤ 64 MiB, Dokument ≤ 256 MiB (`src/pdf-embedded.js`); Datei ≤ 100 MB (`src/app.js`) | Testreihen `robustness` (Node, Fuzzing) und `robustness-browser-*` (5 Browser) | sehr große, gültige Dokumente bleiben langsam (nur der eigene Tab) |
| Falsches Ergebnis durch manipulierte Regelwerke | Lieferkette (Quellen, Build) | Quellen mit Commit und SHA-256 (`build/STANDARDS_MANIFEST.json`), Prüfung bei jedem Lauf (Testreihe `manifest`); reproduzierbarer Build (`programSha256`); Abgleich mit dem offiziellen KoSIT-Validator | Check-Runs „verification report“, „platform comparison“, „KoSIT JAR vs. Maven Central“ | Kompromittierung eines Quellprojekts vor dem Festlegen |
| Manipulierte Download-Datei | Verteilung | Releases nur aus geprüften Commits (`release.yml` verlangt alle Check-Runs), `SHA256SUMS.txt`, die Datei ist byte-gleich mit der Seite | Check-Run „pages report“, Release-Workflow | Nutzer prüfen die Prüfsumme nicht |
| Bekannte Schwachstellen in Komponenten | Drittkomponenten | Stückliste `sbom.cdx.json`; Komponenten festgelegt; wöchentliche Prüfung neuer Regelwerksstände (`drift.yml`) | Testreihe `sbom` | Schwachstellen in Komponenten werden über deren Projekte bekannt |

## 3. Abgleich mit Anhang I

Teil I (Sicherheitsanforderungen an das Produkt):

| | Anforderung | Stand |
|---|---|---|
| (a) | ohne bekannte ausnutzbare Schwachstellen | keine bekannt; Meldeweg `SECURITY.md` |
| (b) | sichere Standardkonfiguration | keine Konfiguration, keine Konten; Netzwerk gesperrt |
| (c) | Behebung durch Sicherheitsupdates | neue Version (Release, Seite); keine automatische Aktualisierung der heruntergeladenen Datei – Hinweis in `SECURITY.md` |
| (d) | Schutz vor unbefugtem Zugriff | keine Daten außerhalb des Browsertabs, keine Konten, keine Schnittstellen |
| (e) | Vertraulichkeit | Daten verlassen das Gerät nicht (CSP) |
| (f) | Integrität | Prüfsummen (SHA-256) jeder geprüften Datei im Protokoll; Programm reproduzierbar |
| (g) | Datenminimierung | keine Erhebung, keine Speicherung |
| (h) | Verfügbarkeit, Schutz gegen Überlastung | Grenzen und Tests (Abschnitt 2) |
| (i) | keine Beeinträchtigung anderer Geräte/Netze | keine Netzwerkverbindung |
| (j) | geringe Angriffsfläche | eine statische Seite, keine Erweiterungen, keine Nachladungen |
| (k) | Folgen von Vorfällen begrenzen | Isolation des Browsertabs; Fehler je Datei abgefangen |
| (l) | Aufzeichnung sicherheitsrelevanter Vorgänge | nicht anwendbar (keine Konten, keine Daten außerhalb des Tabs) |
| (m) | Daten sicher löschen | „Liste leeren“ bzw. Tab schließen; nichts wird gespeichert |

Teil II (Umgang mit Schwachstellen): (1) Stückliste `sbom.cdx.json` – erfüllt; (2) Korrektur ohne Verzögerung – Ziele
in `SECURITY.md`; (3) regelmäßige Tests – jede Änderung durchläuft alle Testreihen (Check-Runs); (4) Veröffentlichung
behobener Schwachstellen – GitHub Security Advisories; (5) Richtlinie zur koordinierten Offenlegung – `SECURITY.md`;
(6) Kontaktadresse – vertrauliche Meldung über GitHub (vom Betreiber in den Einstellungen freizuschalten: „Private
vulnerability reporting“); (7) sichere Verteilung – Releases mit `SHA256SUMS.txt` aus geprüften Commits, HTTPS;
(8) Updates kostenlos – ja.

## 4. Offen – erst bei Geschäftstätigkeit erforderlich, Entscheidungen des Betreibers

* Unterstützungszeitraum festlegen und angeben (Art. 13 Abs. 8: mindestens fünf Jahre, sonst die erwartete
  Nutzungsdauer).
* Herstellerangaben nach Anhang II (Name, Anschrift, E-Mail oder andere digitale Kontaktmöglichkeit).
* Technische Dokumentation nach Anhang VII (Grundlage: dieses Dokument, `docs/`, Check-Runs), EU-Konformitätserklärung
  (Anhang V), CE-Kennzeichnung.
* Meldeweg nach Art. 14 einrichten (zentrale Meldeplattform der ENISA, koordinierendes CSIRT des Mitgliedstaats der
  Hauptniederlassung).
