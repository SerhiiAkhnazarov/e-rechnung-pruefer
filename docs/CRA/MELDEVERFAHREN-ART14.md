# Meldeverfahren nach Art. 14 der Verordnung (EU) 2024/2847

Stand: **21.10.2026**. **Derzeit nicht anwendbar:** Der E-Rechnung Prüfer wird nicht im Rahmen einer Geschäftstätigkeit
bereitgestellt (`docs/SICHERHEIT.md`, Abschnitt 1). Dieser Ablauf ist vorbereitet, damit er ab dem ersten Tag einer
Geschäftstätigkeit gilt – Art. 14 ist seit dem 11.09.2026 anwendbar (Art. 71 Abs. 2) und erfasst auch Versionen, die vor
dem 11.12.2027 in Verkehr gebracht wurden (Art. 69 Abs. 3). Bis dahin gilt freiwillig: aktiv ausgenutzte Schwachstellen
werden mit CERT.at abgestimmt (`SECURITY.md`, Abschnitt 4).

Quellen: Text der Verordnung, https://eur-lex.europa.eu/eli/reg/2024/2847/oj (Wiedergabe
https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Article_14.html, gelesen am 21.10.2026); CERT.at,
https://www.cert.at/de/nis2/.

## 1. Was gemeldet wird

| Gegenstand | Voraussetzung |
|---|---|
| **Aktiv ausgenutzte Schwachstelle** (Art. 14 Abs. 1) | eine Schwachstelle des Prüfers, für die es verlässliche Belege einer Ausnutzung durch einen böswilligen Akteur gibt (Art. 3 Nr. 42) |
| **Schwerwiegender Sicherheitsvorfall** (Art. 14 Abs. 3, 5) | ein Vorfall, der die Fähigkeit des Prüfers beeinträchtigt oder beeinträchtigen kann, die Verfügbarkeit, Authentizität, Integrität oder Vertraulichkeit sensibler oder wichtiger Daten oder Funktionen zu schützen, oder der zur Einschleusung oder Ausführung von Schadcode im Prüfer oder in Netzen und Systemen der Nutzer führt oder führen kann – z. B. eine manipulierte Version auf GitHub Pages oder in einem Release |

## 2. Wohin

Über die **zentrale Meldeplattform** der ENISA (Art. 16; https://portal.cra-srp.enisa.europa.eu/), gleichzeitig an das
als Koordinator benannte CSIRT und an die ENISA. Hauptniederlassung des Herstellers ist Österreich (Art. 14 Abs. 7):
**CERT.at** (https://www.cert.at/), das nationale CSIRT Österreichs.

Vorbereitung bei Aufnahme einer Geschäftstätigkeit: Registrierung auf der Meldeplattform; CERT.at bestätigt die Zuordnung
des Kontos zum Unternehmen, **nicht für Freemail-Adressen** – ein Postfach auf eigener Domain ist dafür nötig.

## 3. Fristen und Inhalte

Die Fristen beginnen, sobald der Hersteller Kenntnis erlangt.

| Frist | Aktiv ausgenutzte Schwachstelle (Art. 14 Abs. 2) | Schwerwiegender Vorfall (Art. 14 Abs. 4) |
|---|---|---|
| **24 Stunden** | Frühwarnung; gegebenenfalls mit den Mitgliedstaaten, in denen der Prüfer bereitgestellt wird (überall: GitHub Pages) | Frühwarnung, auch ob der Vorfall vermutlich durch rechtswidrige oder böswillige Handlungen verursacht wurde; Mitgliedstaaten wie links |
| **72 Stunden** | Meldung: allgemeine Angaben zum Produkt (Version, `programSha256`), Art der Ausnutzung und der Schwachstelle, ergriffene und von den Nutzern zu ergreifende Abhilfemaßnahmen, Einstufung der Vertraulichkeit der Angaben | Meldung: Art des Vorfalls, erste Bewertung, ergriffene und von den Nutzern zu ergreifende Abhilfemaßnahmen, Vertraulichkeit |
| **14 Tage** nach Verfügbarkeit einer Korrektur bzw. **1 Monat** nach der Meldung | Abschlussbericht: Beschreibung mit Schweregrad und Auswirkung, Angaben zu einem böswilligen Akteur, soweit bekannt, Einzelheiten des Sicherheitsupdates | Abschlussbericht: ausführliche Beschreibung mit Schweregrad und Auswirkung, Art der Bedrohung bzw. Ursache, ergriffene und laufende Abhilfemaßnahmen |

Auf Ersuchen des CSIRT: Zwischenbericht (Art. 14 Abs. 6). Gegen Kleinst- und Kleinunternehmen werden wegen Versäumens der
24-Stunden-Frist keine Geldbußen verhängt (Art. 64 Abs. 10) – die Frist gilt trotzdem.

## 4. Nutzer informieren (Art. 14 Abs. 8)

Unverzüglich nach Kenntnis: betroffene Nutzer – bei diesem Verbreitungsweg alle – über die Schwachstelle oder den Vorfall
und die Abhilfe informieren, wo angebracht in strukturierter, maschinenlesbarer Form:

1. Hinweis auf der Seite selbst (neue Version auf GitHub Pages; bei einem Vorfall die betroffene Datei sofort durch die
   letzte geprüfte ersetzen),
2. CSAF-2.0-Sicherheitshinweis unter `/.well-known/csaf/` (`security/csaf/<Jahr>/`, `tools/make-csaf.cjs`) und Seite
   „Sicherheitshinweise“,
3. GitHub Security Advisory, Release-Hinweise, CHANGELOG.

## 5. Ablauf

1. **Kenntnis** (Meldung über `security-contact/`, eigener Fund, Hinweis Dritter): Zeitpunkt festhalten; prüfen, ob eine
   Ausnutzung belegt ist bzw. ob ein schwerwiegender Vorfall vorliegt.
2. **Innerhalb von 24 Stunden:** Frühwarnung auf der Meldeplattform; bei einem Vorfall die Verteilung sichern (Pages auf
   die letzte geprüfte Version zurücksetzen, betroffenes Release zurückziehen, Herkunftsnachweise prüfen).
3. **Innerhalb von 72 Stunden:** Meldung mit den Angaben aus Abschnitt 3; Nutzer informieren (Abschnitt 4).
4. **Korrektur:** neue Version über den regulären Weg (alle Testreihen, Freigabe, Release); Sicherheitshinweis.
5. **Abschlussbericht** binnen 14 Tagen nach Verfügbarkeit der Korrektur bzw. binnen eines Monats nach der Meldung.
6. **Nachbereitung:** Risikobewertung (`docs/SICHERHEIT.md`) und Tests ergänzen; `security/vex.json` aktualisieren.

Freiwillige Meldungen (Art. 15) – Schwachstellen, Cyberbedrohungen, Beinahe-Vorfälle – sind über dieselbe Plattform
möglich.
