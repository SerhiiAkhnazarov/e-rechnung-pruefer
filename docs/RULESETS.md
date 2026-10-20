# Regelwerke: Peppol BIS Billing 3.0 und Factur-X / ZUGFeRD (ZF_250)

Neben CEN EN 16931 und XRechnung (KoSIT) prüft der Prüfer zwei weitere Familien. Welche Regelwerke
für ein Dokument gelten, steht als Daten in `build/rulesets.json` (Abschnitt 4); die Nachweise in
`build/reports/` (Abschnitt 6).

**Auslieferung:** Die Factur-X-/ZUGFeRD-Regelwerke sind im Programm enthalten (Apache 2.0 nach den
Nutzungsrechten von FeRD, Abschnitt 5). Die vollständigen Peppol-Regelwerke sind **nicht** enthalten
und **nicht** im Repository (keine Lizenz zur Weitergabe, Abschnitt 5): Sie werden nur lokal für die
Testreihen kompiliert (`build/schemas/PEPPOL-*.json` steht in `.gitignore`); im Programm lädt der
Benutzer die offiziellen Dateien selbst (Bereich „Regelwerke laden“). Das Programm kompiliert sie im
Browser mit demselben Compiler (`src/sch-compiler.js`) – Ergebnis inhaltsgleich mit dem Node-Build (JSON ohne die Herkunftsfelder `sources`/`importedFrom`),
nachgewiesen in `test/peppol-import-browser.cjs` – und zeigt an, ob die SHA-256 der Datei der geprüften
Fassung (3.0.21) entspricht; eine andere Fassung wird als „nicht gegen Referenz verifiziert“ markiert.

| Regelwerk (`build/schemas/`) | Quelle | Muster / Regeln / Asserts | JSON-Datei (Byte, wie in `build/STANDARDS_MANIFEST.json`) |
|---|---|---:|---:|
| `PEPPOL-UBL` | `peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-UBL.sch` | 13 / 99 / 165 | 138 767 B (nur lokal) |
| `PEPPOL-CII` | `peppol-bis-invoice-3/rules/sch/PEPPOL-EN16931-CII.sch` | 7 / 63 / 91 | 88 572 B (nur lokal) |
| `FACTUR-X-MINIMUM` | Mustangproject `validator/src/main/resources/schematron/ZF_250/FACTUR-X_MINIMUM.sch` + `_codedb.xml` | 5 / 39 / 66 | 65 505 B |
| `FACTUR-X-BASIC-WL` | `…/ZF_250/FACTUR-X_BASIC-WL.sch` + `_codedb.xml` | 47 / 179 / 337 | 250 069 B |
| `FACTUR-X-BASIC` | `…/ZF_250/FACTUR-X_BASIC.sch` + `_codedb.xml` | 63 / 248 / 472 | 417 523 B |
| `FACTUR-X-EN16931` | `…/ZF_250/FACTUR-X_EN16931.sch` + `_codedb.xml` | 66 / 373 / 627 | 526 391 B |
| `FACTUR-X-EXTENDED` | `…/ZF_250/FACTUR-X_EXTENDED.sch` + `_codedb.xml` | 82 / 982 / 1 464 | 1 203 335 B |

XSD-Modelle (`build/xsd/`, `tools/compile-xsd.cjs`): `FACTUR-X-MINIMUM` 7 934 B, `-BASIC-WL` 11 809 B,
`-BASIC` 13 169 B, `-EN16931` 15 463 B, `-EXTENDED` 21 678 B (je 4 Schemadokumente aus
`validator/src/main/resources/schema/ZF_250/<PROFIL>/`).

## 1. Peppol BIS Billing 3.0 (vollständig)

