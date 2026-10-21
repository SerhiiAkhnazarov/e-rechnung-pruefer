# Richtlinie zur koordinierten Offenlegung von Schwachstellen

**Stand: 21.10.2026** (zuletzt geändert am 21.10.2026; erste Fassung 20.10.2026). Diese Richtlinie wird mindestens
einmal jährlich überprüft, spätestens bis Oktober 2027.

Herausgeber und Hersteller des E-Rechnung Prüfers: **Serhii Akhnazarov, Wien, Österreich** – E-Mail
ahnazarovser@gmail.com – Website https://serhiiakhnazarov.github.io/e-rechnung-pruefer/ (Impressum:
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/impressum/).

Diese Richtlinie folgt ISO/IEC 29147:2018 (Abschnitt 9: Kontakt, Inhalt einer Meldung, sichere Kommunikation,
Erwartungen, Geltungsbereich, Veröffentlichung, Anerkennung), ISO/IEC 30111:2019 und der BSI TR-03183-3 v1.0.0
(Abschnitt 4.4). Abweichungen von der TR-03183-3 und ihre Gründe stehen am Ende.

## 1. Schwachstelle melden

Bitte **nicht** als öffentliches Issue. Wege, in dieser Reihenfolge empfohlen:

1. **Vertraulich über GitHub** („Private vulnerability reporting“, nur für den Hersteller sichtbar, Übertragung
   verschlüsselt): https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories/new – „Report a
   vulnerability“. Dafür ist ein GitHub-Konto nötig.
2. **Per E-Mail** an ahnazarovser@gmail.com, Betreff „Schwachstelle E-Rechnung Prüfer“. Verschlüsselte E-Mail
   (OpenPGP) ist derzeit nicht möglich; senden Sie vertrauliche Einzelheiten deshalb bevorzugt über den Weg 1 oder
   kündigen Sie sie per E-Mail an, damit wir einen sicheren Weg vereinbaren.
3. **Anonym:** per E-Mail von einer beliebigen Adresse. Anonyme Meldungen können nur eingeschränkt oder gar nicht
   bearbeitet werden, weil keine Rückfragen möglich sind.

Die Seite mit allen Angaben zur Meldung: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-contact/
(auch ohne JavaScript lesbar; `security.txt`: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/.well-known/security.txt).

Hilfreich sind: Version (Fußzeile der Seite, `BUILD_INFO.json`), Browser und Betriebssystem, eine möglichst kleine
Datei, die das Verhalten auslöst, die Schritte dorthin, die erwartete und die beobachtete Wirkung. Rechnungen mit echten
Daten bitte vorher schwärzen. Meldungen nehmen wir auf Deutsch und Englisch entgegen.

## 2. Was als Schwachstelle gilt

Als Schwachstelle behandeln wir eine Eigenschaft des E-Rechnung Prüfers (der Seite `E-Rechnung-Pruefer.html` auf
GitHub Pages und in den Releases, ihrer statischen Begleitseiten und des Build- und Prüfwegs dieses Repositorys), die es
erlaubt,

- Rechnungsdaten oder andere Daten des Nutzers nach außen zu übertragen oder auf lokale Dateien zuzugreifen,
- fremden Code im Zusammenhang der Seite auszuführen oder die Seite zu manipulieren (z. B. über eine präparierte
  Rechnung, einen Dateinamen, eine Anlage, ein geladenes Regelwerk),
- über die vom Prüfer erzeugten Dateien (CSV, JSON, PDF, Anlagen) Schaden anzurichten, etwa durch Formeln in CSV-Zellen
  oder verschleierte Dateiendungen,
- die Seite dauerhaft zum Absturz oder zum Hängen zu bringen, über die dokumentierten Grenzen hinaus
  (https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/blob/main/docs/SICHERHEIT.md),
- das Prüfergebnis unbemerkt zu verfälschen, etwa durch Manipulation der Lieferkette (Quellen, Workflows, Build).

