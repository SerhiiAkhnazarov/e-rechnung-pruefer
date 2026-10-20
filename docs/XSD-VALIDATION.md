# XML-Schema-Validierung (XSD 1.0) – UBL 2.1 / CII D16B

Der KoSIT-Validator prüft jede Rechnung zuerst gegen das XML Schema des Syntaxformats
(`<validateWithXmlSchema>` in `scenarios.xml`) und führt die Schematron-Regeln nur aus, wenn das
Dokument schema-gültig ist. `src/xsd-validator.js` bildet diesen Schritt in JavaScript nach – ohne
Abhängigkeiten, im Browser (DOMParser-Dokument; geprüft in Chromium, WebKit – der Engine von Safari – und Firefox) und in Node (slimdom). Das
Urteil (gültig / ungültig) **und die Folge der Fehlercodes** sind nachweislich identisch mit denen des
JDK-eigenen Xerces (`javax.xml.validation`), also des Validators, den KoSIT verwendet.

## Quellbasis

Die Semantik ist aus dem Quelltext des JDK-21-Xerces übernommen (`openjdk/jdk21u`,
`src/java.xml/share/classes/com/sun/org/apache/xerces/internal/impl/xs/`), u. a.:
`models/CMBuilder.java` (kompakter Syntaxbaum mit `useRepeatingLeafNodes`), `models/XSDFACM.java`
(Glushkov-Automat, Zähler für wiederholte Blätter → Codes `cvc-complex-type.2.4.b/d/e–j`,
Konstantraum-Prüfung von `a{n,m}`), `XMLSchemaValidator.java` (Reihenfolge: Facetten-/Datentypcode,
danach Kontextcode, z. B. `cvc-datatype-valid.1.2.1` gefolgt von `cvc-complex-type.2.2`).
Stand der gelesenen Quellen: Tag `jdk-21.0.13+8`; das Verzeichnis `…/xerces/internal` ist
**unverändert** gegenüber `jdk-21.0.12.1-ga` (`git diff --stat jdk-21.0.12.1-ga jdk-21.0.13+8` leer),
der Version der Laufzeit, mit der die Referenz erzeugt wird (OpenJDK 21.0.12.1).

## Was geprüft wird

Vollständig umgesetzt ist alles, was der Schemasatz UBL 2.1 (inkl. CCTS-Modul, xmldsig-core,
XAdES 1.3.2/1.4.1) und CII D16B benutzt – und einiges darüber hinaus:

* Elementdeklarationen global/lokal/`ref`, Substitutionsgruppen, `abstract`, `nillable`,
  `fixed`/`default` (Wert gilt bei Element ohne Zeichen-Kinder), `block`;
* `xsi:type` (QName-Auflösung über die Namensräume des Dokuments, Ableitungsprüfung gegen den
  deklarierten Typ inkl. `block`, abstrakte Typen), `xsi:nil`, `xsi:schemaLocation` /
  `xsi:noNamespaceSchemaLocation` (werden akzeptiert, Hinweise werden – wie bei einem aus festen
  Quellen gebauten `Schema` – nicht verfolgt);
* komplexe Typen: `sequence`/`choice` (geschachtelt, mit Häufigkeiten), `simpleContent`
  extension/restriction, `complexContent` extension/restriction, `mixed`, leerer Inhalt,
  Attributverwendungen (required/optional/prohibited, `fixed`, `default`), `attributeGroup`,
  `anyAttribute`, `xs:any` mit `##any`/`##other`/`##local`/`##targetNamespace`/Liste und
  `processContents` strict/lax/skip (lax: Prüfung, wenn eine globale Deklaration existiert, sonst
  keine Bewertung; strict: Fehler ohne Deklaration);
* Inhaltsmodelle werden bei erster Verwendung in deterministische Automaten übersetzt
  (Glushkov-Positionsautomat → Teilmengenkonstruktion; die UPA-Regel garantiert Determinismus,
  eine Verletzung würde beim Bau gemeldet); die Prüfung der Kindelemente ist ein linearer
  Durchlauf;