Im XRechnung-Regelwerk stecken die von KoSIT übernommenen Peppol-Regeln (Whitelist `rule-list.xml`,
Teil des Apache-2.0-Releases von KoSIT). `PEPPOL-UBL`/`PEPPOL-CII` (vom Benutzer zu laden, s. o.) sind die vollständigen OpenPeppol-Regelwerke einschließlich der
nationalen Regeln (Muster `DE`, `DK`, `GR`, `IT`, `NL`, `NO`, `SE` innerhalb derselben `.sch`-Datei,
aktiviert über Verkäufer-/Käuferland). Stand: Branch `2026-Q2-QA2`, Commit
`806866bd2bd91d7e9623b68f08164e8fbe9e67a0` (2026-06-10), Kopfkommentar „Last update: 2026 May
release 3.0.21“.

Kompilierung: `node tools/compile-sch.cjs <repo>/rules/sch/PEPPOL-EN16931-UBL.sch build/schemas/PEPPOL-UBL.json --id PEPPOL-UBL`
(CII analog). 13 bzw. 12 `xsl:function` werden inline aufgelöst, die rekursive `u:addPIVA` zur
Laufzeit registriert.

Wie Peppol prüft (`rules/buildconfig.xml`): die Konfigurationen
`peppolbis-en16931-01-3.0-ubl-invoice|creditnote`, `…-02-3.0-…` und `peppolbis-en16931-01-3.0-cii`
erben XSD (UBL 2.1 bzw. CII D16B uncoupled), die CEN-Regeln und das Peppol-Regelwerk. Daraus folgt die
Reihenfolge `["EN16931-UBL", "PEPPOL-UBL"]` bzw. `["EN16931-CII", "PEPPOL-CII"]`. Hinweis: das
Peppol-Repository bündelt CEN TC434 **1.3.14.1** (`rules/sch/README.md`); hier wird CEN **1.3.16**
verwendet (dieselbe Version wie KoSIT).

Versionsbeobachtung (`tools/check-drift.cjs`, wöchentlich `.github/workflows/drift.yml`): OpenPeppol
bereitet das November-Release auf den Branches `2026-Q4-DEV`, `2026-Q4-QA1`, `2026-Q4-MR` vor (Stand
2026-10-19, noch kein Release-Tag). Lädt der Benutzer eine neuere offizielle Datei, prüft das Programm
damit und weist die Abweichung von der geprüften Fassung aus.

## 2. Factur-X / ZUGFeRD (Mustangproject „ZF_250“)

**Version:** Die Dateien sind **Factur-X 1.09.2 / ZUGFeRD 2.5.2**, nicht ZUGFeRD 2.3 / Factur-X
1.0.07. Belege: Kopf jeder `.sch` und `_codedb.xml` „Factur-X release metadata / Version: 1.09.2 /
Release date: 2026-08-04 / Effective date: 2026-09-01“; Titel z. B. „Schema for Factur-X; 1.09.2;
EN16931-COMPLIANT (FULLY)“; `History.md` (Mustang 2.25.0, 2026-08-04): „#1216 ZUGFeRD 2.5.2 and
Factur-X 1.09.2“. Die XSD-Dateien tragen keinen Kopf; ihre Herkunft ergibt sich nur aus dem
Verzeichnis `schema/ZF_250/` und aus `XMLValidator.java`, der sie zusammen mit den Schematron-Dateien
lädt. Mustangproject-Commit: `c1618af86e687eb8c55f476d7b17575c6f99e3ca` (2026-10-16, flacher Klon).

**Codelisten (`document()`):** alle 366 Aufrufe haben die Form
`document('FACTUR-X_<P>_codedb.xml')/codedb/cl[@id=N]/enumeration[@value=$codeValueN]`.
`tools/compile-sch.cjs` bettet die Datei als Variable `$__document_1` ein, in kompakter Form
(`minifyXml`: XML-Deklaration, Kommentare und Leerraum-Textknoten zwischen Elementen entfernt; da nur
Elemente und Attribute navigiert werden, ist das Ergebnis jeder Abfrage identisch; SHA-256 und Größe
des Originals stehen in `documents[]`). Ersparnis 16–17 % (EXTENDED: 266 730 → 223 798 B).

