# Container-Prüfungen für hybride Rechnungen (ZUGFeRD / Factur-X / PDF/A-3)

`src/pdfa3-checks.js` prüft den PDF-Container einer ZUGFeRD-, Factur-X- oder XRechnung-in-PDF-Datei:
die Anforderungen der ZUGFeRD/Factur-X-Spezifikation an Metadaten und Anlage sowie die Regeln von
PDF/A-3 (ISO 19005-3), die sich allein aus der Objektstruktur und den XMP-Metadaten entscheiden
lassen. Es ist **kein** PDF/A-Validator; die vollständige Prüfung gegen ISO 19005-3 übernimmt veraPDF
im CI-Job `pdfa-verapdf` (Abschnitt 7). Jeder Bericht enthält dazu den Hinweis `PDFA3-FULL-VALIDATION`.

API (UMD, ohne Abhängigkeiten außer `src/pdf-embedded.js`, im Browser als `PdfA3Checks`):

```js
const r = await PdfA3Checks.checkContainer(bytes, { extracted /* optional: Ergebnis von PdfEmbedded.extractEmbeddedFiles */ });
r.results  // Befunde: [{ id, level: 'error'|'warning'|'info', message (deutsch), reference }]
r.checks   // jede Prüfung: [{ id, status: 'pass'|'fail'|'n/a', level, title, reference }]
r.facts    // Header-Version, pdfaid, fx:-Werte, Name/Profil der Rechnungs-XML, ...
```

Im Standalone-Build muss `src/pdfa3-checks.js` nach `src/pdf-embedded.js` eingebunden werden.
`src/pdf-embedded.js` wurde dafür erweitert: `loadDocument()` (Objektgraph, vorher intern) und
`util` (Parser-Primitive) werden exportiert; `pickInvoiceXml()` erkennt eine Rechnungs-XML mit
unbekanntem Namen jetzt auch am Wurzelelement nach langen Kommentaren (vorher nur in den ersten
4096 Bytes). Die Extraktionstests sind unverändert 151/151 (pdf.js-Parität und Scan-Fallback).

## 1. Quellen

| Quelle | Stand | Verwendung |
|---|---|---|
| Mustangproject (Referenzimplementierung von FeRD) | Commit `c1618af86e68` | Validator `validator/src/main/java/org/mustangproject/validator/PDFValidator.java`, Importer `library/.../ZUGFeRD/ZUGFeRDInvoiceImporter.java`, Exporter `library/.../ZUGFeRD/ZUGFeRDExporterFromA3.java`, `XMPSchemaZugferd.java`, `XMPSchemaPDFAExtensions.java`, `Profile.java`, `Profiles.java`, `FileAttachment.java`; Tests `validator/src/test/java/org/mustangproject/validator/PDFValidatorTest.java`, `ZUGFeRDValidatorTest.java` |
| ZUGFeRD-Korpus | Commit `82e886fb2136` | 151 PDFs; README.md „Purpose“: Validatoren sollen in `correct/` keine Fehler melden und in den anderen Dateien die Fehler finden |
| `build/rulesets.json` | — | Profilkennungen (GuidelineSpecifiedDocumentContextParameter/ram:ID) |

Die Spezifikationstexte ZUGFeRD 2.5.2 / Factur-X 1.09.2 und ISO 19005-3 liegen **nicht** in den
Repositories. Regeln, die nur aus dem Spezifikationstext stammen, sind in der Tabelle als solche
gekennzeichnet und — soweit vorhanden — der Umsetzung in Mustang entnommen. Die ISO-Klauselnummern
(6.1.2, 6.1.3, 6.6.2.1, 6.6.2.3, 6.6.4, 6.8) werden im CI über die Klauselattribute der
veraPDF-Regeln abgeglichen (`test/compare-verapdf.cjs`); stimmt eine Zuordnung nicht, erscheint die
Regel dort als „nicht zugeordnet“ bzw. als Abweichung.

## 2. Anforderungen

Stufe = Stufe des Befunds bei Verletzung. „Mustang-Validator“ = gleiche Regel im Validator von Mustang;
„nur Erzeuger“ = Mustang erzeugt es so, prüft es aber nicht.