Die Meldung soll sich auf nicht öffentlich bekannte Informationen beziehen. Reine Ergebnisse automatischer Scanner ohne
Beleg einer Auswirkung nehmen wir entgegen, bearbeiten sie aber nachrangig.

Keine Schwachstellen sind fachliche Fragen der Prüfung oder der umsatzsteuerlichen Einordnung (bitte als Issue:
https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/issues) und Schwachstellen in Komponenten Dritter selbst – diese
bitte beim jeweiligen Projekt melden; wir aktualisieren die betroffene Komponente und melden Fundstellen in Komponenten
an deren Hersteller (Art. 13 Abs. 6 der Verordnung (EU) 2024/2847). Liste der Komponenten: `sbom.cdx.json`,
https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/blob/main/docs/KOMPONENTEN.md.

## 3. Unsere Zusagen

- **Vertraulichkeit:** Jede Meldung wird, soweit gesetzlich zulässig, vertraulich behandelt. Ausgenommen sind die
  Angaben, die für die Veröffentlichung der behobenen Schwachstelle nötig sind (Abschnitt 5).
- **Personenbezogene Daten** der meldenden Person geben wir ohne deren ausdrückliche Zustimmung nicht an Dritte weiter
  (Datenschutz: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/datenschutz/).
- **Keine rechtlichen Schritte:** Gegen Personen, die sich an diese Richtlinie halten, leiten wir keine rechtlichen
  Schritte ein und stellen keine Strafanträge oder Ermächtigungen zur Strafverfolgung. Das gilt nicht, wenn erkennbar
  kriminelle Absichten verfolgt werden. Der Prüfer läuft vollständig im eigenen Browser; zum Testen ist kein Zugriff
  auf fremde Systeme nötig – bitte prüfen Sie nur mit eigenen Kopien.
- **Keine Geheimhaltungsvereinbarung:** Wir verlangen keine NDA.
- **Ansprechbarkeit:** Wir stehen während des gesamten Vorgangs für einen vertrauensvollen Austausch zur Verfügung.
  Fragen zum Stand einer Meldung sind jederzeit willkommen.
- **Anerkennung:** Auf Wunsch nennen wir Name oder Pseudonym und einen Verweis der meldenden Person nach Abschluss in den
  Danksagungen: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-acknowledgements/.

## 4. Ablauf und Fristen

| Schritt | Frist |
|---|---|
| Eingangsbestätigung durch einen Menschen (keine automatische Antwort) | innerhalb von 5 Arbeitstagen |
| Ausführliche Rückmeldung: Schwachstelle bestätigt oder abgelehnt, gezielte Rückfragen oder Begründung, warum die Prüfung länger dauert, mit neuem Termin innerhalb von 10 Arbeitstagen | innerhalb von 10 Arbeitstagen |
| Bewertung des Schweregrads | nach CVSS 4.0 |
| Korrektur kritischer und hoher Schwachstellen | ohne unangemessene Verzögerung, Ziel 30 Tage; übrige mit der nächsten Version |
| Veröffentlichung der behobenen Schwachstelle | nach der Korrektur, spätestens 90 Tage nach Bestätigung der Schwachstelle |

Arbeitstage sind die Werktage Montag bis Freitag außer den gesetzlichen Feiertagen in Wien.

Auch Hinweise auf bereits behobene Schwachstellen nehmen wir entgegen und prüfen sie. Als Kontaktmöglichkeit für
Rückfragen akzeptieren wir E-Mail-Adressen und Telefonnummern; bitte geben Sie mindestens eine an. Wir gehen
respektvoll miteinander um; Diskriminierung, Sexismus oder Beleidigungen haben keinen Platz. Komplexe Sachverhalte
können weitere Erläuterungen erfordern; bleiben Rückfragen unbeantwortet, kann eine Meldung nur eingeschränkt oder gar
nicht bearbeitet werden.

