# Umsatzsteuerliche Einordnung der Befunde (Deutschland)

Stand der Rechtsgrundlagen: **21.10.2026**. Daten: `legal/ust-pflichtangaben.json` (Version 2, Stand 2026-10-21). Programm:
`src/vat-relevance.js`. Syntaxbindung: `build/bt-paths.json` (aus der KoSIT-Visualisierung, `tools/build-bt-paths.cjs`).
Tests: `test/run-vat-tests.cjs` (Testreihe `vat-relevance`).

Ein Validator meldet Format- und Geschäftsregelfehler. Ob eine Rechnung deswegen umsatzsteuerlich nicht
ordnungsgemäß ist, ist eine andere Frage: Nach dem BMF-Schreiben vom 15.10.2025 macht ein **Formatfehler** aus der
E-Rechnung eine sonstige Rechnung (Rn. 6a), ein **Geschäftsregelfehler** zu anderen Inhalten als den
Pflichtangaben ist umsatzsteuerlich unbeachtlich (Rn. 35a). Das BMF-Schreiben vom 15.10.2026 bestätigt das: Ein
Geschäftsregelfehler hat nur dann einen Inhaltsfehler zur Folge, wenn er eine **Rechnungspflichtangabe** betrifft
(Rn. 22); die technische Sichtweise, nach der jede verletzte Geschäftsregel aus dem Kern-Datenmodell aus der Datei „keine E-Rechnung“ macht,
ist für umsatzsteuerliche Fragen nicht maßgebend (Rn. 23). Für die Zuordnung der Pflichtangaben zu den
Geschäftsbegriffen empfiehlt die Finanzverwaltung die Tabelle von KoSIT und FeRD (Rn. 8) – auf ihr beruht die Zuordnung
des Prüfers (Abweichungen: Abschnitt 3). Der Prüfer ordnet deshalb jeden Befund ein, gibt je Rechnung ein Gesamturteil und zeigt, ob die
Pflichtangaben im strukturierten Teil vorhanden sind. **Er ersetzt keine Steuerberatung und keine inhaltliche
Rechnungsprüfung.**

## 1. Rechtsgrundlagen und wo sie gelesen wurden