* einfache Typen: Restriktionsketten mit den Facetten `enumeration`, `pattern` (XSD-Regex →
  JavaScript, inkl. `\d` = `\p{Nd}`, `\i`, `\c`, `\p{..}`, Klassen-Subtraktion), `length`,
  `minLength`, `maxLength` (in UTF-16-Einheiten wie Xerces), `totalDigits`, `fractionDigits`,
  `min/maxInclusive`, `min/maxExclusive`, `whiteSpace`; Varietäten `list` und `union`; alle
  eingebauten Datentypen mit den lexikalischen Regeln von Xerces (decimal, integer-Familie mit
  Wertebereichen, boolean, float, double, date, dateTime, time, gYear, gYearMonth, gMonth,
  gMonthDay, gDay, duration, base64Binary, hexBinary, anyURI – Portierung des Xerces-URI-Parsers
  samt XLink-Escaping –, QName, NOTATION, string, normalizedString, token, language, Name, NCName,
  NMTOKEN(S), ID, IDREF(S), ENTITY/ENTITIES; die XML-Namenszeichenklassen sind aus der
  `XMLChar`-Tabelle des JDK erzeugt);
* ID-Eindeutigkeit und IDREF-Auflösung über das gesamte Dokument.

Nicht umgesetzt (der Compiler bricht mit Fehlermeldung ab, statt still etwas zu ignorieren):
`xs:all`, Identitätsbedingungen (`xs:key`/`xs:unique`/`xs:keyref`), `xs:redefine`,
`xs:notation`. Keines dieser Konstrukte kommt in UBL 2.1, CII D16B, xmldsig oder XAdES vor
(nachgeprüft durch den Compiler, der sie zurückweisen würde).

## Erzeugung der Modelle

```sh
node tools/fetch-sources.cjs ext       # packt u. a. das OASIS-Paket ph-ubl/docs/UBL-2.1.zip nach ext/os-UBL-2.1 aus
sh tools/compile-xsd-models.sh ext     # = die folgenden Aufrufe (xsdrt/ = Laufzeitvariante ohne Dokumentation) und die Factur-X-Profile
node tools/compile-xsd.cjs ext/os-UBL-2.1/xsdrt/maindoc/UBL-Invoice-2.1.xsd    build/xsd/UBL-Invoice-2.1.json
node tools/compile-xsd.cjs ext/os-UBL-2.1/xsdrt/maindoc/UBL-CreditNote-2.1.xsd build/xsd/UBL-CreditNote-2.1.json
node tools/compile-xsd.cjs ext/ph-cii/ph-cii-d16b/src/main/resources/external/schemas/d16b/data/standard/CrossIndustryInvoice_100pD16B.xsd build/xsd/CII-D16B.json
```

`tools/compile-xsd.cjs` folgt `xs:import`/`xs:include` (auch Chamäleon-Includes), übernimmt
**alle** globalen Elemente, Attribute und benannten Typen der geladenen Dokumente (ein
lax/strict-Wildcard oder `xsi:type` kann jedes davon treffen – das Modell weiß genau das, was
Xerces weiß), lässt Annotationen weg, dedupliziert anonyme Typen strukturell und schreibt die
SHA-256 jedes gelesenen Schemadokuments in `sources`. Abgeleitete Typen speichern nur ihre eigenen
Attribute/Partikel; die effektiven Attributmengen und Inhaltsmodelle setzt die Laufzeit zusammen
(UBL hat ~1 200 trivial abgeleitete Typen – so bleibt das JSON klein). Vor dem Schreiben baut der
Compiler mit der Laufzeit jeden Automaten und löst jeden Typ auf, ein nicht ausführbares Modell
wird nie geschrieben.

Größen (wie in `build/STANDARDS_MANIFEST.json`, Abschnitt `derived`): `UBL-Invoice-2.1.json` 218 298 Byte,
`UBL-CreditNote-2.1.json` 218 242 Byte, `CII-D16B.json` 64 647 Byte (jeweils in sich vollständig). Die beiden UBL-Modelle teilen sich
~99 % des Inhalts; ein gemeinsames Modell (`node tools/compile-xsd.cjs Invoice.xsd CreditNote.xsd
out.json`) wäre möglich, entspräche aber nicht exakt dem KoSIT-Verfahren (dort kennt das
Invoice-Schema die CreditNote-Deklaration nicht; der Unterschied träfe nur verschachtelte
Wurzelelemente in `ext:ExtensionContent`/`ds:Object`), deshalb werden drei Modelle ausgeliefert.
Das kompilierte `xsd/`-Original (mit Dokumentation, 2,8 MB Quelltext) ergibt ein byte-identisches
Modell wie `xsdrt/` (0,6 MB).