| ID | Anforderung | Quelle | Stufe |
|---|---|---|---|
| `PDFA3-HEADER` | Dateikopf `%PDF-1.n` (n = 0…7) ab Byte 0, gefolgt von Zeilenende | ISO 19005-3 6.1.2; Mustang-Validator prüft nur `%PDF` am Anfang (PDFValidator.java Z. 89-93, section 20) | error |
| `PDFA3-HEADER-BINARY` | Kommentarzeile mit ≥ 4 Bytes > 127 nach dem Kopf | ISO 19005-3 6.1.2 | error |
| `PDFA3-TRAILER-ID` | Trailer enthält `/ID` (Array aus zwei Strings) | ISO 19005-3 6.1.3 | error |
| `PDFA3-ENCRYPT` | kein `/Encrypt` im Trailer | ISO 19005-3 6.1.3; Mustang nur über veraPDF (PDFValidator.java Z. 99-133, 348-350) | error |
| `PDFA3-XMP-CATALOG` | XMP-Strom im Katalog (`/Metadata`), wohlgeformtes XML | ISO 19005-3 6.6.2.1; Mustang-Validator section 17 (Z. 155-157) und 28 (Z. 284-287); XMP aus dem Katalog: ZUGFeRDInvoiceImporter.java Z. 191-198 | error |
| `PDFA3-PDFAID-PART` | `pdfaid:part` = 3 | ISO 19005-3 6.6.4; Mustang section 23 „Not a PDF/A-3“ (Z. 352-358, Flavour von veraPDF) | error |
| `PDFA3-PDFAID-CONFORMANCE` | `pdfaid:conformance` ∈ {A, B, U} | ISO 19005-3 6.6.4; Mustang PDF_A_3_FLAVOURS (Z. 59) | error |
| `FX-XMP-NAMESPACE` | fx-Eigenschaften im Namensraum `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#` (Factur-X / ZUGFeRD 2.1+), `urn:zugferd:pdfa:CrossIndustryDocument:invoice:2p0#` (ZUGFeRD 2.0) oder `urn:ferd:pdfa:CrossIndustryDocument:invoice:1p0#` (ZUGFeRD 1.0); RC-Namensraum `urn:ferd:pdfa:invoice:rc#` = warning | Spezifikation; Namensräume aus ZUGFeRDExporterFromA3.java Z. 221-231; Mustang-Validator sucht namensraumunabhängig (`local-name()`, Z. 179-180) | error |
| `FX-XMP-DOCUMENTTYPE` | `DocumentType` vorhanden und = `INVOICE` | Mustang-Validator section 13/14 (Z. 204-225); Wert: XMPSchemaZugferd.java Z. 71 | error |
| `FX-XMP-DOCUMENTFILENAME` | `DocumentFileName` vorhanden, Wert ∈ {factur-x.xml, zugferd-invoice.xml, xrechnung.xml, ZUGFeRD-invoice.xml} | Mustang-Validator section 21/19 (Z. 226-257) | error |
| `FX-XMP-VERSION` | `Version` vorhanden, Wert ∈ {1.0, 1p0, 2p0, 3p0, 1.2, 2.0, 2.1, 2.2, 2.3, 3.0} | Mustang-Validator section 15/16 (Z. 258-283, Werteliste Z. 272) | error |
| `FX-XMP-CONFORMANCELEVEL` | `ConformanceLevel` vorhanden, Wert ∈ {MINIMUM, BASIC WL, BASIC, EN 16931, COMFORT, CIUS, EXTENDED, EXTENDED-CTC-FR, XRECHNUNG} | Mustang-Validator section 11/12 (Z. 179-202, Werteliste Z. 192) | error |
| `FX-XMP-EXTENSION-SCHEMA` | `pdfaExtension:schemas` deklariert Namensraum, `pdfaSchema:prefix` und alle verwendeten fx-Eigenschaften | ISO 19005-3 6.6.2.3; nur Erzeuger: XMPSchemaPDFAExtensions.java Z. 114-157 | error |
| `FX-ATTACHMENT-PRESENT` | eine Rechnungs-XML ist eingebettet | Mustang „XML could not be extracted“ (ZUGFeRDValidator.java Z. 291-298, section 17) | error |
| `FX-ATTACHMENT-UNIQUE` | genau eine Rechnungs-XML (Name aus der Liste oder Wurzel CrossIndustryInvoice/-Document, Invoice, CreditNote) | Spezifikation; Mustang überschreibt bei mehreren Treffern (ZUGFeRDInvoiceImporter.java Z. 295-302) | warning |
| `FX-ATTACHMENT-NAME` | Name der Rechnungs-XML ∈ {factur-x.xml, zugferd-invoice.xml, xrechnung.xml, ZUGFeRD-invoice.xml}, Groß-/Kleinschreibung exakt; ZUGFeRD-invoice.xml = info (ZUGFeRD 1.0); Name passend zum Namensraum (warning); xrechnung.xml nur mit XRECHNUNG (warning); XRECHNUNG mit factur-x.xml = info | Mustang-Importer validFilenames (Z. 286-298); Zuordnung Version/Profil → Name: ZUGFeRDExporterFromA3.java Z. 252-264 | error |
| `FX-FILENAME-MATCH` | `DocumentFileName` = tatsächlicher Name der Anlage | Spezifikation; nur Erzeuger (ZUGFeRDExporterFromA3.java Z. 581-583 und 695-708 schreiben beides aus demselben Wert) | error |
| `FX-LEVEL-PROFILE` | `ConformanceLevel` passt zum Profil der XML (Tabelle 3); UBL in Factur-X = error | Spezifikation; Zuordnung Profile.java Z. 43-51, Profiles.java Z. 34-50, build/rulesets.json | error (toleriert: warning) |
| `PDFA3-NAMETREE` | Dateispezifikation der Rechnung im Namensbaum `/Names /EmbeddedFiles` | ISO 32000-1 7.11.4; Mustang liest nur den Namensbaum (ZUGFeRDInvoiceImporter.java Z. 200-222); Erzeuger Z. 430-446 | error |
| `PDFA3-AF-CATALOG` | Katalog-`/AF` referenziert die Dateispezifikation der Rechnung; zweite, inhaltsgleiche Dateispezifikation im `/AF` = warning | ISO 19005-3 6.8 / Spezifikation; Erzeuger ZUGFeRDExporterFromA3.java Z. 448-464 | error |
| `PDFA3-FILESPEC-F-UF` | jede Dateispezifikation hat `/F` und `/UF` | ISO 19005-3 6.8; Erzeuger Z. 403-408 | error |
| `PDFA3-AFRELATIONSHIP` | jede Dateispezifikation hat `/AFRelationship` ∈ {Source, Data, Alternative, Supplement, Unspecified}; Rechnung ∈ {Data, Alternative, Source} | ISO 19005-3 6.8; Rechnungswerte: Spezifikation, Mustang FileAttachment.java Z. 80-95 („either: Source, Data or Alternative“) | error |
| `FX-AFRELATIONSHIP-PROFILE` | MINIMUM/BASIC WL → Data, sonst Alternative/Source | ZUGFeRD 2.1.1 Techn. Anhang Teil A 2.2.2 (Text nicht im Repo), umgesetzt in ZUGFeRDExporterFromA3.java Z. 697-704. Nur Hinweis: die offiziellen Beispiele (symtrax = FeRD ZUGFeRD 2.1, FNFE) verwenden Data für alle Profile | info |
| `PDFA3-DESC` | `/Desc` vorhanden (optional) | ISO 32000-1 7.11.3; Erzeuger Z. 409 | info |
| `PDFA3-EF-SUBTYPE` | EmbeddedFile-Strom hat `/Subtype` als MIME-Typ (sonst error); Rechnung `text/xml` = `/text#2Fxml` (sonst warning) | ISO 19005-3 6.8; text/xml: Spezifikation, Erzeuger Z. 707-708, 415 | error / warning |
| `PDFA3-EF-PARAMS-MODDATE` | EmbeddedFile-Strom hat `/Params` mit `/ModDate` | Spezifikation; Erzeuger Z. 419; ob ISO 19005-3 es verlangt, zeigt der veraPDF-Vergleich (Paar `embedded-file-moddate`, Modus report) | warning |
| `PDFA3-ACTIONS` | nur Aktionen, die PDF/A-3 erlaubt (GoTo, GoToR, GoToE, Thread, URI, SubmitForm, benannte Aktionen NextPage, PrevPage, FirstPage, LastPage) – an `/OpenAction` und `/AA` des Katalogs, an Seiten, Annotationen (`/A`, `/AA`), Lesezeichen und Formularfeldern, mit `/Next`-Ketten; JavaScript und Launch werden zusätzlich als Sicherheitshinweis genannt | ISO 19005-3 6.5.1 (veraPDF 6.5.1-1, 6.5.1-2) | error |
| `PDFA3-AA` | keine Zusatzaktionen (`/AA`) in Katalog, Seiten, Annotationen und Formularfeldern; Widget-Annotationen ohne `/A` und `/AA` | ISO 19005-3 6.5.2, 6.4.1 (veraPDF 6.5.2-1, 6.5.2-2, 6.4.1-1, 6.4.1-2) | error |
| `PDF-JAVASCRIPT` | kein JavaScript im Namensbaum `/Names /JavaScript` (Dokument-JavaScript, läuft beim Öffnen) | ISO 32000-1 12.6.4.16; nicht im Objektmodell von veraPDF – Vergleich im Modus `report` | error |
| `PDFA3-FULL-VALIDATION` | Hinweis: keine vollständige ISO-19005-3-Prüfung | — | info |