| Grundlage | verwendet für | gelesen (20./21.10.2026) |
|---|---|---|
| § 14 UStG: Abs. 1 Satz 3–6 (E-Rechnung, sonstige Rechnung, Format), Abs. 2 Satz 2 Nr. 1 (Pflicht nur zwischen im Inland ansässigen Unternehmern, nicht bei § 4 Nr. 8–29), Abs. 4 Satz 1 Nr. 1–10, Abs. 5 Satz 2 (Endrechnung), Abs. 7 | Urteile, Übersicht | gesetze-im-internet.de |
| § 14 Abs. 4 Satz 1 Nr. 6a UStG – „Versteuerung nach vereinnahmten Entgelten“ – erstmals für Rechnungen, die nach dem 31.12.2027 ausgestellt werden (Jahressteuergesetz 2024, § 27 Abs. 41 UStG n. F.) | Angabe `nr6a` (nach Ausstellungsdatum BT-2 ≥ 2028-01-01) | übereinstimmend EY (Übersicht zum JStG 2024, Stand 09.04.2025: „erstmals auf Rechnungen anzuwenden, die nach dem 31.12.2027 ausgestellt werden (§ 27 Abs. 41 UStG)“), Ebner Stolz (10.12.2024), FGS (25.10.2024), NWB; der heute geltende Text auf gesetze-im-internet.de enthält weder Nr. 6a noch § 27 Abs. 41 (am 21.10.2026 geprüft); den Text des BGBl. 2024 I Nr. 387 liefern recht.bund.de und die Bundesrats-Drucksache 529/24 dem Werkzeug nicht vollständig aus |
| § 14a Abs. 1, 3, 4, 5, 6, 7; § 15 Abs. 1 Satz 1 Nr. 1 Satz 2 und Nr. 4; §§ 22a, 22c; § 27 Abs. 38 UStG | Übersicht, Texte | gesetze-im-internet.de (über die unabhängige Durchsicht, Abschnitt 8) |
| §§ 31 (Abs. 2, 4, 5), 33, 34, 34a UStDV | Anschrift, Kalendermonat, Berichtigung, Kleinbetrag, Fahrausweise, Kleinunternehmer | gesetze-im-internet.de |
| Art. 219a, 230 MwStSystRL | Hinweis ausländischer Verkäufer, Steuer in Euro | NWB (EUR-Lex nicht vollständig abrufbar) |
| BMF-Schreiben vom 15.10.2024 (GZ III C 2 - S 7287-a/23/10001 :007), Rn. 7, 22, 25, 30–33, 35, 48, 49, 57, 59, 60 (das BMF zählt nach Randnummern „Rn.“; so zitiert es auch das Schreiben vom 15.10.2026) | Urteile, Hinweise | Kopien des Schreibens (bak.de; altbayerischer.de); bundesfinanzministerium.de sperrt automatische Abrufe (robots.txt) |
| BMF-Schreiben vom 15.10.2025 (GZ III C 2 - S 7287-a/00019/007/243, DOK COO.7005.100.4.13163130, BStBl 2025 I S. 1806), Rn. 6a, 6b, 35, 35a | Klassen, Urteile, Hinweise „Anlagen“ und „Validierungsbericht“ | Kopie des Schreibens mit Kopfzeile (GZ, DOK): `steuerschroeder.de/blog/wp-content/uploads/2025/10/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf`, Rn. 35 und 35a satzweise gelesen; bundesfinanzministerium.de sperrt automatische Abrufe (robots.txt). Die Randnummern 6a, 6b, 35, 35a bestätigt das Schreiben vom 15.10.2026 (Rn. 10, 22) |
| BMF-Schreiben vom 15.10.2026 (GZ III C 5 - S 7287-a/00019/021/017, DOK COO.7005.100.3.15923106) | Rn. 3, 4 (Endrechnung, bis 30.06.2030: Absetzung als Summe in BT-113 mit den Einzelheiten in BT-22, oder Absetzung in einem eingebetteten, unstrukturierten Anhang nach Abschn. 14.8 Abs. 8 Nr. 2 UStAE mit ausdrücklichem Hinweis), Rn. 8, 9 (Zuordnungstabelle KoSIT/FeRD), Rn. 10–12 (Leistungsbeschreibung), Rn. 14, 19 (Anlagen bei Bauleistungen, Bruttopreisrechnungen), Rn. 15, 16 (Entgeltminderung), Rn. 20, 21 (Berichtigung), Rn. 22, 23 (Geschäftsregelfehler); Abschnitt II Nr. 3 (Abschn. 14.11 Abs. 2 Satz 7 UStAE), Nr. 4 (Abschn. 15.11 Abs. 3 Satz 2 UStAE); Anwendungsregelung | **Original** (PDF, 10 Seiten, „Nur per E-Mail“, SHA-256 `af65d13f4d06bec52c425a0a021b2526f5acaa70a8c8b8fc628d9785547b12e6`), vom Betreiber am 21.10.2026 bereitgestellt und vollständig gelesen; Fundstelle `bundesfinanzministerium.de/…/Umsatzsteuer-Anwendungserlass/2026-10-15-obligatorische-elektronische-rechnung.pdf` (Titel der Seite in der Websuche bestätigt) |
| KoSIT / FeRD: „Empfehlungen zu Pflichtangaben in einer E-Rechnung gemäß UStG“ (Online-Fassung `xeinkauf.de/xrechnung/ustg/`, geändert 18.09.2026; PDF vom 25.07.2025) – die Finanzverwaltung empfiehlt, sie in der jeweils aktuellen Version zugrunde zu legen (BMF-Schreiben vom 15.10.2026, Rn. 8); Fundstellen nach Rn. 9: `xeinkauf.de/aktuelles/xrechnung/pflichtangaben-nach-ustg-en16931` (Meldung vom 28.07.2025, verweist auf die Online-Fassung) und `www.ferd-net.de/faqs/pflichtangaben-in-e-rechnungen` (PDF vom 25.07.2025) | Zuordnung der Pflichtangaben zu den Geschäftsbegriffen (Abschnitt 3) | xeinkauf.de, ferd-net.de (am 21.10.2026: keine neuere Fassung) |
| BFH, Urteile vom 17.12.2008, XI R 62/07, und vom 1.3.2018, V R 18/17 | Hinweis zum Leistungszeitpunkt | Sekundärquellen (NWB, Deubner) |