**Enthält das EN16931-Profil die EN-Regeln?** Vergleich der Assert-IDs mit `EN16931-CII`
(806 IDs): `FACTUR-X-EN16931` hat 433 IDs, davon 214 gemeinsam — die Geschäftsregeln `BR-*`,
`BR-CO-*`, `BR-S-*` … —, aber **keine** der Syntaxregeln `CII-SR-*`, `CII-DT-*` und keine
Codelistenregeln `BR-CL-*` (diese sind durch `FX-SCH-A-*` mit der codedb ersetzt). BASIC: 209 gemeinsam,
BASIC-WL 141, MINIMUM 18, EXTENDED 162 (EXTENDED ersetzt die EN-Regeln durch `BR-FXEXT-*`). Mustang
führt deshalb für BASIC und EN16931 (und XRechnung) zusätzlich das CEN-CII-Regelwerk aus
(`XMLValidator.java` Z. 420–428: `if (isXRechnung || isBasic || isEN16931) validateSchematron(…
EN16931-CII-validation.xslt …)`), für MINIMUM, BASIC WL und EXTENDED nicht. `rulesets.json` folgt dem.

## 3. Kennungen (`GuidelineSpecifiedDocumentContextParameter/ram:ID`)

| Profil | Factur-X 1.0 / ZUGFeRD ≥ 2.1 | ZUGFeRD 2.0 (noch zulässig) |
|---|---|---|
| MINIMUM | `urn:factur-x.eu:1p0:minimum` | `urn:zugferd.de:2p0:minimum` |
| BASIC WL | `urn:factur-x.eu:1p0:basicwl` | `urn:zugferd.de:2p0:basicwl` |
| BASIC | `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic` | `urn:cen.eu:en16931:2017#compliant#urn:zugferd.de:2p0:basic` |
| EN 16931 (COMFORT) | `urn:cen.eu:en16931:2017` | (gleich) |
| EXTENDED | `urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended` | `urn:cen.eu:en16931:2017#conformant#urn:zugferd.de:2p0:extended` |
| XRECHNUNG (ZUGFeRD ≥ 2.1.1) | XRechnung-Kennung, z. B. `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` → KoSIT-Szenario | |

Quelle: `<cl id="1">` der fünf `FACTUR-X_<P>_codedb.xml` (geprüft von `FX-SCH-A-000026`), sowie
`XMLValidator.java` Z. 366–375. Im Korpus vorkommende **fehlerhafte** Altformen
(`urn:cen.eu:en16931:2017:compliant:factur-x.eu:1p0:basic`, `…:extended`) wählt Mustang über
Teilstring-Vergleich; die codedb lehnt sie ab — in `rulesets.json` als `deprecatedId`.
ZUGFeRD 1.0 (`urn:ferd:CrossIndustryDocument:invoice:1p0:*`, Wurzel `CrossIndustryDocument`) ist eine
andere Syntax und wird nicht unterstützt. XRechnung 1.x/2.x (`urn:xoev-de:kosit:standard:xrechnung_*`):
kein gültiges KoSIT-Regelwerk mehr, nur EN 16931.

Peppol: `cbc:CustomizationID` (UBL) bzw. `GuidelineSpecifiedDocumentContextParameter/ram:ID` (CII)
beginnt mit `urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`
(`guide/syntax/profile.adoc`, Regel `PEPPOL-EN16931-R004`: `starts-with(...)` und kein `::`);
`cbc:ProfileID` (BT-23, `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0` oder
`urn:peppol:bis:billing_with_response`) wählt innerhalb des Regelwerks das Profil (`$profile`).

## 4. `build/rulesets.json`

Je Syntax (`UBL`, `CII`) eine geordnete Liste; der erste Treffer gilt (`match`: `exact` oder
`prefix`, Vergleich nach `normalize-space`). Felder: `family`, `ruleSets` (Reihenfolge der
Ausführung, Meldungen werden vereinigt), `xsd` (`by-root` = UBL-Invoice/CreditNote nach Wurzel),
`delegate: "scenarios.json"` (für XRechnung ist die KoSIT-Szenarioauswahl maßgeblich, inkl.
customLevel), `en16931Compliant`, `deprecatedId`, `status`, `note`, `source`.