Die Rechnungs-XML ist die Anlage, die `fx:DocumentFileName` benennt; fehlt sie, die per Name bzw.
Wurzelelement erkannte (`PdfEmbedded.pickInvoiceXml`). Die aktiven Inhalte (`PdfA3Checks.activeContent`) werden
auch ermittelt, wenn die Querverweistabelle unbrauchbar ist und der Leser die Objekte durchsucht (Katalog = letztes
Objekt mit `/Type /Catalog`); dieselbe Auswertung stuft PDF-Anlagen für den Download ein (`src/file-safety.js`). `PDFA3-FILESPEC-F-UF`, `PDFA3-AFRELATIONSHIP`,
`PDFA3-DESC`, `PDFA3-EF-SUBTYPE`, `PDFA3-EF-PARAMS-MODDATE` gelten für jede Anlage des Namensbaums.

## 3. Profil → ConformanceLevel, Dateinamen

| Profilkennung (ram:ID) | erwartet | toleriert (warning) |
|---|---|---|
| `urn:factur-x.eu:1p0:minimum`, `urn:zugferd.de:2p0:minimum` | MINIMUM | — |
| `urn:factur-x.eu:1p0:basicwl`, `urn:zugferd.de:2p0:basicwl` | BASIC WL | — |
| `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic` (auch `zugferd.de:2p0`, `:compliant:`-Variante) | BASIC | — |
| `urn:cen.eu:en16931:2017` (auch `…:compliant:factur-x.eu:1p0:en16931`) | EN 16931 | COMFORT |
| `urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended` (auch `zugferd.de:2p0`) | EXTENDED | — |
| `urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr` | EXTENDED-CTC-FR | EXTENDED |
| jede Kennung mit `xrechnung` (XRechnung 1.x–3.x) | XRECHNUNG | EN 16931, CIUS (vor ZUGFeRD 2.1.1) |
| `urn:ferd:CrossIndustryDocument:invoice:1p0:{basic,comfort,extended}`, RC: `urn:ferd:invoice:rc:{…}` | BASIC / COMFORT / EXTENDED | — |

