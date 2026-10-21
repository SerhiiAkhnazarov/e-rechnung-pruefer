# Sicherheit – Schwachstellen melden

## Schwachstelle melden

Bitte **nicht** als öffentliches Issue. Vertraulich über GitHub:

**https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories/new** („Report a vulnerability“)

Hilfreich sind: Version (Fußzeile der Seite oder `BUILD_INFO.json`), Browser und Betriebssystem, eine möglichst
kleine Datei, die das Verhalten auslöst, und die Schritte, die dazu führen. Rechnungen mit echten Daten bitte vorher
schwärzen.

| Schritt | Ziel |
|---|---|
| Eingangsbestätigung | innerhalb von 7 Tagen |
| erste Bewertung (betroffen? Schweregrad nach CVSS 4.0) | innerhalb von 14 Tagen |
| Korrektur von Schwachstellen mit Schweregrad „kritisch“ oder „hoch“ | innerhalb von 30 Tagen; übrige Schwachstellen mit der nächsten Version |
| Veröffentlichung | GitHub Security Advisory nach der Korrektur (mit CVE, wo angebracht); Nennung des Melders auf Wunsch |

Koordinierte Offenlegung: Wir bitten, Einzelheiten erst nach der Korrektur oder 90 Tage nach der Meldung zu
veröffentlichen – je nachdem, was zuerst eintritt; früher nur, wenn die Schwachstelle bereits aktiv ausgenutzt wird.

## Unterstützte Versionen

Unterstützt wird nur die jeweils **neueste Version** (Releases und die Seite auf GitHub Pages). Die Aktualisierung ist
kostenlos, aber nicht automatisch: die neue Datei `E-Rechnung-Pruefer.html` aus den Releases herunterladen bzw. die
Seite neu laden. Ältere Versionen
erhalten keine Korrekturen.

## Was in den Geltungsbereich fällt

* die Seite `E-Rechnung-Pruefer.html` (Releases, GitHub Pages) und der Quellcode dieses Repositorys,
* der Build- und Prüfweg (Quellen, Workflows, Reproduzierbarkeit) – Manipulationen der Lieferkette,
* Dateien, die das Werkzeug zum Absturz bringen, hängen lassen oder dazu bringen, Daten nach außen zu geben oder fremden
  Code auszuführen.

Nicht hierher gehören fachliche Fragen der Prüfung oder der umsatzsteuerlichen Einordnung (bitte als Issue) und
Schwachstellen in Komponenten Dritter selbst (bitte beim jeweiligen Projekt melden; die betroffene Komponente wird hier
aktualisiert – Liste der Komponenten: `sbom.cdx.json`, `NOTICE` Teil A).

## Sicherheitseigenschaften

* **Keine Netzwerkverbindung:** Die Seite verbietet per Content-Security-Policy jede Verbindung (`connect-src 'none'`,
  `default-src 'none'`, `form-action 'none'`); keine Cookies, keine Telemetrie, keine Rechnungsdaten an Dritte. Geprüft
  wird nur im Browser. (Beim Abruf der Seite über GitHub Pages protokolliert GitHub die IP-Adresse der Besucher –
  `legal/datenschutz.txt`.)
* **Keine Ausführung von Inhalten:** Inhalte der Rechnung werden als Text dargestellt, nie als HTML.
* **Feindliche Dateien:** Dokumente mit Dokumenttyp-Deklaration (DOCTYPE) werden vor dem Parsen abgewiesen – wie im
  KoSIT-Validator (`disallow-doctype-decl`); Entity-Expansion und externe Entitäten erreichen damit keinen XML-Parser.
  Grenzen für Verschachtelung (5 000 Ebenen), entpackte PDF-Datenströme (64 MiB je Strom, 256 MiB je Dokument) und
  Dateigröße (100 MB). Nachweis: `test/robustness-browser.cjs` in Chromium, WebKit, Firefox, Edge und Chrome,
  `test/run-robustness-tests.cjs` mit Mutations-Fuzzing, Vergleich mit dem offiziellen KoSIT-Validator (Check-Run
  „verification report“; Edge und Chrome: „Windows report“).
* **Lieferkette:** Jede Quelle ist festgelegt – Git-Quellen mit Commit, heruntergeladene Dateien mit SHA-256
  (`build/STANDARDS_MANIFEST.json`); die Seite ist reproduzierbar gebaut (`programSha256`), jede hochgeladene Datei
  eines Releases steht mit SHA-256 in `SHA256SUMS.txt`.
* **Stückliste:** `sbom.cdx.json` (CycloneDX 1.6) – auf GitHub Pages und in jedem Release.

Einordnung nach der Verordnung (EU) 2024/2847 (Cyber Resilience Act), Risikobewertung und Abgleich mit Anhang I:
`docs/SICHERHEIT.md`.

---

**English:** Please report vulnerabilities privately via
https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories/new – not as a public issue. We aim to
acknowledge within 7 days, assess within 14 days and fix critical and high issues within 30 days, then publish a
GitHub Security Advisory (coordinated disclosure: please wait for the fix or 90 days). Only the latest version is
supported; updating is free. The page makes no network connections (CSP `connect-src 'none'`). The SBOM
(`sbom.cdx.json`, CycloneDX 1.6) is published with the page and every release.