## 2. Einordnung eines Befunds

| Klasse | wann | Bedeutung |
|---|---|---|
| `format` – Formatfehler | XML Schema, Zeichenkodierung, nicht wohlgeformt | keine E-Rechnung, sondern sonstige Rechnung (Rn. 6a). Ausnahme in der Begründung: „XRechnung nicht in UTF-8“ ist eine Einschätzung des Werkzeugs (der KoSIT-Validator meldet das nicht) |
| `container` – PDF-Container | Vorgaben an den PDF-Teil einer hybriden Rechnung | maßgeblich ist der XML-Teil (Rn. 31); ein abweichender PDF-Teil kann eine weitere Rechnung sein (Rn. 32, § 14c UStG) – das vergleicht das Werkzeug nicht |
| `pflicht` – Pflichtangabe | die Regel betrifft nach der Zuordnung einen Geschäftsbegriff, der eine Pflichtangabe trägt oder zu ihrer Berechnung gehört | nicht ordnungsmäßig, wenn die Angabe fehlt oder unrichtig ist (Rn. 35a) |
| `ohne-bezug` – keine Pflichtangabe | die Regel betrifft nur andere Geschäftsbegriffe | umsatzsteuerlich unbeachtlich (Rn. 35a), technisch dennoch fehlerhaft |
| `zusatz` – keine Pflichtangabe | die Regel meldet ein Element, das die EN 16931 nicht vorsieht (UBL-CR, CII-SR, „marked as not used“) | wird nicht ausgewertet |
| `unbestimmt` – prüfen | das Werkzeug kann die betroffene Angabe nicht feststellen | wie eine Pflichtangabe behandelt – nie „unbeachtlich“ |

Welche Geschäftsbegriffe ein Befund betrifft, in dieser Reihenfolge: (1) eine Zeile in `regeln` (Abschnitt 4), (2) die
in der Meldung genannten Geschäftsbegriffe (EN-16931-Meldungen nennen sie, z. B. „(BT-31)“; Gruppen nur, wenn kein
Begriff genannt ist), (3) Regeln zu nicht vorgesehenen Elementen → `zusatz`, (4) die Stelle des Befunds: die Pfade,
die der Regeltest liest, das Element, das die Meldung nennt, sonst der nächste Vorfahre mit Zuordnung – nachgeschlagen
in der Syntaxbindung der KoSIT-Visualisierung, (5) sonst `unbestimmt`. Angaben mit Geltungsbeginn (Nr. 6a) zählen
nur für Rechnungen ab diesem Datum (BT-2; ohne Datum vorsichtshalber immer).

## 3. Zuordnung der Pflichtangaben (Geschäftsbegriffe)

Grundlage ist die Zuordnungstabelle von KoSIT und FeRD (Abschnitt 1). Welche Angaben eine Kleinbetragsrechnung
(§ 33 UStDV) oder die Rechnung eines Kleinunternehmers (§ 34a UStDV) enthalten muss, entscheidet die Übersicht
(Abschnitt 6), nicht diese Tabelle. Die Zuordnung ist bewusst **weiter** als die
Tabelle, wo ein Begriff zur Berechnung einer Angabe gehört (z. B. Basisbetrag und Prozentsatz eines Nachlasses für
das Entgelt): dann gilt ein Fehler als „Pflichtangabe“ statt als unbeachtlich.