Dateinamen: `factur-x.xml` (Factur-X 1.0x / ZUGFeRD 2.1+), `zugferd-invoice.xml` (ZUGFeRD 2.0),
`xrechnung.xml` (Profil XRECHNUNG, ab ZUGFeRD 2.1.1 zulässig), `ZUGFeRD-invoice.xml` (ZUGFeRD 1.0, info).

## 4. Nicht geprüft und warum

* Schriften (Einbettung, Glyphenbreiten, CIDSet), Farbräume und OutputIntent, Transparenz, übrige Eigenschaften
  von Annotationen und Formularfeldern, optionale Inhalte, Tagged PDF (PDF/A-3A) — das verlangt die
  Auswertung aller Inhaltsströme und Ressourcen, also einen vollständigen PDF/A-Validator (veraPDF). Aktionen,
  Zusatzaktionen und Dokument-JavaScript prüfen `PDFA3-ACTIONS`, `PDFA3-AA` und `PDF-JAVASCRIPT`.
* XMP vollständig nach ISO 19005-3 6.6 (Typprüfung aller Eigenschaften, Synchronisation mit dem
  Info-Dictionary, `xpacket`-Attribute) — veraPDF.
* Ob der Inhalt der XML der sichtbaren Rechnung entspricht — nicht automatisch entscheidbar.
* Verschlüsselte Dateien: Befund `PDFA3-ENCRYPT`; ihre Ströme werden nicht entschlüsselt.

## 5. Nachweis auf dem Korpus (`test/run-pdfa3-tests.cjs`)