| Kennung | Regelwerke | XSD |
|---|---|---|
| UBL XRechnung 3.0 (+ Extension, CVD) | EN16931-UBL, XRechnung-UBL (KoSIT) | UBL 2.1 |
| UBL `…#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0` (Präfix) | EN16931-UBL, PEPPOL-UBL | UBL 2.1 |
| UBL `urn:cen.eu:en16931:2017` | EN16931-UBL | UBL 2.1 |
| CII XRechnung 3.0 (+ Extension, CVD) | EN16931-CII, XRechnung-CII (KoSIT) | CII D16B |
| CII Peppol (Präfix) | EN16931-CII, PEPPOL-CII | CII D16B |
| MINIMUM (FX + ZF 2.0) | FACTUR-X-MINIMUM | FACTUR-X-MINIMUM |
| BASIC WL (FX + ZF 2.0) | FACTUR-X-BASIC-WL | FACTUR-X-BASIC-WL |
| BASIC (FX + ZF 2.0) | FACTUR-X-BASIC, EN16931-CII | FACTUR-X-BASIC |
| `urn:cen.eu:en16931:2017` (CII) | FACTUR-X-EN16931, EN16931-CII | FACTUR-X-EN16931 (im PDF); `xsdStandalone`: CII-D16B |
| EXTENDED (FX + ZF 2.0) | FACTUR-X-EXTENDED | FACTUR-X-EXTENDED |

Zur CII-Kennung `urn:cen.eu:en16931:2017`: sie bezeichnet sowohl das Factur-X-Profil EN 16931 als
auch „reines“ EN 16931 in CII. Im PDF-Container gilt das Profil-XSD (wie Mustang); eine eigenständige
CII-Datei ist nach EN 16931 an CII D16B gebunden (`xsdStandalone`). Die Entscheidung trifft der Kern
anhand des Containers.

## 5. Lizenz und Herkunft

* **Peppol:** Kein LICENSE im Repository. `guide/bis/introduction.adoc`, „Statement of copyright“:
  „OpenPeppol AISBL holds the copyright of this Peppol BIS, developed and published subject to the
  conditions of the agreement between the European Commission and CEN allowing derivate works to be
  developed and distributed with no additional licensing requirements.“ und „This Peppol BIS document
  may not be modified, re-distribute, sold or repackaged in any other way without the prior consent of
  OpenPeppol AISBL.“ Der Kopf der `.sch`: „This schematron uses business terms defined the
  CEN/EN16931-1 and is reproduced with permission from CEN. CEN bears no liability …“. Die
  Weiterverbreitungsklausel bezieht sich wörtlich auf das BIS-*Dokument*; eine ausdrückliche Lizenz
  für die Schematron-Dateien enthält das Repository nicht (KoSIT übernimmt die Whitelist-Regeln
  daraus in seine Apache-2.0-Konfiguration).
* **Mustangproject:** Apache-2.0 (`LICENSE`; `pom.xml` Z. 208–215 `<license><name>Apache-2.0</name>`;
  `validator/README.md` Z. 157–159 „Permissive Open Source APL2, see LICENSE“). `NOTICE` nennt
  PDFBox, VeraPDF, ph-schematron, KoSIT, CEN usw., aber **nicht** FNFE-MPE/FeRD.
* **Factur-X/ZUGFeRD-Artefakte (FNFE-MPE / FeRD):** In den ZF_250-Dateien steht nur der Versionskopf.
  Die Nutzungsrechte veröffentlicht FeRD auf „Disclaimer and rights of use ZUGFeRD“
  (https://www.ferd-net.de/en/ueber-uns/ressourcen-1/veroeffentlichungen/disclaimer-and-rights-of-use-zugferd,
  abgerufen 2026-10-19): „For the use of the ZUGFeRD Technical Artifacts (Schemata and Schematron) the
  Apache 2.0 license conditions apply.“ Dieselbe Seite verlangt für Anwendungen, die die
  Veröffentlichung benutzen, einen sichtbaren Hinweis, dass es sich um eine Anwendung der
  Veröffentlichung handelt und die Wiedergabe mit Erlaubnis von CEN und DIN erfolgt; der Hinweis steht
  in `legal/FERD-FACTURX-NOTICE.txt`, in `NOTICE` und im Programm (Abschnitt „Lizenzen“). Die
  XML-Schemata sind von UN/CEFACT CII D16B abgeleitet (Hinweis `legal/UNCEFACT-NOTICE.txt`).