**Aktiv ausgenutzte Schwachstellen:** Wird eine Schwachstelle des Prüfers aktiv ausgenutzt, informieren wir ohne
unangemessene Verzögerung das nationale CSIRT Österreichs, CERT.at (https://www.cert.at/), stimmen mit ihm alle neuen
Informationen, Abhilfemaßnahmen und deren Zeitplan ab und informieren die Nutzer (Abschnitt 5). Sobald die Verordnung
(EU) 2024/2847 auf den Prüfer anwendbar ist, gelten zusätzlich die Meldepflichten ihres Art. 14 über die zentrale
Meldeplattform der ENISA (Ablauf: https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/blob/main/docs/CRA/MELDEVERFAHREN-ART14.md).

## 5. Veröffentlichung

Bestätigte und behobene Schwachstellen veröffentlichen wir innerhalb von 90 Tagen, es sei denn, sie wurden vor der
Veröffentlichung der betroffenen Version behoben. Gibt es einen triftigen Grund für eine längere Behebung, kann die Frist
einmal um weitere 90 Tage verlängert werden – in Abstimmung mit CERT.at; weitere Verlängerungen nur durch CERT.at.

Die Veröffentlichung enthält eine Beschreibung der Schwachstelle, die betroffenen und die behobenen Versionen, die
Auswirkung, den Schweregrad (CVSS 4.0; im CSAF-2.0-Dokument, das nur CVSS bis Version 3.1 kennt, CVSS 3.1) und klare
Hinweise zur Abhilfe:

- als **GitHub Security Advisory** (mit CVE-Kennung, wo angebracht):
  https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories,
- als **CSAF-2.0-Dokument** (OASIS Common Security Advisory Framework, Profil „Security Advisory“), wie von BSI und
  CERT.at empfohlen – Übersicht: https://serhiiakhnazarov.github.io/e-rechnung-pruefer/advisories/, maschinenlesbar:
  https://serhiiakhnazarov.github.io/e-rechnung-pruefer/.well-known/csaf/provider-metadata.json (Rolle „CSAF
  publisher“; Prüfsummen SHA-256 und SHA-512 je Dokument, keine OpenPGP-Signaturen),
- in der **European Vulnerability Database (EUVD)** der ENISA – auf Antrag über CERT.at bzw. die ENISA,
- im CHANGELOG und in den Release-Hinweisen der korrigierten Version.

Die Bewertung von Schwachstellen in Komponenten, aus denen der Prüfer abgeleitet ist, steht maschinenlesbar als
CSAF-VEX-Dokument (im selben Verzeichnis) und als `vex.cdx.json` (CycloneDX VEX) auf GitHub Pages und in jedem Release.

## 6. Wann ein Vorgang abgeschlossen ist

Ein Vorgang ist abgeschlossen, wenn

- die Meldung unbegründet ist (keine Schwachstelle im Sinne von Abschnitt 2), oder
- die Schwachstelle durch eine neue Version behoben und veröffentlicht ist (Abschnitt 5), oder
- die meldende Person 30 Tage lang nicht auf technische oder inhaltliche Rückfragen antwortet, oder
- die Schwachstelle öffentlich bekannt ist und in Abstimmung mit CERT.at nicht mehr mit einer Behebung zu rechnen ist.

Den Abschluss teilen wir der meldenden Person ohne unangemessene Verzögerung mit, außer bei anonymen Meldungen.

## 7. Verhaltensregeln für Meldende

Bitte keine Angriffe auf andere Personen, Systeme oder Konten, keine Veränderung fremder Daten, keine Weitergabe oder
kein Verkauf von Ausnutzungscode vor der Veröffentlichung, keine Beleidigungen. Meldungen von Personen, die sich nicht
daran halten, bearbeiten wir trotzdem bestmöglich; eine Nennung in den Danksagungen entfällt dann.

## 8. Unterstützte Versionen und Sicherheitsupdates