Teil 1 prüft alle 151 PDFs des Korpus; die vollständige Liste der error/warning-Befunde ist im Test
festgeschrieben (`EXPECTED_CORPUS`, jeder Eintrag mit Begründung aus den PDF-Objekten). Schlechtester
Befund je PDF und Prüfung, Spalten correct (125) | fail (25) | other (1), je pass/error/warning/info/n.a.:

```
PDFA3-HEADER               125/0/0/0/0   | 25/0/0/0/0  | 1/0/0/0/0
PDFA3-HEADER-BINARY        125/0/0/0/0   | 24/1/0/0/0  | 1/0/0/0/0
PDFA3-TRAILER-ID           125/0/0/0/0   | 24/1/0/0/0  | 1/0/0/0/0
PDFA3-ENCRYPT              125/0/0/0/0   | 25/0/0/0/0  | 1/0/0/0/0
PDFA3-XMP-CATALOG          125/0/0/0/0   | 25/0/0/0/0  | 1/0/0/0/0
PDFA3-PDFAID-PART          125/0/0/0/0   | 25/0/0/0/0  | 0/1/0/0/0
PDFA3-PDFAID-CONFORMANCE   125/0/0/0/0   | 25/0/0/0/0  | 0/1/0/0/0
FX-XMP-NAMESPACE           122/0/3/0/0   | 25/0/0/0/0  | 0/1/0/0/0
FX-XMP-DOCUMENTTYPE        125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
FX-XMP-DOCUMENTFILENAME    125/0/0/0/0   | 24/1/0/0/0  | 0/0/0/0/1
FX-XMP-VERSION             122/3/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
FX-XMP-CONFORMANCELEVEL    124/1/0/0/0   | 24/1/0/0/0  | 0/0/0/0/1
FX-XMP-EXTENSION-SCHEMA    125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
FX-ATTACHMENT-PRESENT      125/0/0/0/0   | 25/0/0/0/0  | 0/1/0/0/0
FX-ATTACHMENT-UNIQUE       125/0/0/0/0   | 24/0/1/0/0  | 0/0/0/0/1
FX-ATTACHMENT-NAME         104/0/0/21/0  | 21/1/0/3/0  | 0/0/0/0/1
FX-FILENAME-MATCH          125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
FX-LEVEL-PROFILE           118/3/3/0/1   | 22/1/1/0/1  | 0/0/0/0/1
PDFA3-NAMETREE             125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
PDFA3-AF-CATALOG           125/0/0/0/0   | 24/0/1/0/0  | 0/0/0/0/1
PDFA3-FILESPEC-F-UF        125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
PDFA3-AFRELATIONSHIP       125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
FX-AFRELATIONSHIP-PROFILE  88/0/0/37/0   | 13/0/0/11/1 | 0/0/0/0/1
PDFA3-DESC                 121/0/0/4/0   | 25/0/0/0/0  | 0/0/0/0/1
PDFA3-EF-SUBTYPE           125/0/0/0/0   | 24/0/1/0/0  | 0/0/0/0/1
PDFA3-EF-PARAMS-MODDATE    125/0/0/0/0   | 25/0/0/0/0  | 0/0/0/0/1
PDFA3-FULL-VALIDATION      0/0/0/125/0   | 0/0/0/25/0  | 0/0/0/1/0
```

Befunde mit error/warning (14 PDFs), aus den Rohobjekten erklärt:

* `ZUGFeRDv2/fail/Mustangproject/wrongFilename.pdf` — Anlage und `fx:DocumentFileName` heißen
  `factur-y.xml` (der eingebaute Fehler): `FX-ATTACHMENT-NAME` und `FX-XMP-DOCUMENTFILENAME` (error).
* `ZUGFeRDv2/fail/FX-With-UBL-REC50304330.pdf` — `factur-x.xml` enthält UBL: `FX-LEVEL-PROFILE` (error),
  `/Subtype /application#2Fxml`: `PDFA3-EF-SUBTYPE` (warning).
* `ZUGFeRDv2/fail/MustangRE-20171118_506_ZUGFeRD1and2.pdf` — zwei Rechnungs-XML (ZUGFeRD-invoice.xml,
  Objekt 9, und factur-x.xml, Objekt 8): `FX-ATTACHMENT-UNIQUE` (warning).
