# Informationen für Nutzer: Sicherheit, Unterstützung, Herstellerangaben

Stand: 21.10.2026. Gliederung nach Anhang II der Verordnung (EU) 2024/2847 (Cyber Resilience Act). Die Verordnung ist
auf den E-Rechnung Prüfer derzeit nicht anwendbar (nicht kommerzielle freie Software); die Angaben werden trotzdem
vollständig gemacht. Einordnung: https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/blob/main/docs/SICHERHEIT.md.

## 1. Hersteller

Serhii Akhnazarov, Wien, Österreich – E-Mail ahnazarovser@gmail.com – Website
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/. Eine Postanschrift wird nicht veröffentlicht (nicht
kommerzielles Angebot, Offenlegung nach § 25 Abs. 5 MedienG: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/impressum/).

## 2. Kontaktstelle für Schwachstellen

Meldungen über Schwachstellen – vertraulich über GitHub
(https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories/new) oder per E-Mail an
ahnazarovser@gmail.com. Alle Wege und Fristen: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-contact/.
Richtlinie zur koordinierten Offenlegung: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/cvd-policy/.
Veröffentlichte Sicherheitshinweise: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/advisories/ (maschinenlesbar
im CSAF-2.0-Format und als GitHub Security Advisories: https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories).

## 3. Produkt

**E-Rechnung Prüfer**, eine einzelne HTML-Datei (`E-Rechnung-Pruefer.html`), die im Browser läuft. Eindeutig bestimmt
durch die Version und die SHA-256-Prüfsumme des Programms: Fußzeile der Seite, Abschnitt „Regelwerke, Schemata und
Versionen“, `BUILD_INFO.json` (Felder `version`, `programSha256`, `commit`) und `SHA256SUMS.txt` jedes Releases.

## 4. Zweckbestimmung und Sicherheitseigenschaften

Zweck: technische Prüfung elektronischer Rechnungen (XRechnung, ZUGFeRD / Factur-X, EN 16931) nach den offiziellen
Regelwerken, mit umsatzsteuerlicher Einordnung der Befunde (Deutschland). Das Ergebnis ist keine Steuer- oder
Rechtsberatung.

Sicherheitsumgebung: ein aktueller Browser (Chromium-basiert wie Microsoft Edge und Google Chrome, Firefox, Safari).
Wesentliche Sicherheitseigenschaften:

- **Keine Netzwerkverbindungen:** Die Content-Security-Policy der Seite verbietet jede Verbindung, jedes Nachladen und
  jedes Formular (`default-src 'none'`, `connect-src 'none'`, `form-action 'none'`); Rechnungen verlassen das Gerät nicht.
- **Kein fremder Code:** Nur die Skripte der Seite selbst laufen (Prüfsummen in der Content-Security-Policy). Inhalte
  von Rechnungen, Dateinamen und Anlagen werden nur als Text dargestellt; der Browser erzwingt das mit Trusted Types.
- **Keine Speicherung von Rechnungen:** Geprüfte Dateien bleiben nur im geöffneten Tab. Gespeichert werden nur selbst
  geladene Peppol-Regelwerke, und nur, wenn sie der geprüften Fassung entsprechen.
- **Schutz vor feindlichen Dateien:** Dokumenttyp-Deklarationen (DOCTYPE) werden abgewiesen wie beim KoSIT-Validator,
  Verschachtelung, entpackte PDF-Datenströme und Dateigröße sind begrenzt.
- **Warnung vor aktiven Inhalten:** JavaScript, Startaktionen und Zusatzaktionen in PDF-Dateien werden gemeldet; Anlagen,
  die beim Öffnen Code ausführen können, bietet der Prüfer nur nach einer zweiten Bestätigung und unter einem Namen mit
  der Endung `.gesperrt` an.

## 5. Bekannte und vorhersehbare Risiken

- **Anlagen öffnen:** Der Prüfer öffnet keine Anlage. Eine heruntergeladene Anlage kann Schadsoftware enthalten, auch
  wenn sie nicht als gefährlich markiert ist. Öffnen Sie Anlagen nur von vertrauenswürdigen Absendern und im Zweifel
  nach einer Prüfung durch einen Virenscanner.
- **PDF-Rechnungen öffnen:** Eine PDF-Rechnung mit JavaScript sollte nur in einem PDF-Programm geöffnet werden, in dem
  JavaScript abgeschaltet ist.
- **CSV-Dateien:** Der Prüfer schreibt Zellen, die eine Tabellenkalkulation als Formel ausführen würde, mit einem
  vorangestellten Apostroph als Text. Öffnen Sie CSV-Dateien aus anderen Quellen nicht ungeprüft.