| Angabe | Norm | Geschäftsbegriffe |
|---|---|---|
| `nr1v` | § 14 Abs. 4 Satz 1 Nr. 1 (Leistender) | BT-27, BT-28, BT-35, BT-36, BT-162, BT-37, BT-38, BT-39, BT-40 |
| `nr1e` | § 14 Abs. 4 Satz 1 Nr. 1 (Leistungsempfänger) | BT-44, BT-45, BT-50, BT-51, BT-163, BT-52, BT-53, BT-54, BT-55 |
| `nr2` | Nr. 2 | BT-31, BT-32 |
| `nr3` | Nr. 3 | BT-2 |
| `nr4` | Nr. 4 | BT-1 |
| `nr5` | Nr. 5 | BT-129, BT-130, BT-153 bis BT-161 (Artikelinformation BG-31 mit Merkmalen BG-32) |
| `nr6` | Nr. 6 | BT-72, BT-73, BT-74, BT-134, BT-135, BT-7 (Vereinnahmung bei Anzahlungen) |
| `nr6a` | Nr. 6a für Rechnungen ab 1.1.2028 | BT-8 |
| `nr7` | Nr. 7 | BT-5, BT-20, BT-92 bis BT-97, BT-99 bis BT-103, BT-106 bis BT-109, BT-112, BT-116, BT-118, BT-119, BT-131, BT-136 bis BT-139, BT-141 bis BT-143, BT-146 bis BT-151 |
| `nr8` | Nr. 8 | BT-6, BT-95, BT-96, BT-102, BT-103, BT-110, BT-111, BT-112, BT-117 bis BT-121, BT-151, BT-152 |
| `nr9` | Nr. 9 | – (Bemerkung, BG-1) |
| `nr10` | Nr. 10 i. V. m. Abs. 2 Satz 5 | BT-3 |
| `14-5` | § 14 Abs. 5 Satz 2 | über `regeln`: BT-113, BT-115, wenn ein bereits gezahlter Betrag angegeben ist |
| `14a` | § 14a Abs. 1, 3, 4, 5, 6, 7 | BT-31, BT-48, BT-120, BT-121 |
| `22c` | § 22c | BT-62 bis BT-69, BT-164 |
| `31-5` | § 31 Abs. 5 UStDV | BT-25, BT-26 |

Abweichung von der Tabelle bei Nr. 6: KoSIT/FeRD nennen für den Leistungszeitpunkt BT-72, BG-14 und BG-26; BT-7 und
BT-8 ordnen sie der Nr. 6a zu. Der Prüfer ordnet Befunde zu BT-7 vorsichtshalber **auch** der Nr. 6 zu, weil bei
Anzahlungsrechnungen der Zeitpunkt der Vereinnahmung anzugeben ist (§ 14 Abs. 4 Satz 1 Nr. 6 Halbsatz 2 UStG); in der
Übersicht zählt BT-7 nur bei Anzahlungsrechnungen (Code 386, 500) als Leistungs- bzw. Vereinnahmungszeitpunkt.

Bemerkungen (BG-1, BT-21/BT-22) trägt die Tabelle von KoSIT/FeRD bei mehreren Angaben als mögliche Träger (Hinweis
„Gutschrift“, Steuerbefreiung, § 14a Abs. 6 und 7, Fiskalvertretung, Nr. 6a, Nr. 9). Regeln zu Bemerkungen prüfen
nur deren Form (z. B. den Code des Betreffs), nicht den Inhalt; sie werden deshalb **nicht** diesen Angaben
zugeordnet. Die Übersicht (Abschnitt 6) wertet die
Bemerkungen dagegen aus.

## 4. Regeln mit eigener Zuordnung (`regeln`)

Wenn die Meldung einer Regel neben dem geprüften Begriff Bedingungen nennt (z. B. „bei Steuerkategorie S …“), ersetzt
eine Zeile in `regeln` die Begriffe der Meldung; jede Zeile hat eine Begründung (`grund`). Beispiele:

* `BR-CO-16`, `BR-DEX-09` (Zahlbetrag = Bruttobetrag − bereits gezahlt + Rundung): ohne bereits gezahlten Betrag keine
  Pflichtangabe; **mit** bereits gezahltem Betrag (BT-113 ≠ 0) betrifft die Regel die Endrechnung (`14-5`).
* `BR-G-02` bis `-04` (Ausfuhr ohne USt-IdNr.): ist die Steuernummer (BT-32) angegeben, verlangt das UStG nicht mehr –
  keine Pflichtangabe; sonst Nr. 2.
* `BR-O-02` bis `-04` (nicht steuerbar, aber USt-IdNr. angegeben): betrifft die Steuerkategorie (Nr. 7/8).
* `BR-CO-25` (Fälligkeit oder Zahlungsbedingungen): das Fälligkeitsdatum ist keine Pflichtangabe.
* `BR-DE-18` (Skonto im XRechnung-Format in BT-20): im Voraus vereinbarte Minderung (Nr. 7).
* `BR-DE-22`, `BR-DEX-04` bis `-08`, `BR-IC-12`, Peppol-Regeln ohne Geschäftsbegriff in der Meldung: die geprüften
  Begriffe mit Begründung.

Ein Test stellt sicher, dass jede Zeile, deren Begründung „keine Pflichtangabe“ lautet, auch so eingeordnet wird.

## 5. Gesamturteil je Rechnung

| Urteil | Bedingung (in dieser Reihenfolge) |
|---|---|
| `keine-xml` – Keine E-Rechnung | kein strukturierter Teil (PDF ohne Rechnungs-XML, andere Datei) |
| `nicht-pruefbar` – Nicht einordenbar | ZIP (nicht entpackt), XML ohne UBL/CII-Rechnung, fehlende oder unbekannte Spezifikationskennung (BT-24): andere vereinbarte Formate sind zulässig (§ 14 Abs. 1 Satz 6 Nr. 2 UStG, Rn. 33) |
| `format` – Keine E-Rechnung (Formatfehler) | Zeichenkodierung, nicht wohlgeformt, XML-Schema-Fehler |
| `kein-profil` – Keine E-Rechnung (Profil) | ZUGFeRD/Factur-X MINIMUM, BASIC WL, ZUGFeRD 1.0 (Rn. 25, 30) |
| `pflicht` – Pflichtangaben betroffen | ein Fehler der Klasse `pflicht` oder `unbestimmt` |
| `luecke` – Pflichtangabe fehlt | kein solcher Fehler, aber die Übersicht zeigt eine fehlende Pflichtangabe (Rn. 35) |
| `unvollstaendig` | Verarbeitungsfehler oder fehlendes Regelwerk |
| `technisch` – Fehler ohne USt-Bedeutung | nur Fehler der Klassen `ohne-bezug`/`zusatz` |
| `ok` – Keine Format- oder Regelfehler | keine Fehler (mit Zusatz, wenn Angaben zu prüfen sind) |

Folgen bei `pflicht`/`luecke`: Liegt tatsächlich ein Verstoß gegen die Pflichtangaben vor, ist die Rechnung nicht
ordnungsmäßig (Rn. 35a); Rechnungen ohne die vollständigen Angaben nach § 14 Abs. 4 Satz 1 Nr. 1 bis 8 und 10 UStG
berechtigen nicht zum Vorsteuerabzug, es sei denn, sie werden nachträglich vervollständigt (Abschn. 15.11 Abs. 3
Satz 2 UStAE n. F.); der Vorsteuerabzug setzt eine nach §§ 14, 14a
UStG ausgestellte Rechnung voraus (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG) – nicht bei Steuerschuldnerschaft des
Leistungsempfängers (§ 15 Abs. 1 Satz 1 Nr. 4 UStG, eigener Hinweis); eine Berichtigung wirkt unter den übrigen
Voraussetzungen zurück (Rn. 49). Hinweise je nach Lage: Übergangsregelung des § 27 Abs. 38 UStG und Schutz des
Empfängers (Rn. 59), Ausnahmen von der E-Rechnungspflicht, ausländischer Verkäufer (§ 14 Abs. 7 UStG, Art. 219a
MwStSystRL) oder Käufer, Kleinbetragsrechnung, Kleinunternehmer, hybride Rechnung, XRechnung-Kodierung, unvollständige
Prüfung. Warnungen und Hinweise der Regelwerke sind keine Fehler und ändern das Urteil nicht.