## Herkunft der Schemadateien

| Quelle | Herkunft | Nachweis |
|---|---|---|
| UBL 2.1 | OASIS Standard os-UBL-2.1 (04.11.2013), Paket `UBL-2.1.zip` aus dem ph-ubl-Repository (`docs/UBL-2.1.zip`, Commit `31ded97ab4013a5959f5b1ad582c5b81506c18cf`, 2026-10-17) | SHA-256 des Zips `60b80d76394a8a2add90723ecb8e0e2e9d826775de9749df37a72d60703f86ed`; Dateiköpfe „UBL 2.1 OS, Release Date 04 November 2013“; KoSIT entpackt aus genau diesem Paket `xsdrt/**/*.xsd` (build.xml der validator-configuration-xrechnung) |
| CII D16B | UN/CEFACT CrossIndustryInvoice 100.D16B, „uncoupled“ (ohne Codelisten) – `ph-cii-d16b/src/main/resources/external/schemas/d16b/data/standard/` im ph-cii-Repository, Commit `d367ec9dfc5248e423cdbb1b245e4b026f3a3756` (2026-10-08) | byte-identisch (SHA-256) mit `cii/schema/D16B SCRDM (Subset)/uncoupled clm/` im CEN-Repository eInvoicing-EN16931; KoSIT nutzt `d16b-cii-uncoupled.zip` |
| Wurzelschemata | `scenarios.xml` (validator-configuration-xrechnung `b436fc4b…`, v2026-08-31): `resources/ubl/2.1/xsd/maindoc/UBL-Invoice-2.1.xsd`, `…/UBL-CreditNote-2.1.xsd`, `resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd` | genau diese drei Dokumente sind die Wurzeln der drei Modelle |

Die SHA-256 aller 14 bzw. 4 Schemadokumente stehen in den Modellen (`sources`) und im Bericht
`build/reports/xsd-vs-xerces.txt`.

Hinweis zu ph-ubl: Die im ph-ubl-Repository ausgepackten Dateien
(`ph-ubl21/src/main/resources/external/schemas/ubl21/`) sind die CS1-Generation derselben Schemata
(Kopfzeile „UBL 2.1 CS1, Generated on 2013-06-16“), bei denen ph-ubl die `schemaLocation` der
Importe von CCTS-, xmldsig- und XAdES-Namensraum entfernt hat (Auflösung über ph-xsds-Artefakte);
`CCTS_CCT_SchemaModule-2.1.xsd`, `UBL-xmldsig-core-schema-2.1.xsd`, `UBL-XAdESv132-2.1.xsd` und
`UBL-XAdESv141-2.1.xsd` fehlen dort. Allein sind diese Dateien weder für Xerces
(`src-resolve: Cannot resolve the name 'ccts-cct:IdentifierType'`) noch für den Compiler
verwendbar; deshalb wird das vollständige OASIS-Paket benutzt, das ph-ubl ebenfalls mitführt.

## Nachweis der Xerces-Gleichheit

Referenz: `test/xsd-oracle/XsdOracle.java` (OpenJDK 21.0.12.1, `javax.xml.validation` =
Xerces 2.12.2) validiert jede Datei gegen das Wurzelschema, das der Namensraum des
Wurzelelements bestimmt (Invoice-2 → UBL-Invoice, CreditNote-2 → UBL-CreditNote, CII:100 → CII;
alles andere → UBL-Invoice, damit beide Seiten dasselbe vergleichen), und schreibt eine JSON-Zeile
je Datei (`build/oracle/xsd/*.jsonl`). `test/run-xsd-tests.cjs` lässt unseren Validator über
dieselben Dateien laufen und vergleicht die Urteile.

```sh
sh test/xsd-oracle/run-xsd-oracle.sh                       # Xerces über alle Korpora (javac + java)
node test/build-xsd-mutations.cjs --zugferd ext/zugferd-corpus   # 150 gültige Basisdokumente (unverändert mitgeprüft) + 3 025 Mutationen + 432 Sonden
sh test/xsd-oracle/run-xsd-oracle.sh xsd-mutations build/corpus/xsd-mutations
node test/run-xsd-tests.cjs --report build/reports/xsd-vs-xerces.txt
node test/xsd-selftest.cjs --report build/reports/xsd-vs-xerces.txt   # synthetisches Schema für die sonst unbenutzten Konstrukte
node test/xsd-browser.cjs  --report build/reports/xsd-vs-xerces.txt   # derselbe Code in Chromium mit DOMParser
```