* `ZUGFeRDv2/fail/python-factur-x/python-factur-x.pdf` (PyPDF2) — `%PDF-1.3` direkt gefolgt von
  `1 0 obj` (kein Binärkommentar), Trailer `<< /Size /Root /Info >>` ohne `/ID`, Katalog `/AF [7 0 R]`,
  während der Namensbaum `5 0 R` enthält: zwei inhaltsgleiche Dateispezifikationen (5 und 7), beide mit
  `/EF << /F 4 0 R /UF 4 0 R >>`. Die Datei ist damit über eine zweite Dateispezifikation zugeordnet,
  nicht über die des Namensbaums — mehrdeutig, daher warning statt error.
* `ZUGFeRDv1/fail/Mustangproject/fail1.pdf` — Profilkennung `…invoice:1p0:komfort` (Tippfehler):
  `FX-LEVEL-PROFILE` warning (nicht zuordenbar). `fail3.pdf` — kein `zf:ConformanceLevel` (error).
* `ZUGFeRDv1/correct/Mustangproject/…_499/_501/_502.pdf` — ZUGFeRD-1.0-Vorabversion: Namensraum
  `urn:ferd:pdfa:invoice:rc#` (warning), `zf:Version` „RC“ (error; auch nach Mustangs Werteliste Z. 272
  ungültig), XML `urn:ferd:invoice:rc:comfort` gegen `zf:ConformanceLevel` BASIC (error).
* `ZUGFeRDv1/correct/Mustangproject/…20170509_505.pdf` — kein `zf:ConformanceLevel` (error; nach
  Mustangs Code Z. 179-187 section 11).
* `ZUGFeRDv2/correct/symtrax/…/*_XRechnung*.pdf` (3) — XRechnung 1.2 mit ConformanceLevel „EN 16931“
  (ZUGFeRD 2.1 kannte XRECHNUNG noch nicht): `FX-LEVEL-PROFILE` warning.
* `unstructured/RE-E-974-Hetzner_….pdf` — gewöhnliches PDF ohne PDF/A-Kennung, XMP-fx und Anlage.

Die „correct“-Einträge mit error sind Altbestände (ZUGFeRD-1.0-RC, fehlendes ConformanceLevel), die
auch Mustangs Validator-Code als Fehler wertet; der Korpus-Ordner `correct/` dient vor allem Lesern.

Teil 2 (Mustang-Parität, 15 Test-PDFs aus `validator/src/test/resources` mit den Verdikten der
Mustang-Tests): 15/15 wie erwartet, davon eine dokumentierte Abweichung: `103767-Invoice-2026-03-24-1.pdf`
hat für `factur-x.xml` `/AFRelationship /Unspecified` — Mustangs Validator prüft AFRelationship nicht
(PDFValidatorTest.java Z. 193-200 erwartet kein `<error>`), wir melden error nach FileAttachment.java
Z. 93. Warnungen `FX-ATTACHMENT-UNIQUE` bei den Mustang-Beispielen mit factur-x.xml + ZUGFeRD-invoice.xml
sind keine Mustang-Fehler und als solche deklariert.

Teil 3 (Mutationen): 25 Mutationsarten (gleich lange Byte-Ersetzungen, Querverweis-Offsets bleiben
gültig; `/Encrypt` wird in den letzten klassischen Trailer eingefügt) auf allen Korpus-PDFs, die die
Anforderung vorher erfüllen: 3394 von 3394 mutierten PDFs erkannt, ohne andere als die deklarierten
Folgeänderungen.

## 6. Mustang-Parität je Prüfung