## 6. Übersicht „Pflichtangaben“

Geprüft wird das **Vorhandensein** im strukturierten Teil, nicht die Richtigkeit. `fehlt` nur, wo der strukturierte
Teil eine erforderliche Angabe sicher nicht enthält; was von Umständen außerhalb der Rechnungsdaten abhängt, ist
`prüfen`.

| Angabe | vorhanden | fehlt | prüfen | entfällt / nicht zutreffend |
|---|---|---|---|---|
| Nr. 1 | Name, Ort und Postleitzahl, Straße oder Postfach | Name, oder Ort und Postleitzahl | Straße, Ort oder Postleitzahl fehlt (§ 31 Abs. 2 UStDV: eindeutig feststellbar genügt) | Empfänger bei Kleinbetrag |
| Nr. 2 | BT-31 oder BT-32 | keines von beiden | nur BT-63; nur Kategorie O (EN 16931 verbietet dort die USt-IdNr.) | Kleinbetrag |
| Nr. 3, 4 | BT-2, BT-1 | fehlen | – | Nr. 4 bei Kleinbetrag, Kleinunternehmer |
| Nr. 5 | Positionen mit Bezeichnung und Menge (ob die Beschreibung die Kontrollfunktion erfüllt, BMF 2026 Rn. 10–12, wird nicht geprüft – Hinweis) | keine Position, Bezeichnung oder Menge fehlt | – | – |
| Nr. 6 | BT-72, BG-14, BG-26 in jeder Position; BT-7 bei Anzahlungsrechnungen | – | sonst (BFH XI R 62/07 und V R 18/17), auch wenn nur BT-7/BT-8 da sind | Kleinbetrag, Kleinunternehmer |
| Nr. 6a | Bemerkung „Versteuerung nach vereinnahmten Entgelten“ | – | ab 2028 BT-8 „paid to date“ ohne den Hinweis | vor 2028; ohne Anzeichen |
| Nr. 7 | Aufschlüsselung mit Bemessungsgrundlage und Kategorie (Hinweis zu Entgeltminderungen, BMF 2026 Rn. 15, 16) | keine oder unvollständige Aufschlüsselung | – | – |
| Nr. 8 | Satz und Steuer, bei Befreiungen der Hinweis | fehlen | Rechnung in Fremdwährung ohne Steuer in Euro (Art. 230 MwStSystRL) | – |
| Nr. 9 | Hinweis auf die Aufbewahrungspflicht | – | – | sonst (nur bei Grundstücksleistungen an Nichtunternehmer) |
| Nr. 10 | Gutschrift-Codes 261, 389, 471, 473, 500, 501, 502, 527 oder 381 mit „Gutschrift“ in einer Bemerkung | – | Gutschrift-Code ohne „Gutschrift“; BT-3 fehlt | andere Codes |
| § 14 Abs. 5 | – | – | BT-113 ≠ 0 oder Code 876/877 (Endrechnung); der Hinweis nennt BMF 2026 Rn. 3, 4 und ob eine Bemerkung (BT-22) und eingebettete Anlagen (BT-125) vorhanden sind | sonst |
| § 14a | Hinweise und USt-IdNrn. vorhanden | AE ohne Hinweis; K ohne USt-IdNr. des Erwerbers oder (ohne BT-63) des Lieferers | AE mit Käufer im übrigen Gemeinschaftsgebiet ohne beide USt-IdNrn.; K nur mit BT-63; Differenzbesteuerung/Reiseleistungen | keine AE, K, Sonderregelung |
| § 22c | – | Fiskalvertreter im Inland (BT-69 = DE oder USt-IdNr. DE…) bei ausländischem Verkäufer ohne Name, USt-IdNr. oder Ort und PLZ | sonst bei vorhandenem Steuervertreter (deutscher Verkäufer; Vertreter für andere Staaten; Hinweis Nr. 1 nicht geprüft) | kein Steuervertreter |
| § 31 Abs. 5 UStDV | Berichtigungs-Code (384, 471, 472, 473, 502, 503) oder 381 mit BT-25 (Hinweis BMF 2026 Rn. 20, 21; bei Berichtigung durch den Leistungsempfänger – 471, 473, 502 – Abschn. 14.11 Abs. 2 Satz 7 UStAE) | – | Berichtigungs-Code ohne BT-25 | sonst |