Ergebnis (Bericht vom 2026-10-19, `build/reports/xsd-vs-xerces.txt`; verglichen werden Urteil **und**
Fehlercodes in Reihenfolge):

| Korpus | Dokumente | Xerces gültig | ungültig | identisch (Urteil + Codes) | Abweichungen |
|---|---:|---:|---:|---:|---:|
| xr-ubl (XRechnung-Testsuite UBL inkl. XML-Mutate) | 1 050 | 976 | 74 | 1 050 | 0 |
| xr-cii | 581 | 568 | 13 | 581 | 0 |
| cen-ubl (CEN-Unit-Tests) | 1 131 | 0 | 1 131 | 1 131 | 0 |
| cen-cii | 9 | 0 | 9 | 9 | 0 |
| extra-ubl / extra-cii (Testsuite, Konfigurations-Testmaterial) | 68 / 73 | 67 / 73 | 1 / 0 | 141 | 0 |
| zugferd (ZUGFeRD/Factur-X-Beispiele, PEPPOL, fatturaPA) | 89 | 74 | 15 | 89 | 0 |
| xsd-mutations (generiert, s. u.) | 3 607 | 973 | 2 634 | 3 607 | 0 |
| **gesamt** | **6 608** | **2 731** | **3 876** | **6 608** | **0** |

Factur-X-Profilschemata (`test/run-facturx-xsd-tests.cjs`): jedes CII-Dokument gegen jedes der fünf
Profil-XSD, 5 905 Prüfungen, Urteile und Codes 5 905 identisch.

Dazu: `test/xsd-selftest.cjs` – 255 Instanzen eines synthetischen Schemas
(`test/xsd-selftest/features.xsd`: pattern, list, union, IDREF/IDREFS, g*-Typen, duration,
float/double, hexBinary, QName, Substitutionsgruppen, nillable, fixed/default-Elementwerte,
begrenzte Häufigkeiten inkl. Zählerfälle, anyAttribute lax/strict/skip, Chamäleon-Include,
qualifizierte Attribute …): 255 identisch (Urteil + Codes), 0 Abweichungen. `test/xsd-browser.cjs` –
1 053 Dokumente im Browser (DOMParser): Urteile, Fehlercodes und Fundstellen identisch mit dem
Node-Lauf – Chromium und WebKit lokal und im CI, Firefox im CI (Testreihen `xsd-browser-*`).

Die Referenz wird bei jedem vollständigen Lauf von `tools/verify-all.cjs` neu erzeugt (Stufe
`ref-xerces`).

Die Mutationen (`test/build-xsd-mutations.cjs`, `build/corpus/xsd-mutations/MANIFEST.json`):
modellgesteuert je Basisdokument Pflichtelement entfernen, maxOccurs=1-Element verdoppeln,
Geschwister vertauschen, unbekanntes Element/Attribut einfügen, Buchstaben in Dezimalzahl,
falsches Datumsformat, Pflichtelement leeren, `xsi:nil`, Pflichtattribut entfernen
(`currencyID`), namensraumloses Element, Element aus fremdem Namensraum, Text in
Element-only-Inhalt, falscher fester Attributwert (CII `listID`), `xsi:type` falsch/gleich,
fremder Wurzel-Namensraum, UBLExtensions (fremd/leer/bekannt-ungültig/bekannt-gültig/ohne
Namensraum/eigener Namensraum/zwei Kinder); dazu 432 handgeschriebene Sonden für jeden benutzten
Datentyp und jedes Strukturmerkmal (decimal 30 Werte, date 35, dateTime 28, time 10, boolean 10,
integer 11, base64Binary 22, anyURI 88, language 16, Längenfacetten 20, ID 11, xsi:* ~25,
Wildcards strict/lax/skip, mixed/leerer Inhalt, Aufzählungen, Signatur-/XAdES-Strukturen …).
Aufzählungstypen mit `xs:enumeration` kommen in den Rechnungs-Inhaltsmodellen nicht vor (nur
XAdES `QualifierType`), weshalb die generische Mutation „falscher Aufzählungswert“ keine Ziele
findet; die Facette ist über die Sonden `enum-*` und das Selbsttest-Schema nachgewiesen.