| ID | Mustang-Code mit derselben Regel |
|---|---|
| `PDFA3-HEADER` | teilweise: PDFValidator.java Z. 89-93 (`%PDF` am Anfang, section 20); Version/Zeilenende: nur veraPDF (Z. 99-133) |
| `PDFA3-HEADER-BINARY`, `PDFA3-TRAILER-ID`, `PDFA3-ENCRYPT` | nur über veraPDF: PDFValidator.java Z. 99-133, Ergebnis Z. 348-350 |
| `PDFA3-XMP-CATALOG` | PDFValidator.java Z. 155-157 (section 17), Z. 284-287 (section 28); Quelle Katalog: ZUGFeRDInvoiceImporter.java Z. 191-198 |
| `PDFA3-PDFAID-PART`, `-CONFORMANCE` | PDFValidator.java Z. 352-358 (section 23, Flavour aus veraPDF), Z. 59 |
| `FX-XMP-NAMESPACE` | keine (Mustang: `local-name()`, Z. 179-180); Namensräume ZUGFeRDExporterFromA3.java Z. 221-231 |
| `FX-XMP-DOCUMENTTYPE` | PDFValidator.java Z. 204-225 (13/14) |
| `FX-XMP-DOCUMENTFILENAME` | PDFValidator.java Z. 226-257 (21/19, notice 17) |
| `FX-XMP-VERSION` | PDFValidator.java Z. 258-283 (15/16) |
| `FX-XMP-CONFORMANCELEVEL` | PDFValidator.java Z. 179-202 (11/12) |
| `FX-XMP-EXTENSION-SCHEMA` | keine Prüfung (nur veraPDF); Erzeuger XMPSchemaPDFAExtensions.java Z. 114-157 |
| `FX-ATTACHMENT-PRESENT` | ZUGFeRDValidator.java Z. 291-298 |
| `FX-ATTACHMENT-UNIQUE` | keine; Importer überschreibt (ZUGFeRDInvoiceImporter.java Z. 295-302) |
| `FX-ATTACHMENT-NAME` | ZUGFeRDInvoiceImporter.java Z. 286-298 (nur diese Namen werden gelesen); Erzeuger Z. 252-264 |
| `FX-FILENAME-MATCH` | keine; Erzeuger ZUGFeRDExporterFromA3.java Z. 581-583, 695-708 |
| `FX-LEVEL-PROFILE` | keine; Zuordnung Profile.java Z. 43-51, Profiles.java Z. 34-50 |
| `PDFA3-NAMETREE` | ZUGFeRDInvoiceImporter.java Z. 200-222 (nur Namensbaum) |
| `PDFA3-AF-CATALOG` | keine Prüfung (nur veraPDF); Erzeuger ZUGFeRDExporterFromA3.java Z. 448-464 |
| `PDFA3-FILESPEC-F-UF` | keine Prüfung (nur veraPDF); Erzeuger Z. 403-408 |
| `PDFA3-AFRELATIONSHIP` | keine Prüfung (veraPDF: Vorhandensein); Werte FileAttachment.java Z. 80-95 |
| `FX-AFRELATIONSHIP-PROFILE` | Erzeuger ZUGFeRDExporterFromA3.java Z. 697-704 |
| `PDFA3-DESC` | Erzeuger Z. 409 |
| `PDFA3-EF-SUBTYPE` | keine Prüfung (veraPDF: MIME-Typ); Erzeuger Z. 415, 707-708 |
| `PDFA3-EF-PARAMS-MODDATE` | Erzeuger Z. 419 |
| `PDFA3-FULL-VALIDATION` | Mustang delegiert an veraPDF: PDFValidator.java Z. 97-137 |

## 7. veraPDF im CI (Job `pdfa-verapdf`)

veraPDF wird aus Maven Central bezogen; der Vergleich läuft deshalb im CI-Job `pdfa-verapdf` von
`.github/workflows/verify.yml` (lokal ebenso, wenn Maven Central erreichbar ist: dieselben Befehle). Der
Job führt aus:

1. `node tools/fetch-sources.cjs ext --only zugferd-corpus,mustangproject` (Korpus `82e886fb2136`,
   Mustangproject `c1618af86e68`, Commits aus `build/STANDARDS_MANIFEST.json`).
2. veraPDF **1.30.3** als Bibliothek `org.verapdf:validation-model-jakarta` — genau das Artefakt und die
   Version, mit denen Mustang validiert (Mustang `pom.xml` Z. 83, `validator/pom.xml` Z. 59-62; auf Maven
   Central veröffentlicht am 2026-10-08). Das CLI-Artefakt `org.verapdf.apps:greenfield-apps` ist auf
   Maven Central nur bis 1.28.2 veröffentlicht (javadoc.io- und mvnrepository-Verzeichnis); deshalb
   ruft der eigene Runner `tools/verapdf/VeraMrr.java` die Bibliothek auf. Jede verwendete API
   (`ValidatorConfigBuilder.defaultBuilder().flavour(..).build()`, `ProcessorFactory.fromValues(..)`,
   `fileBatchProcessor`, `getHandler(FormatOption.MRR, ..)`, `BatchProcessor.process(List<File>, ..)`,
   `PDFAFlavour.fromString`) wurde im Quelltext von veraPDF-library, Tag `v1.30.3`, nachgesehen und
   entspricht dem Aufruf in Mustangs `PDFValidator.java` Z. 97-137. Auflösung über `tools/verapdf/pom.xml`
   mit `mvn -C` (strikte Prüfsummen gegen die `.sha1` auf Maven Central), zusätzlich Prüfung des
   Haupt-Jars gegen `validation-model-jakarta-1.30.3.jar.sha1` und SHA-256 aller Jars in
   `build/reports/verapdf-artifacts.txt`.