**Kleinbetragsrechnung**: BT-5 = EUR, |BT-112| ≤ 250, keine Kategorie AE oder K (§§ 13b, 6a UStG; § 3c ist aus den
Daten nicht erkennbar). **Kleinunternehmer**: nur Kategorie E mit Hinweis auf § 19 UStG.

## 7. Grenzen

* Nur Vorhandensein und Regelverstöße – nicht, ob Steuersatz, Leistungsbeschreibung, Anschrift oder Nummernfolge
  richtig sind; nicht, ob der Umsatz steuerbar ist oder die Beteiligten im Inland ansässig sind (nur Ländercodes).
* Nicht erkennbar: Versandhandel (§ 3c UStG), neue Fahrzeuge (§ 14a Abs. 4), Dreiecksgeschäft (§ 14a Abs. 7),
  Hinweis auf die Fiskalvertretung, Versteuerung nach vereinnahmten Entgelten; kein Vergleich von PDF-Bild und XML.
* Nicht geprüft werden die inhaltlichen Vorgaben des BMF-Schreibens vom 15.10.2026: ob die Leistungsbeschreibung die
  Kontrollfunktion erfüllt (Rn. 10–12), Bauleistungen nach Gewerken mit Anlage (Rn. 13, 14), Bruttopreisrechnungen
  (Rn. 17–19), der Inhalt eingebetteter Anlagen (Rn. 4, 14, 19), Anzahlungsrechnungen vor der eigenen
  E-Rechnungspflicht (Rn. 2), die Kenntnis der Unternehmereigenschaft im Massengeschäft (Rn. 5–7), Rechnungen an die
  öffentliche Verwaltung (Rn. 24, 25) und Bescheide über öffentlich-rechtliche Abgaben (Rn. 26, 27). Hinweise geben
  die Übersicht (Nr. 5, Nr. 7, § 14 Abs. 5, § 31 Abs. 5 UStDV) und das Urteil (Anlagen).
* Es wird – auch für den Vorsteuerabzug – nicht beanstandet, wenn eine bis zum 31.12.2026 ausgestellte E-Rechnung den
  Schreiben vom 15.10.2024 und 15.10.2025 entspricht, nicht aber den zusätzlichen Vorgaben des Schreibens vom
  15.10.2026 (Anwendungsregelung).

## 8. Nachweise und unabhängige Durchsicht

* `test/run-vat-tests.cjs`: Rechtstabelle (jeder Begriff in der Syntaxbindung, jede Regel in den kompilierten
  Regelwerken, jedes zitierte BMF-Schreiben als Quelle), Einordnung mit von Hand begründeten Erwartungen (Meldungen
  aus den kompilierten Regelwerken, Fundstellen aus den CEN-Unit-Tests), Übersicht und Urteil an konstruierten
  Rechnungen für jeden Status, der ganze Korpus mit der Konsistenz von Urteil, Befunden und Übersicht. Zahlen: Bericht
  `vat-relevance` im Check-Run „verification report“.