## 6. Nachweise

* `node test/run-peppol-tests.cjs <peppol-bis-invoice-3>` — VEFA-Unit-Tests `rules/unit-UBL-*`,
  `rules/unit-CII-*` (gleiche Semantik wie `test/run-cen-tests.cjs`; `@configuration` →
  Regelwerke wie in `buildconfig.xml`; `unit-SBDH` = Umschlagregeln, kein Rechnungsregelwerk).
* `sh test/build-oracle-xsl.sh <dir>` — Saxon HE 12.8 + ISO-Skeleton (include → abstract → svrl)
  für alle 7 Quellen; die codedb-Dateien liegen neben dem XSLT, `document()` löst also relativ zum
  Stylesheet genau wie neben der `.sch` auf. `node test/build-corpus.cjs --append --peppol … --zugferd …`
  erzeugt `build/corpus/peppol-{ubl,cii}` (Beispiele, Snippets, alle Unit-Test-Fragmente) und
  `build/corpus/zugferd-{ubl,cii}` (XML-Dateien + aus PDF extrahierte XML; zwei Qvalia-Lasttests
  > 5 MB ausgenommen). `sh test/run-oracle.sh … --sets PEPPOL,FACTUR-X` und
  `node test/compare-oracle.cjs` vergleichen Multimengen (id, flag, location).
* `node test/run-facturx-tests.cjs` — ZUGFeRD-Korpus nach Profil, Erwartung nach Verzeichnis
  (`correct/`, `PEPPOL/Valid` gültig; `fail/` fehlerhaft), jede Meldung gegen Saxon.
  Ergebnis 2026-10-19: 167 Dokumente, 296 Saxon-Vergleiche identisch. Von 91 als gültig einsortierten
  Dokumenten sind 64 nach den heutigen Regeln gültig; die 27 übrigen verletzen Regeln von ZF_250 bzw.
  EN 16931 1.3.16 (überwiegend Beispiele aus ZUGFeRD 2.0/2.1, z. B. „marked as not used“-Regeln der
  Profile MINIMUM/BASIC WL, `BR-CL-25`, `FX-SCH-A-000571`, XSD `cvc-complex-type.2.4.a/d`) – **jede
  dieser Meldungen erzeugt Saxon mit den offiziellen Stylesheets identisch**, es ist also der
  Korpus-Stand, keine Abweichung der Engine (Liste mit Regeln in `build/reports/facturx-corpus-tests.txt`).
  Von 22 als fehlerhaft einsortierten Dateien beanstanden die Regeln 19; die 3 übrigen
  (`wrongFilename.pdf`, `noNetPriceValidation.xml`, `ZUGFeRD_2_fully_compliant_complete.pdf`) enthalten
  eine regelkonforme XML. Bei `wrongFilename.pdf` meldet die Container-Prüfung den Fehler
  (falscher Anhangsname, `docs/PDFA3-CHECKS.md`). Die beiden anderen bestehen XSD, Schematron (wie bei
  Saxon) und die Container-Prüfung; der Korpus nennt keinen Grund. Einschätzung: der Fehler liegt in
  einer Prüfung außerhalb der veröffentlichten Regelwerke (Mustangs zusätzliche Rechen- bzw.
  PDF-Prüfungen) – solche Prüfungen sind nicht normativ und werden nicht nachgebildet.

* `sh test/xsd-oracle/run-facturx-xsd-oracle.sh` + `node test/run-facturx-xsd-tests.cjs` — die fünf
  Profil-XSD gegen JDK-Xerces über alle CII-Dokumente.

Alle Läufe über `node tools/verify-all.cjs` (Fingerprint, `build/reports/VERIFICATION.json`).