3. `tools/verify-all.cjs --only pdfa3-container-checks,verapdf-compare-selftest` (schreibt
   `build/pdfa3-results.json`), dann `compare-verapdf.cjs --flavour-lists`: `3b.list` = alle PDFs,
   `3u.list`/`3a.list` = PDFs, deren XMP `pdfaid:conformance` U bzw. A angibt (19 bzw. 40).
4. `vera-mrr 3b|3u|3a build/verapdf/mrr-<fl>.xml <PDFs>` (ein MRR-Bericht je Flavour; Schritt scheitert,
   wenn der Bericht kein `</report>` enthält); die Zusammenfassung geht nach `build/reports/verapdf.txt`.
5. `tools/verify-all.cjs --only pdfa-verapdf` = `test/compare-verapdf.cjs`: Abgleich je Regelpaar
   (veraPDF-Regel nach Klausel + Text ↔ unsere Prüfung) mit Modus
   `exact` (Verschlüsselung, Trailer-ID, Dateikopf, F/UF, MIME-Typ, Aktionen 6.5.1 ↔ `PDFA3-ACTIONS`,
   Zusatzaktionen 6.5.2/6.4.1 ↔ `PDFA3-AA`), `ours-implies-vera` (pdfaid, XMP im Katalog, Erweiterungsschema:
   veraPDF prüft mehr), `vera-implies-ours` (AFRelationship: wir sind für die Rechnung strenger), `report` (ModDate,
   AF-Zuordnung, Dokument-JavaScript). Zum Korpus kommen die synthetischen PDFs mit aktiven Inhalten aus
   `test/active-pdfs.cjs` (`build/corpus/active-content`; ohne die Fälle mit unbrauchbarer Querverweistabelle, die nur
   den Leser des Prüfers betreffen). Abweichungen in den ersten drei Modi ⇒ Exit-Code 1.
   veraPDF-Fehler außerhalb der Container-Regeln (Schriften usw.) werden je Regel gezählt.
6. Artefakt `pdfa-verapdf`: `verapdf.txt`, `verapdf-artifacts.txt`, `pdfa-verapdf.txt`
   (Vergleich, mit Fingerprint), MRR-Dateien, `pdfa3-results.json`, `VERIFICATION.json`. Zusätzlich
   veröffentlicht der Job das Ergebnis als Check-Run „veraPDF report“ des Commits (Testreihen, vollständiger
   Vergleich `verapdf-compare.txt`, SHA-256 der veraPDF-Jars; abrufbar mit
   `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`). Der Job schlägt fehl, wenn eine der Testreihen
   `pdfa3-container-checks`, `verapdf-compare-selftest`, `pdfa-verapdf` nicht bestanden hat oder nicht
   gelaufen ist (`.github/scripts/check-run.cjs --require`).

Ergebnis des ersten CI-Laufs mit Check-Run (2026-10-20, Commit `1efb1dd`, Lauf 39400752941): veraPDF 1.30.3
bewertet 146 der 151 PDFs als PDF/A-3b-konform und 5 als nicht konform; der Abgleich mit den
Container-Prüfungen ergibt **0 Widersprüche in 11 Regelpaaren**. Fälle, die nur veraPDF meldet (zulässig in
den Modi `ours-implies-vera` und `report`): XMP-Paket nicht im Katalog (1, 6.6.2.1-1), Erweiterungsschema
(1, 6.6.2.3.1-2), AF-Zuordnung (1, 6.8-4). Außerhalb der Container-Regeln: 4 veraPDF-Regeln zu Schriften und
Farben (6.2.11.4.2-2 bei 3 PDFs, 6.2.4.3-2, 6.2.10-2, 6.2.4.3-4 bei je 1 PDF). PDF/A-3u: 19 von 19 PDFs
konform; PDF/A-3a: 38 von 40 (zweimal 6.2.11.4.2-2).


`test/compare-verapdf.cjs` ist gegen das MRR-Format geschrieben, wie Mustang es einbettet
(PDFValidator.java Z. 125-132 `FormatOption.MRR`; `doc/mustang-validation.xsd` Z. 57-195); `--selftest`
prüft Parser und Klassifikation an einem synthetischen Bericht (ohne veraPDF, Testreihe
`verapdf-compare-selftest`).