Durch die Sonden belegte Xerces-Feinheiten, die exakt übernommen sind: Längenfacetten zählen
UTF-16-Einheiten (`'😀😀'` hat Länge 4); leerer Inhaltstyp und `xsi:nil="true"` verbieten auch
reine Leerraum-Textknoten, Element-only-Inhalt erlaubt sie; `xs:decimal` akzeptiert `1.`, `.5`,
`+1`, `00`, nicht aber `1e5`, `1,5`, Unicode-Ziffern; `xs:date`/`dateTime` verlangen vierstellige
Jahre (fünfstellig ohne führende Null), Jahr 0000 ist ungültig, `24:00:00` gültig, Sekunde 60
ungültig, Zeitzonen −14:00…+14:00; `base64Binary` nach Entfernen von Leerraum (`QUJ=` ungültig
wegen Bit-Rest, `QUJD RA= =` gültig); `anyURI` nach dem Xerces-URI-Parser (`a b`, `ü`, `{`
gültig; `:x`, `1x:y`, `%zz`, `a[b]`, `foo://`, `//` ungültig); `##other` schließt den
Zielnamensraum und „kein Namensraum“ aus, unbekannte Namensräume sind „other“; feste
Attributwerte werden im Wertraum verglichen (` 1001 ` entspricht `1001` bei `token`);
`xml:lang`/`xml:space` sind ohne Deklaration nicht erlaubt; ein Wurzelelement ohne Deklaration
wird nur über `xsi:type` bewertet, sonst ist `cvc-elt.1.a` der einzige Fehler; nach einem
Inhaltsmodellfehler werden Kinder wie bei Xerces mit der nächstpassenden Deklaration
weitergeprüft (nur die Fehlerliste, nicht das Urteil, hängt davon ab).

## Laufzeit

3,00-MB-UBL-Rechnung mit 2 000 Positionen (48 079 Elemente): Node 22 59–74 ms je Validierung
(erster Lauf inkl. Automatenbau), Chromium 85–101 ms; slimdom-Parsing 404 ms, DOMParser 80 ms.
Modell laden (`JSON.parse` + `create`): 2–5 ms. Gesamter Korpus (6 608 Dokumente) 11,3 s in Node.

## Verwendung

```js
const XsdValidator = require('./src/xsd-validator.js');          // Browser: window.XsdValidator
const v = XsdValidator.create(JSON.parse(modelJson));            // einmal je Modell
const result = v.validate(doc);                                  // DOM Document
// result.valid: boolean
// result.errors: [{ code: 'cvc-complex-type.2.4.a', message: 'Unerwartetes Element …',
//                   location: '/ubl:Invoice[1]/cac:InvoiceLine[3]/cbc:ID[1]', line: null }]
```

`code` ist der Bezeichner der XML-Schema-Regel, den Xerces für dieselbe Situation ausgibt;
`location` hat die Form der Schematron-Fundstellen (`nodePath` in `src/schematron.js`,
Attribute als `/…/@currencyID`); `line` bleibt `null` (DOM ohne Zeileninformation).
Empfohlener Ablauf wie bei KoSIT: XSD zuerst; bei `valid === false` keine Schematron-Prüfung.
Fehler eines Modells (z. B. veraltetes JSON-Format) werfen eine Exception in `create`.

## Grenzen

* Nicht unterstützte Konstrukte s. o. – keines wird von den Rechnungsschemata benutzt.
* `xs:pattern` wird in JavaScript-RegExp übersetzt (Klassen-Subtraktion `[a-z-[aeiou]]` mit dem
  Flag `v`: Safari ≥ 17, Chrome ≥ 112, Firefox ≥ 116; `\p{..}` nach den Unicode-Tabellen der
  JavaScript-Engine). Die ausgelieferten Modelle enthalten **keine** Pattern-Facetten (UBL 2.1,
  CII D16B und die ZF_250-Schemata deklarieren keine `xs:pattern`, geprüft mit `grep`); der Pfad
  wird nur vom Selbsttest-Schema ausgeübt.
* Fehlerpositionen sind Knotenpfade, keine Zeilennummern.