- **Gerät und Browser:** Browser-Erweiterungen mit Zugriff auf alle Websites können die geöffneten Rechnungen lesen.
  Heruntergeladene Berichte und Anlagen bleiben im Download-Ordner, bis Sie sie löschen – auf gemeinsam genutzten Geräten
  bitte daran denken.
- **Veränderte Kopien:** Eine bearbeitete oder aus einer anderen Quelle stammende Kopie der Datei hat eine andere
  Prüfsumme; für sie gelten diese Angaben nicht. Laden Sie den Prüfer nur von den Adressen unter Nr. 8.
- **Veraltete Kopien:** Eine gespeicherte Datei aktualisiert sich nicht selbst (siehe Nr. 7).

## 6. EU-Konformitätserklärung

Nicht ausgestellt. Die Verordnung (EU) 2024/2847 gilt für den Prüfer derzeit nicht, und eine Konformitätserklärung oder
CE-Kennzeichnung nach dieser Verordnung ist vor ihrer Anwendbarkeit nicht zulässig (Art. 71 Abs. 2 der Verordnung,
Art. 30 Abs. 2 der Verordnung (EG) Nr. 765/2008).

## 7. Unterstützung und Sicherheitsupdates

Sicherheitsupdates erscheinen kostenlos als neue Version, nach Möglichkeit als reine Korrekturversion ohne neue
Funktionen. Unterstützt wird die jeweils neueste Version; ältere Versionen werden durch die kostenlose Aktualisierung auf
die neueste Version unterstützt. **Ende des Unterstützungszeitraums: Dezember 2031.** Danach weist die Seite beim Öffnen
darauf hin, dass sie keine Sicherheitsupdates mehr erhält.

## 8. Anleitungen

**Sichere Inbetriebnahme und Verwendung:** Rufen Sie den Prüfer unter https://serhiiakhnazarov.github.io/e-rechnung-pruefer/
auf oder laden Sie die Datei aus den Releases (https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/releases/latest)
und vergleichen Sie ihre SHA-256-Prüfsumme mit `SHA256SUMS.txt`; mit der GitHub-Befehlszeile prüft
`gh attestation verify E-Rechnung-Pruefer.html -R SerhiiAkhnazarov/e-rechnung-pruefer` zusätzlich die Herkunft (ohne
Abruf über die GitHub-API mit `--bundle E-Rechnung-Pruefer-<Version>.intoto.jsonl` aus dem Release). Es sind keine
Einstellungen, Konten oder Installationen nötig.

**Änderungen und Datensicherheit:** Verändern Sie die Datei nicht; eine geänderte Datei verliert die Prüfsummen ihrer
Skripte und damit den Schutz der Content-Security-Policy – oder sie läuft nicht mehr.

**Sicherheitsupdates installieren:** Auf GitHub Pages genügt das Neuladen der Seite. Eine gespeicherte Datei ersetzen
Sie durch die neueste Datei aus den Releases. Ist eine gespeicherte Fassung älter als sechs Monate, weist die Seite
darauf hin.

**Automatische Updates abschalten:** entfällt – der Prüfer baut keine Netzwerkverbindung auf und aktualisiert sich daher
nicht automatisch; das ist eine bewusste Schutzmaßnahme für die Vertraulichkeit der Rechnungen.

**Sicher außer Betrieb nehmen und Daten löschen:** „Liste leeren“ oder den Tab schließen entfernt die geprüften
Rechnungen; „Geladene Regelwerke löschen“ entfernt selbst geladene Peppol-Regelwerke aus dem Browser; heruntergeladene
Berichte und Anlagen löschen Sie im Download-Ordner, eine gespeicherte Programmdatei wie jede andere Datei. Danach
bleiben keine Daten des Prüfers auf dem Gerät; die Websitedaten lassen sich zusätzlich in den Einstellungen des Browsers
löschen.

**Integration in andere Produkte:** nicht vorgesehen. Wer den Quellcode in ein eigenes Produkt übernimmt, findet die
Grundlagen in der technischen Dokumentation:
https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/blob/main/docs/CRA/TECHNISCHE-DOKUMENTATION.md.

## 9. Stückliste (SBOM)

Die Software-Stückliste steht mit jeder Version bereit: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/sbom.cdx.json
(CycloneDX 1.6 nach BSI TR-03183-2) und in jedem Release; die Bewertung bekannter Schwachstellen der Komponenten:
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/vex.cdx.json (CycloneDX VEX) und als CSAF-VEX-Dokument unter
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/advisories/.