* Unabhängige Durchsicht am 20.10.2026 (eigener Prüfer ohne Kenntnis der Entstehung, mit Primärquellen soweit
  erreichbar): 24 Feststellungen – u. a. fehlendes BMF-Schreiben vom 15.10.2026, BT-7/BT-8 als Leistungszeitpunkt,
  Kleinbetrag bei negativen Beträgen, Endrechnung, „Vorsteuerabzug gefährdet“ falsch belegt, Übergangsregelung
  unvollständig, Gutschrift-Codes, § 14a Abs. 4/6/7, § 22c nur Fiskalvertretung im Inland, Kategorie O, § 34a UStDV,
  Nr. 6a, Zuordnungslücken gegenüber KoSIT/FeRD, Formulierungen. Alle sind in Version 2 der Tabelle und in
  `src/vat-relevance.js` umgesetzt.
* Abgleich mit dem Original des BMF-Schreibens vom 15.10.2026 (21.10.2026): Version 0.3.0 schrieb dem Schreiben – nach
  Fachveröffentlichungen – auch die Aussagen „Validierung keine rechtliche Voraussetzung, kein staatliches
  Validierungswerkzeug, keine Empfehlung bestimmter Anwendungen“ zu. Sie stehen weder in diesem Schreiben noch im
  Schreiben vom 15.10.2025 und sind entfernt; der Hinweis zum Validierungsbericht gibt jetzt Rn. 35a des Schreibens
  vom 15.10.2025 wieder. Ergänzt: Randnummern (Rn. 3, 4, 8, 10–12, 15, 16, 20–23), die Folge für den Vorsteuerabzug nach
  Abschn. 15.11 Abs. 3 Satz 2 UStAE n. F., der Hinweis zu Anlagen (BG-24), die Berichtigung durch Gutschrift
  (Abschn. 14.11 Abs. 2 Satz 7 UStAE n. F.), die Fundstellen der Zuordnungstabelle nach Rn. 9. Bestätigt ohne Änderung:
  die Einordnung der Geschäftsregelfehler (Rn. 22, 23), die Endrechnung (Rn. 3, 4), der allgemeine Hinweis auf
  Entgeltminderungen (Rn. 16). Das Schreiben erwähnt § 14 Abs. 4 Satz 1 Nr. 6a UStG nicht.
* Zweite unabhängige Durchsicht am 21.10.2026 (eigener Prüfer ohne Kenntnis der Entstehung; Original des Schreibens
  vom 15.10.2026, Kopien der Schreiben von 2024 und 2025, gesetze-im-internet.de, xeinkauf.de, Verordnung (EU)
  2024/2847): keine Aussage ist einem Schreiben zugeschrieben, das sie nicht enthält; 13 Feststellungen, alle umgesetzt –
  u. a. Rn. 23 als notwendige, nicht hinreichende Bedingung, „nur dann“ in Rn. 22, Rn. 4 als Alternative (Absetzung im
  Anhang), bedingte Folgen bei `pflicht`, Wortlaut der Anwendungsregelung, „Rn.“ statt „Rz.“ für das Schreiben von 2024,
  die nicht belegte Spalte „auch bei Kleinbeträgen“ entfernt, die Bedingungen von § 14 Abs. 1 Satz 6 Nr. 2 („oder mit
  ihr interoperabel“), Abs. 2 Satz 2 Nr. 1 (Gebiete nach § 1 Abs. 3), Abs. 5 Satz 2, Abs. 7 Satz 2 (Gutschrift),
  § 14b Abs. 1 Satz 5 (§ 14 Abs. 2 Satz 2 Nr. 3), § 14a Abs. 7 (Steuerschuldnerschaft des letzten Abnehmers), die
  Aussage über öffentliche Auftraggeber jetzt mit Rn. 24 und 25 belegt, CRA-Einzelheiten in `docs/SICHERHEIT.md`.

## 9. Pflege

Ändert sich die Rechtslage oder die Zuordnung von KoSIT/FeRD: `legal/ust-pflichtangaben.json` anpassen (Stand,
Quellen, Angaben, Regeln, Texte), Erwartungen in `test/run-vat-tests.cjs` begründet ergänzen, Version im CHANGELOG.
Neue Regeln der Regelwerke werden ohne Pflege eingeordnet (Meldung, Stelle) – im Zweifel als „prüfen“.