Unterstützt wird die jeweils **neueste Version** (GitHub Pages und das neueste Release). Sicherheitsupdates erscheinen
kostenlos als neue Version, nach Möglichkeit als reine Korrekturversion (z. B. 0.4.1) ohne neue Funktionen. Ältere
Versionen erhalten keine Korrekturen; die Aktualisierung auf die neueste Version ist jederzeit kostenlos möglich
(Art. 13 Abs. 10 der Verordnung (EU) 2024/2847). Der **Unterstützungszeitraum** reicht mindestens bis **Dezember 2031**.

Die Seite auf GitHub Pages ist bei jedem Aufruf die neueste Version. Eine heruntergeladene oder gespeicherte Datei
aktualisiert sich nicht von selbst, weil der Prüfer keine Netzwerkverbindung aufbaut; die Seite weist auf das Ende des
Unterstützungszeitraums hin und darauf, dass eine gespeicherte Fassung älter als sechs Monate ist. Jede Datei eines
Releases ist mit SHA-256 in `SHA256SUMS.txt` aufgeführt und mit einer Herkunftsbescheinigung (GitHub Artifact
Attestation, Sigstore) versehen; Prüfung: `gh attestation verify E-Rechnung-Pruefer.html -R SerhiiAkhnazarov/e-rechnung-pruefer`.

## 9. Abweichungen von der BSI TR-03183-3

Die Technische Richtlinie ist nicht verbindlich. Der Prüfer ist ein nicht kommerzielles Projekt eines Einzelentwicklers
auf statischem Hosting (GitHub Pages); daraus folgen diese Abweichungen:

- **Getrennte Funktionspostfächer für PSIRT und CSIRT, OpenPGP-Schlüssel und signierte `security.txt`** (4.2.4, 4.2.10,
  4.3.1): vorerst ein Postfach ohne OpenPGP; vertrauliche Übertragung über GitHub (TLS). Die Rollen liegen bei einer
  Person (bei Kleinstunternehmen zulässig, 4.3.1 b).
- **Webformular für anonyme Meldungen** (4.3.3): statisches Hosting ohne Server; anonyme Meldungen per E-Mail von einer
  beliebigen Adresse, das GitHub-Formular verlangt ein Konto.
- **Zweitprüfung jeder Meldung** (4.4.7 g): als Einzelentwickler nicht möglich; keine Meldung wird ohne Bearbeitung und
  dokumentierte Begründung geschlossen.
- **`security.txt` im Pfad `/.well-known/` der Domain** (4.2.1): Die Seite liegt unter einem Projektpfad von
  `serhiiakhnazarov.github.io`; die Datei liegt im Projekt (`/e-rechnung-pruefer/.well-known/security.txt`) und – sobald
  das Benutzer-Repository `SerhiiAkhnazarov.github.io` eingerichtet ist – in `/.well-known/security.txt` der Domain.

---

## English summary

Please report vulnerabilities privately via
https://github.com/SerhiiAkhnazarov/e-rechnung-pruefer/security/advisories/new or by e-mail to ahnazarovser@gmail.com –
not as a public issue. We confirm receipt (by a human) within 5 working days and give detailed feedback within 10
working days; critical and high issues are fixed without undue delay (target 30 days); fixed vulnerabilities are
disclosed within 90 days as a GitHub Security Advisory, as a CSAF 2.0 document and, via CERT.at, in the EUVD. We do
not require an NDA and take no legal action against anyone acting in good faith under this policy. Actively exploited
vulnerabilities are coordinated with CERT.at (https://www.cert.at/). Only the latest version is supported; security
updates are free, the support period runs at least until December 2031. The page makes no network connections (CSP
`connect-src 'none'`). The SBOM (`sbom.cdx.json`, CycloneDX 1.6, BSI TR-03183-2) and the VEX document (`vex.cdx.json`)
are published with the page and every release.
