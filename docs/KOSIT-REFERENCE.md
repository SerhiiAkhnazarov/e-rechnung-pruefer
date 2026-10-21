# KoSIT-Validator als Referenz: Prüfablauf, Kommandozeile, Re-Implementierung

Dieses Dokument beschreibt den Prüfablauf des offiziellen KoSIT-Validators (Java) so genau, dass
er nachgebaut und als zweite, unabhängige Referenz für den E-Rechnung Prüfer benutzt werden kann.
Die erste Referenz ist das **Original**: Release-JAR 1.6.3 mit dem Release-ZIP der Konfiguration
(Abschnitt 5.2, Testreihe `kosit-official`). Alle Aussagen über den Validator stammen aus dessen Quelltext; jede Fundstelle wird als
`Datei:Zeile` relativ zu `src/main/java/de/kosit/validationtool/` des Klons angegeben.

| Quelle | Stand |
|---|---|
| `itplr-kosit/validator` (Klon `ext/validator`) | Tag **v1.6.3**, Commit `37cddce28e15ac3a0319db006ab21d3f1064ca8c` („[maven-release-plugin] prepare release v1.6.3“, 2026-08-20, Branch `release/1.6.x`) = Quellstand des Release-JAR 1.6.3 (Abschnitt 5.2); `CHANGELOG.md`: Release **1.6.3** vom 2026-08-20; `pom.xml:9` = `1.6.3`. Die Konfiguration v2026-08-31 verwendet „KoSIT Validator v1.6.3“ (ihr `CHANGELOG.md`). Bis 2026-10-20 war der danach gemergte `main`-Stand `6ac5167f` gepinnt; er unterscheidet sich vom Tag nur in `CHANGELOG.md`, `pom.xml:9` (`1.6.4-SNAPSHOT`) und `.github/dependabot.yml` (`git diff --stat v1.6.3 6ac5167f`), `src/` ist identisch – alle Fundstellen unten gelten unverändert. |
| `itplr-kosit/validator-configuration-xrechnung` (Klon `ext/validator-configuration-xrechnung`) | Tag **v2026-08-31**, Commit `b436fc4bf05ad501ab5cbb4a53fdffee3d4e18be` |
| Saxon HE | Validator-`pom.xml:51`: `version.saxon-he` = 12.9; hier verwendet: Saxon HE **12.8** (`SaxonHE12-8J.zip` aus `github.com/Saxonica/Saxon-HE`, SHA-256 geprüft, `tools/fetch-sources.cjs`) |
| JDK | 21 (`javax.xml.validation` = eingebautes Xerces, wie beim Validator: `impl/xml/BaseResolvingStrategy.java:35-41` erzwingt `com.sun.org.apache.xerces.internal`) |

Die Re-Implementierung liegt in `test/kosit-reference/` (`KositReference.java`, `CheckReports.java`,
`run.sh`, `build-xrechnung-xsl.sh`); der Vergleich mit dem Prüfer in `test/compare-kosit.cjs`;
die Ergebnisse in `build/reports/kosit-reference.txt` (Nachbau) und `build/reports/kosit-official.txt` (Original).

---

## 1. Prüfablauf eines Dokuments (`impl/DefaultCheck.java`)

`DefaultCheck` führt für jedes Eingabeobjekt acht Schritte (`CheckAction`) in fester Reihenfolge
aus (`impl/DefaultCheck.java:89-96`):

1. `DocumentParseAction` – Parsen / Wohlgeformtheit
2. `CreateDocumentIdentificationAction` – Hash und Referenz
3. `ScenarioSelectionAction` – Szenario über `<match>`
4. `SchemaValidationAction` – XSD-Validierung
5. `SchematronValidationAction` – Schematron-XSLTs
6. `ValidateReportInputAction` – Prüfung des Zwischenformats gegen `createReportInput.xsd`
7. `CreateReportAction` – Report-XSLT des Szenarios
8. `ComputeAcceptanceAction` – Annahmeempfehlung

Ein Schritt kann sich über `isSkipped(Bag)` selbst überspringen (`impl/tasks/CheckAction.java:216`).
Alle Schritte teilen sich den `Bag` (`impl/tasks/CheckAction.java:44-199`): Eingabe, Parser-Ergebnis,
Szenario, XSD-Ergebnis, das Zwischenformat `CreateReportInput`, der Report, `stopped`/`finished`,
`acceptStatus` (Startwert `UNDEFINED`). `stopProcessing(...)` setzt `stopped = true` und hängt die
Meldung an `createReportInput/processingError/error` an (`CheckAction.java:86-96`); **die restlichen
Schritte laufen trotzdem weiter** (die Schleife in `DefaultCheck.java:122-129` prüft nur `isSkipped`).
Nach der Schleife wird `finished = true` gesetzt (`DefaultCheck.java:130`).

Das Zwischenformat wird vor dem ersten Schritt angelegt (`DefaultCheck.java:99-107`):
`engine/name` = `engine_name + " " + project_version` aus `app-info.properties` („KoSIT Validator
1.6.3“), `timestamp` = `DateFactory.createTimestamp()` (= `XMLGregorianCalendar` einer
`GregorianCalendar` des aktuellen Zeitpunkts, also `xs:dateTime` mit Millisekunden und Zeitzone,
`impl/DateFactory.java:34-38`), Attribut `frameworkVersion` = `framework_version` = **1.0.2**
(`src/main/resources/app-info.properties`).

### 1.1 Eingabe (`api/InputFactory.java`, `impl/input/ResourceInput.java`)

Die Kommandozeile liest Dateien mit `InputFactory.read(Path)` → `read(url, "SHA-256")` →
`new ResourceInput(url, url.getFile(), digestAlgorithm)` (`api/InputFactory.java:72-74, 128-139`).
Daraus folgt:

* **Name** des Eingabeobjekts = `URL.getFile()` der Datei-URL, also der absolute Pfad
  (bei Sonderzeichen URL-kodiert), nicht der Dateiname; er wird als `documentReference` in den
  Report geschrieben und ist Basis der Reportdatei-Namen.
* **Hash** = SHA-256 der Rohbytes, beim Lesen des Streams mitberechnet
  (`impl/input/StreamHelper.java`, `DigestingInputStream`).
* `getSource()` liefert eine `StreamSource(stream, name)`; die System-ID ist der Pfad (ohne
  `file:`), Saxon macht daraus die Basis-URI `file:///…` (geprüft mit Saxon 12.8).
* Verzeichnisse auf der Kommandozeile werden **nicht rekursiv** gelesen, nur Dateien mit Endung
  `.xml` (Groß/Kleinschreibung egal) (`cmd/Validator.java:305-312`).

### 1.2 Parsen (`impl/tasks/DocumentParseAction.java`)

Der Saxon-`Processor` wird einmal in `impl/xml/ProcessorProvider.java:92-115` konfiguriert:
`DTD_VALIDATION=false`, `ENTITY_RESOLVER_CLASS=""`, `XINCLUDE=false`,
`ALLOW_EXTERNAL_FUNCTIONS=false` (Zeilen 101-104); Parser-Features
`secure-processing=true`, `disallow-doctype-decl=true`, `load-external-dtd=false`,
`accessExternalDTD=false` (Zeilen 107-113); `CollectionFinder`, `OutputURIResolver` und
`UnparsedTextURIResolver` werfen immer (`SecureUriResolver`, Zeilen 43-71). Folge: ein Dokument
mit `<!DOCTYPE …>` ist für den Validator **nicht parsebar** (SXXP0003 „DOCTYPE is disallowed …“),
`collection()`, `unparsed-text()` und `xsl:result-document` sind in allen XSLTs gesperrt.

`parseDocument` baut mit `processor.newDocumentBuilder()` und `setLineNumbering(true)`
(`DocumentParseAction.java:65-67`). Jede `SaxonApiException`/`IOException` wird zu **einem**
`XMLSyntaxError` mit `severityCode = SEVERITY_FATAL_ERROR`, `message = "IOException while reading
resource " + name + ": " + e.getMessage()` und **ohne** `rowNumber`/`columnNumber`
(`DocumentParseAction.java:73-76`). `check()` legt immer `validationResultsWellformedness` an
(leer bei Erfolg) und ruft bei Fehler `stopProcessing(meldungen)` (`DocumentParseAction.java:86-95`)
– der Parserfehler erscheint damit zweimal im Zwischenformat: als `xmlSyntaxError` und als
`processingError/error`.

### 1.3 Dokumentidentifikation (`impl/tasks/CreateDocumentIdentificationAction.java:29-37`)

`documentIdentification/documentHash/hashAlgorithm` = `SHA-256`, `hashValue` = Hash (Base64 durch
JAXB `xs:base64Binary`), `documentReference` = Name (siehe 1.1).

### 1.4 Szenarioauswahl (`impl/tasks/ScenarioSelectionAction.java`, `impl/ScenarioRepository.java`)

* Ist das Dokument nicht parsebar, wird direkt das Fallback-Szenario gewählt
  (`ScenarioSelectionAction.java:43-47`).
* Sonst wird **jedes** Szenario geprüft: der XPath aus `<match>` wird mit den Namensräumen des
  Szenarios (`<namespace prefix=…>`, Werte getrimmt) kompiliert (`impl/ContentRepository.java:242-246,
  201-212`) und mit dem Dokumentknoten als Kontext über `effectiveBooleanValue()` ausgewertet
  (`ScenarioRepository.java:91-100`; ein XPath-Laufzeitfehler zählt als „passt nicht“).
* **Genau ein** Treffer → dieses Szenario. Kein Treffer („None of the loaded scenarios matches …“)
  oder **mehr als ein** Treffer („More than one scenario matches …“) → Fallback-Szenario
  (`ScenarioRepository.java:78-89`). Die Reihenfolge in `scenarios.xml` spielt also keine Rolle
  (kein „first match“).
* Nur bei einem echten Szenario wird dessen komplette Definition als `s:scenario` in das
  Zwischenformat kopiert (`ScenarioSelectionAction.java:49-54`); beim Fallback fehlt `s:scenario`.
* Fallback-Szenario (`config/FallbackBuilder.java:41-66`): Name `Fallback-Scenario`, `match` und
  `acceptMatch` = `count(/)<0`, kein Schema, keine Schematron-Schritte, Report-XSLT =
  `<noScenarioReport>/<resource>` aus `scenarios.xml` (`default-report.xsl`), `fallback = true`.
  Für den `acceptMatch` wird **kein** XPath-Executable erzeugt (`FallbackBuilder.build` ruft
  `setAcceptExecutable` nicht auf).

### 1.5 XSD-Validierung (`impl/tasks/SchemaValidationAction.java`)

Übersprungen, wenn das Szenario kein Schema hat (`SchemaValidationAction.java:191-198`), also beim
Fallback. Sonst:

* Das `Schema` entsteht beim Laden der Konfiguration (`impl/ContentRepository.java:169-177, 160-162,
  103-110`): `SchemaFactory.newInstance(W3C_XML_SCHEMA_NS_URI)` mit `accessExternalDTD=""`,
  `accessExternalSchema="file"`, `FEATURE_SECURE_PROCESSING=true`
  (`impl/xml/StrictRelativeResolvingStrategy.java:34-42`, Standard-Modus `STRICT_RELATIVE`,
  `config/ConfigurationLoader.java:79`), `setResourceResolver(null)`, dann
  `newSchema(Source[])` mit **allen** `<validateWithXmlSchema>/<resource>`-Dateien zusammen; jede
  Quelle ist eine `StreamSource(stream, aufgelöste-URI)`, Importe werden relativ dazu aufgelöst.
* Der `Validator` (`StrictRelativeResolvingStrategy.java:55-65`): `schema.newValidator()`,
  `accessExternalDTD=""`, `accessExternalSchema="file"`, `secure-processing=true`.
* Das Dokument wird **erneut von der Quelle gelesen** (`ResourceInput.supportsMultipleReads()` =
  true, `SchemaValidationAction.java:168-176`), nicht aus dem Saxon-Baum serialisiert.
* Fehlersammlung: `impl/CollectingErrorEventHandler.java` sammelt **alle** SAX-Ereignisse
  (`warning`/`error`/`fatalError`, Zeilen 115-127) mit `message`, `rowNumber`, `columnNumber`
  (`-1`, wenn unbekannt) und wirft nicht – Xerces validiert also nach einem `error` weiter;
  eine Obergrenze gibt es nur für JAXB-Ereignisse (`stopProcessCount = 50`, Zeile 45-47, 88-94),
  nicht für die XSD-Prüfung.
* Ergebnis: `Result<Boolean, XMLSyntaxError>(!errorHandler.hasErrors(), errorHandler.getErrors())`
  (`SchemaValidationAction.java:145`). `hasErrors()` ignoriert Warnungen (`CollectingErrorEventHandler.java:101-103`),
  aber `Result.isValid()` verlangt `errors.isEmpty()` (`impl/model/Result.java:57-58`). **Eine
  reine Warnung des Schema-Validators macht das Ergebnis daher „invalid“** (Schematron wird
  übersprungen, Report `val-xsd valid="false"`), obwohl `object == TRUE`.
* Ausnahme (`SAXException`/`IOException`, z. B. Wohlgeformtheitsfehler beim zweiten Lesen):
  `addProcessingError("Error processing schema validation for scenario " + name)` und
  `Result(FALSE)` **ohne** Fehlerliste (`SchemaValidationAction.java:146-151`) – dieses Ergebnis
  ist nach `Result.isValid()` **valid** (Objekt gesetzt, Liste leer): Schematron läuft, das
  Zwischenformat enthält keine `xmlSyntaxError`, aber einen `processingError`.
* Ins Zwischenformat kommen `validationResultsXmlSchema/s:resource` (alle Schema-Ressourcen des
  Szenarios) und, nur wenn `!isValid()`, alle gesammelten Ereignisse als `xmlSyntaxError`
  (`SchemaValidationAction.java:160-165`).

### 1.6 Schematron (`impl/tasks/SchematronValidationAction.java`)

Übersprungen, wenn das Szenario keine `<validateWithSchematron>` hat, kein XSD-Ergebnis vorliegt
(`schemaValidationResult == null`, also auch beim Fallback) oder das XSD-Ergebnis `isInvalid()`
ist (`SchematronValidationAction.java:102-113`). Das ist die Regel **„schema-ungültig → kein
Schematron“**.

Für jede Ressource in Konfigurationsreihenfolge (`SchematronValidationAction.java:51-86`):

* `XsltExecutable.load()` des beim Konfigurationsladen kompilierten XSLT
  (`ContentRepository.loadXsltScript`, `impl/ContentRepository.java:118-138`: `XsltCompiler` mit dem
  Repository-`URIResolver`, Quelle = im Repository aufgelöste Ressource).
* `setURIResolver(RelativeUriResolver)` (nur Repository-relative Auflösung,
  `impl/xml/RelativeUriResolver.java:46-57`), `setMessageListener` (die Meldungen aus
  `xsl:message` werden **nicht** gesammelt: `CollectingErrorEventHandler.message()` erzeugt ein
  Objekt, fügt es aber nirgends an, Zeilen 130-138), `XdmDestination`,
  `setInitialContextNode(dokument)`; **keine Stylesheet-Parameter**.
* Das SVRL wird als DOM an JAXB übergeben und als `SchematronOutput` (Klassen aus
  `src/main/model/xsd/svrl-kosit.xsd`) eingelesen (`SchematronValidationAction.java:73-77`).
  Dadurch bleibt nur die in `svrl-kosit.xsd` modellierte Teilmenge erhalten:
  `schematron-output` (`phase`, `schemaVersion`, `title`), `text`, `ns-prefix-in-attribute-values`,
  `active-pattern` (`documents`, `id`, `name`, `role` – das vom ISO-Skeleton erzeugte Attribut
  `document` wird verworfen), `fired-rule` (`context`, `flag`, `id`, `name`, `role`),
  `failed-assert`/`successful-report` (`flag`, `id`, `location`, `role`, `test`;
  Kinder `diagnostic-reference`, `property-reference`, `text`), `text` (gemischter Inhalt mit
  fremden Elementen, `xml:lang`, `xml:space`, `fpi`, `icon`, `see`, beliebige fremde Attribute).
  Kommentare und Verarbeitungsanweisungen gehen verloren.
* `SaxonApiException` (Laufzeitfehler des XSLT): `addProcessingError("Error processing schematron
  validation " + resourceName + ". Error is " + msg)` und ein **leeres** `svrl:schematron-output`
  (`SchematronValidationAction.java:78-92`).

### 1.7 Zwischenformat `createReportInput` (`src/main/model/xsd/createReportInput.xsd`, identisch mit `xsd/createReportInput.xsd` der Konfiguration)

Elementfolge (XSD-`sequence`, JAXB marshallt in dieser Reihenfolge), Namensraum
`http://www.xoev.de/de/validator/framework/1/createreportinput`:

```
in:createReportInput @frameworkVersion="1.0.2"
  in:engine/in:name
  in:timestamp
  in:documentIdentification/in:documentHash/(in:hashAlgorithm, in:hashValue), in:documentReference
  s:scenario                      (nur bei echtem Szenario; vollständige Definition aus scenarios.xml)
  in:validationResultsWellformedness/in:xmlSyntaxError*
  in:validationResultsXmlSchema   (nur wenn Schritt 4 lief) /s:resource+, in:xmlSyntaxError*
  in:validationResultsSchematron* (einer je Ressource) /s:resource, in:results/svrl:schematron-output
  in:processingError/in:error+    (nur wenn stopProcessing aufgerufen wurde)
in:xmlSyntaxError = in:message, in:severityCode (SEVERITY_WARNING|SEVERITY_ERROR|SEVERITY_FATAL_ERROR), in:rowNumber?, in:columnNumber?
```

JAXB-Besonderheiten (`src/main/model/binding/global.xjb`): alle `xs:string`-Werte laufen durch
`StringTrimAdapter` (`impl/xml/StringTrimAdapter.java`: `trim()` beim Lesen und Schreiben), z. B.
`processingError/error`; `rowNumber`/`columnNumber` sind `Integer` und fehlen, wenn nicht gesetzt
(Parserfehler), stehen aber als `-1`, wenn Xerces keine Position kennt.

### 1.8 Prüfung des Zwischenformats (`impl/tasks/ValidateReportInputAction.java:43-60`)

Das Objekt wird mit JAXB gegen `createReportInput.xsd` (+ `scenarios.xsd`, `svrl-kosit.xsd`,
`xml.xsd`, `impl/SchemaProvider.java:45-49`) marshallt. Jeder Fehler führt zu
`stopProcessing("Report input has errors " + fehlerliste)`; der Report wird trotzdem erzeugt.

### 1.9 Report-Erzeugung (`impl/tasks/CreateReportAction.java:77-114`)

* Eingabedokument der Transformation: das JAXB-marshallte Zwischenformat als Saxon-Baum.
* XSLT: `<createReport>/<resource>` des Szenarios (XRechnung: `resources/xrechnung-report.xsl`, das
  `default-report.xsl` importiert), beim Fallback `<noScenarioReport>/<resource>`
  (`resources/default-report.xsl`); fehlt `<createReport>`, wird `transform/identity.xsl` benutzt
  (`config/ConfigurationLoader.java:127-132`).
* `setInitialContextNode(zwischenformat)`, `setURIResolver(RelativeUriResolver)`,
  `UnparsedTextURIResolver` des Repositories, **ein** Stylesheet-Parameter: `input-document`
  (ohne Namensraum) = das geparste Dokument; bei nicht parsebarer Eingabe ein Ersatzdokument
  `<error-message xmlns="…/createreportinput">alle Parsermeldungen aneinandergehängt</error-message>`
  (`CreateReportAction.java:81-82, 97-99, 110-114`).
* Ergebnis in `XdmDestination` → `bag.report`. Ausnahme → `stopProcessing("Can not create final
  report: " + msg)`, kein Report.

### 1.10 Annahmeempfehlung (`impl/tasks/ComputeAcceptanceAction.java:39-86`)

```
wenn stopped && Parser-Ergebnis valid        → UNDEFINED (Verarbeitungsfehler nach erfolgreichem Parsen)
wenn report == null || schemaValidationResult == null || scenario == null → REJECT   (z. B. Fallback)
wenn schemaValidationResult.isValid() && acceptMatch vorhanden
     → acceptMatch-XPath gegen den Report (Dokumentknoten): effectiveBooleanValue → ACCEPTABLE/REJECT
       (XPath-Fehler → stopProcessing, Status bleibt UNDEFINED)
sonst → ACCEPTABLE, wenn schemaValidationResult.isValid() und kein svrl:failed-assert in allen SVRL
       (successful-report zählt nicht; Rollen/Flags werden hier ignoriert), sonst REJECT
```

XRechnung-Szenarien haben alle `acceptMatch = /rep:report/rep:assessment[1]/rep:accept[1]`;
die Empfehlung ist dort also das Ergebnis der Report-XSLT (Abschnitt 1.11).

`DefaultResult` (`impl/DefaultResult.java`): `isProcessingSuccessful = !stopped && finished`,
`isAcceptable = isProcessingSuccessful && ACCEPTABLE` (Zeile 99-101), `isSchemaValid =
schemaViolations != null && leer` (104-106), `isSchematronValid = jedes SVRL enthält mindestens ein
active-pattern/fired-rule/failed-assert und kein failed-assert` (152-160);
`getCustomFailedAsserts()` = failed-asserts, deren `@id` in einem `customLevel` des Szenarios steht
(`DefaultCheck.java:149-163`).

### 1.11 Report-XSLT (`src/default-report.xsl`, `src/xrechnung-report.xsl` der Konfiguration)

* `rep:report/@valid` (Zeilen 52-69): `false` bei Verarbeitungsfehler, ohne `s:scenario`, bei
  Szenarioname mit „fallback“ oder einem Schritt `@valid='false'`; sonst `true`, wenn ein Schritt
  `@valid='true'` hat.
* Schritte (`rep:validationStepResult`): `val-xsd` (nur wenn `in:validationResultsXmlSchema`
  existiert), `val-sch.N` (N = Position der `in:validationResultsSchematron`), `val-xml`
  (immer; Zeilen 40-45 in der Reihenfolge xsd, sch, xml). Ein Schritt ist `valid="false"`, sobald
  er eine Meldung mit `@level` `warning` oder `error` enthält (Zeilen 138, 153, 234).
* `in:xmlSyntaxError` → `rep:message` (Zeilen 160-200): `@level` = `warning`, wenn
  `@severity = 'SEVERITY_WARNING'` – dieses **Attribut existiert im Zwischenformat nicht** (dort
  steht das Kindelement `in:severityCode`), daher ist **jede** XSD-/Parsermeldung `error`;
  `@code` = erster Token vor `": "`, wenn die Meldung mit `cvc-` beginnt (Xerces-Schlüssel wie
  `cvc-complex-type.2.4.a`), sonst `generic-error`; `lineNumber`/`columnNumber` nur, wenn
  `rowNumber`/`columnNumber` vorhanden und ≠ `-1`. Im Schritt `val-xml` werden Meldungen, die mit
  `SAXParseException` beginnen, unterdrückt (Zeile 132); die Meldungen von
  `DocumentParseAction` beginnen mit `IOException while reading resource` und bleiben erhalten.
* `svrl:failed-assert | svrl:successful-report` → `rep:message` (Zeilen 243-283):
  `@level` aus `(@flag, @role)`: `fatal`/`error` → `error`; `warning`/`warn` → `warning`;
  `information`/`info` → `information`; sonst `error`. `@xpathLocation` = `@location` unverändert,
  `@code` = `@id` (bei fehlender `@id`: `UNSPECIFIC`), Text = `svrl:text`.
  **`@level` ist der Original-Level; `customLevel` wird nur in `rep:custom-level()` (Zeilen
  361-379) für die Bewertung und in der HTML-Tabelle („Adj. Grad“) angewendet.**
* Fehlendes `svrl:schematron-output` → Schritt `valid="false"` mit Meldung `PROCESSING_ERROR`
  („The Schematron validation did not produce an SVRL result …“), aber nur, wenn kein
  `in:processingError` existiert (Zeilen 214-225).
* `rep:assessment` (Zeilen 312-336): `reject` bei Verarbeitungsfehler, ohne `s:scenario`, bei
  Fallback-Namen oder einer Meldung mit `rep:custom-level(.) = 'error'`; sonst `accept`
  (auch bei Warnungen/Informationen). `rep:custom-level`: steht `@code` in einem
  `//s:customLevel` (whitespace-getrennte Liste), gilt dessen `@level`, sonst `@level` der
  Meldung; `PROCESSING_ERROR` behält `error`.
* HTML-Erklärung (`html:html` mit `data-report-type="report"`): Metadaten, Verarbeitungsfehler-
  Banner, Konformitätsaussage, Tabelle der Meldungen, Bewertungssatz („Es wird empfohlen das
  Dokument anzunehmen …“ / „… zurückzuweisen.“ / bei Verarbeitungsfehler „Das Dokument sollte nicht
  automatisiert angenommen werden.“, Zeilen 794-823), bei parsebarem Dokument eine Tabelle des
  Rechnungsinhalts (`$input-document instance of document-node(element())`, Zeile 555).
* `xrechnung-report.xsl` ergänzt `rep:documentData` (`seller`, `id`, `issueDate` aus UBL/CII) und
  die zugehörige HTML-Liste.

### 1.12 Alle Quellen von `processingError`

| Meldung | Quelle |
|---|---|
| `IOException while reading resource <name>: <msg>` | nicht parsebar (`DocumentParseAction.java:75, 93`) |
| `Error processing schema validation for scenario <name>` | Ausnahme in der XSD-Prüfung (`SchemaValidationAction.java:147-149`) |
| `Error processing schematron validation <resource>. Error is <msg>` | XSLT-Laufzeitfehler (`SchematronValidationAction.java:79-82`) |
| `Report input has errors [...]` | Zwischenformat nicht schemakonform (`ValidateReportInputAction.java:47`) |
| `Can not create final report: <msg>` | Report-XSLT (`CreateReportAction.java:106`) |
| `Error evaluating accept recommendation: <xpath>` | `acceptMatch` nicht auswertbar (`ComputeAcceptanceAction.java:78-80`) |

---

## 2. Kommandozeile des Standalone-JAR (`cmd/CommandLineOptions.java`, `cmd/Validator.java`)

Aufruf: `java -jar validator-1.6.3-standalone.jar -s <scenarios.xml> [-r <repository>] [OPTIONEN] DATEI|VERZEICHNIS …`
(picocli 4.7.7, `separator = " "` – Option und Wert durch Leerzeichen getrennt, `CommandLineOptions.java:34-35`).

| Option (exakt aus dem Quelltext) | Bedeutung | Fundstelle |
|---|---|---|
| `-s`, `--scenarios <scenario.xml>` (Pflicht, mehrfach) | Ort der `scenarios.xml`; Form `NAME=pfad` für benannte Konfigurationen | `CommandLineOptions.java:232-234`, `cmd/TypeConverter.java` |
| `-r`, `--repository <repository-path>` (mehrfach) | Verzeichnis mit den Szenario-Ressourcen; fehlt es, gilt das Verzeichnis der `scenarios.xml` | `CommandLineOptions.java:228-230`, `Validator.java:204-215` |
| `-o`, `--output-directory <dir>` (Standard `.`) | Zielverzeichnis der Reports; wird angelegt | `CommandLineOptions.java:94-96`, `Validator.java:255-267` |
| `-h`, `--html`, `--extract-html` | jedes `//html:html` des Reports als eigene Datei `<name>-<data-report-type>.html` | `CommandLineOptions.java:98-100`, `cmd/ExtractHtmlContentAction.java:57-66` |
| `--serialize-report-input` | Zwischenformat als `<name>-reportInput.xml` (JAXB, eingerückt, ohne XML-Deklaration) | `CommandLineOptions.java:102-103`, `cmd/SerializeReportInputAction.java:43-46` |
| `-c`, `--check-assertions <assertions-file>` | XPath-Zusicherungen gegen die Reports (`assertions.xsd`) | `CommandLineOptions.java:105-107`, `cmd/CheckAssertionAction.java` |
| `--report-prefix <p>` / `--report-postfix <p>` | Namensbestandteile der Reportdatei | `CommandLineOptions.java:109-113`, `cmd/DefaultNamingStrategy.java:37-52` |
| `-p`, `--print` | Report auf stdout | `CommandLineOptions.java:118-119` |
| `-m`, `--memory-stats` | Speicherstatistik | `CommandLineOptions.java:115-116` |
| `-d`, `--debug` | mehr Debug-Ausgabe bei Fehlern | `CommandLineOptions.java:216-217` |
| `-X`, `--debug-logging` | Log-Level DEBUG | `CommandLineOptions.java:222-223` |
| `-l`, `--log-level <INFO|WARN|DEBUG|TRACE|ERROR|OFF>` (Standard OFF) | Log-Level (slf4j-simple) | `CommandLineOptions.java:225-226`, `cmd/CommandLineApplication.java:106-108` |
| `-?`, `--help` | Hilfe | `CommandLineOptions.java:219-220` |
| `-D`, `--daemon` (+ `-H/--host`, `-P/--port`, `-T/--threads`, `-G/--disable-gui`) | Daemon-Modus (HTTP) | `CommandLineOptions.java:45-63` |
| Argumente `FILE…` (1..n) | Dateien oder Verzeichnisse (nicht rekursiv, nur `*.xml`); zusätzlich stdin, wenn Daten anliegen | `CommandLineOptions.java:121-122`, `Validator.java:269-312` |

**Reportdatei** (`cmd/DefaultNamingStrategy.java`): Basisname = Dateiname ohne Pfad und ohne
Endung (`Bag.getName()`, `CheckAction.java:107-110`); ohne Prefix/Postfix `<name>-report.xml`, mit
Prefix `<prefix>-<name>.xml`, mit Postfix `<name>-<postfix>.xml`, mit beiden
`<prefix>-<name>-<postfix>.xml`. Serialisiert wird mit dem Saxon-Standard-Serializer
(`processor.newSerializer(file)`, `cmd/SerializeReportAction.java:48-49`): XML-Deklaration, **keine
Einrückung** (das `indent="yes"` der Report-XSLT wirkt nicht, weil das Ergebnis zuerst in ein
`XdmDestination` geht).

**Konsolenausgabe** (`cmd/InternalCheck.java:63-105, 124-130`): Tabelle `File | Schema |
Schematron | Acceptance | Error/Description`, Statuszeile `Acceptable: n Rejected: m [Processing
errors: k]`, bei Zusicherungen `Assertions run: x, Assertions failed: y`, danach
„Validation successful!“ / „Validation failed!“ (`cmd/CommandLineApplication.java:64-70`).

**Exit-Codes** (`cmd/ReturnValue.java:26-34`, `cmd/Validator.java:168`, `cmd/InternalCheck.java:150-159`):
`0` = alle Dokumente annehmbar (bzw. alle Zusicherungen erfüllt, wenn `-c` benutzt wird) oder
Hilfe; `n > 0` = Anzahl nicht annehmbarer Dokumente + fehlgeschlagener Zusicherungen; `-1` =
Kommandozeile fehlerhaft; `-2` = Konfigurationsfehler (Laden der Szenarien, kein Prüfobjekt);
`-100` intern für den Daemon.

**Zusicherungen** (`cmd/CheckAssertionAction.java:53-85`): zu einem Report werden die Einträge
des ersten `report-doc` verwendet, für das `key.startsWith(name) || (name + ".xml").endsWith(key)`
gilt – die Iteration läuft über eine `HashMap`, die Reihenfolge ist also undefiniert (relevant
bei `cii-bt-20-cardinality-check` vs. `cii-bt-20-cardinality-check-2`). Jeder Test wird mit den
Namensräumen der Datei kompiliert und gegen den Reportknoten ausgewertet.

---

## 3. Die XRechnung-Konfiguration (v2026-08-31)

### 3.1 Build-Eigenschaften (`build.xml`)

| Eigenschaft | Wert | Zeile |
|---|---|---|
| `xrechnung.version` | `3.0.2` | 41-44 |
| `xrechnung.spec.id` | `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` | 46-47 |
| `xrechnung.extension.id` | `…xrechnung_3.0#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0` | 48-49 |
| `xrechnung.cvd.id` | `…xrechnung_3.0#compliant#urn:xeinkauf.de:kosit:xrechnung:cvd_0.9` | 50-52 |
| `validator.configuration.version.full` | `2026-08-31` | 53 |
| `dist.name` | `xrechnung-3.0.2-validator-configuration-2026-08-31.zip` | 54-55 |
| `cen.rules.version` | `1.3.16` (`en16931-ubl-1.3.16.zip`, `en16931-cii-1.3.16.zip` von GitHub) | 73-78 |
| `xr.schematron.version.full` | `2.6.0` (`xrechnung-3.0.2-schematron-2.6.0.zip`, projekte.kosit.org) | 83-89 |
| `ubl.download.url` | `https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip`, davon `xsdrt/**/*.xsd` → `resources/ubl/2.1/xsd/` | 66-70, 452-457 |
| CII | `D16B_SCRDM__Subset__CII-D16B.zip` → `d16b-cii-uncoupled.zip`, `**/CrossIndustryInvoice*.xsd` flach → `resources/cii/16b/xsd/` | 61-65, 375-383, 459-464 |
| Validator | `validator-1.6.3-standalone.jar` von `https://repo1.maven.org/maven2/org/kosit/validator/1.6.3/` | `_vendor/xsbi-0.5.0-SNAPSHOT/abu/abu-validator-provider.xml:9-20` |
| Saxon | `saxon-he-12.8.jar` (GitHub-Release SaxonHE12-8J) + `xmlresolver-6.0.19` | `abu-saxon-provider.xml:3-20` |
| SchXslt | **1.10.1** (`schxslt-1.10.1-xslt-only.zip`, codeberg.org) | `abu-schematron-schxslt.xml:8-10` |

Release-Artefakt (`docs/usage.md`, `README.md` „Versioning“): GitHub-Release-Tag `v2026-08-31`,
Datei `xrechnung-3.0.2-validator-configuration-2026-08-31.zip`
(`https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/…`);
Inhalt = `build/` ohne `download/**,test/**,schematron/**,reports/**,build.env` (`build.xml:749-759`),
also `scenarios.xml`, `resources/**`, `README.md`, `CHANGELOG.md`, `docs/usage.md`.

Maven-Koordinaten des Validators (`README.md` „Installation“, `pom.xml:7-9, 286`):
`org.kosit:validator:1.6.3`, Standalone-JAR mit Classifier `standalone`
(`validator-1.6.3-standalone.jar`, Hauptklasse `de.kosit.validationtool.cmd.CommandLineApplication`).
Das Ant-Ziel `compile-scenario` (`build.xml:421-441`) ersetzt in `scenarios.xml` die Token
`@build.date@`, `@cen.spec.id@`, `@cen.rules.version@`, `@cen.download.url.ubl@`, `@cen.download.url.cii@`,
`@xrechnung.download.url@`, `@xrechnung.rules.version.full@`, `@xrechnung.rules.version.major.minor@`,
`@xrechnung.version@`, `@xrechnung.spec.id@`, `@xrechnung.extension.id@`, `@xrechnung.cvd.id@`,
`@ubl.version@`, `@ubl.download.url@`, `@cii.version@`, `@cii.download.url@`
(`@xrechnung.cvd.version.major.minor@` steht nicht in der Liste und bleibt im Release wörtlich stehen).

### 3.2 Wie die Konfiguration ihre Regel-XSLTs erzeugt (und was das für den Nachbau heißt)

* CEN-Regeln: `EN16931-UBL-validation.sch` / `EN16931-CII-validation.sch` aus den CEN-Releases
  werden **mit SchXslt 1.10.1** (`pipeline-for-svrl.xsl`) kompiliert
  (`build.xml:387-399`, Makro `schematron-compile-schxslt` in `abu-schematron-schxslt.xml:35-77`).
* XRechnung-Regeln: das Release `xrechnung-3.0.2-schematron-2.6.0.zip` enthält bereits XSLTs; sie
  stammen aus dem Build von `itplr-kosit/xrechnung-schematron` (Tag `v2.6.0`), der die gemergte
  Schematron-Datei (Peppol-Regeln eingefügt, `merge-peppol-rules-with-xr-rules`) **ebenfalls mit
  SchXslt 1.10.1** kompiliert (`xrechnung-schematron/build.xml:43-45, 209-227`). Die Konfiguration
  wendet darauf `src/convert-dynamic-id-to-static.xsl` an (dynamische `<xsl:attribute name="id">`
  in `svrl:failed-assert`/`svrl:successful-report` → statisches `id`-Attribut; `build.xml:346-368`).
* Folge für die SVRL-Ausgabe: SchXslt schreibt `@location` in EQName-Notation
  (`/Q{urn:…}Invoice[1]/Q{urn:…}ID[1]`, Attribute `@Q{…}name`); das ISO-Skeleton, mit dem die
  CEN-eigenen XSLTs (`ubl/xslt/EN16931-UBL-validation.xslt`) und unsere Oracle-XSLTs kompiliert
  sind, schreibt `/*:Invoice[namespace-uri()='urn:…'][1]/…` (Modus `schematron-get-full-path`).
  Regel-IDs, Flags, Texte und die Menge der ausgelösten Asserts sind unabhängig vom Compiler
  (beide setzen ISO Schematron „xslt2“ um); ein Unterschied bestünde nur in der Notation der
  Position. **Hinweis:** eine frühere Fassung von `docs/BUILD-RULES.md` ging davon aus, dass
  das Release mit dem ISO-Skeleton kompiliert sei – das ist nach `build.xml` beider Repositories
  nicht der Fall (SchXslt seit Release 2026-01-31, `CHANGELOG.md` der Konfiguration).

### 3.3 Test-Material der Konfiguration (`src/test/`, Ant-Ziele in `build.xml`)

| Ziel | Was | Erwartung |
|---|---|---|
| `init-test` | `create-test-scenario.xsl` erzeugt `build/test/scenarios.xml`: in allen Szenarien mit `namespace/@prefix='invoice'` wird `customLevel level="warning"` für `BR-09` ergänzt; `compile-test-sources` ersetzt `@xrechnung.spec.id@` in `src/test/**/*.xml` | – |
| `test-instances-processing-valid` (`validate-instances`) | Validator mit Test-`scenarios.xml`, `--html -l INFO --check-assertions src/test/assertions.xml` über `instances/processing-valid` (ubl001–006, ubl008, cii001, ubl-br-dex-09-prepaidpayment) | 229 Zusicherungen (`assertions.xml`, ohne auskommentierte) |
| `test-instances-processing-error` | dito über `instances/processing-error` (`bin001.xml` = BMP-Bild, `ubl007.xml` = nicht wohlgeformt) | 55 Zusicherungen |
| `check-reports` (Makro) | jeder `*-report.xml` schemagültig gegen `resources/xsd/report.xsd` + `scenarios.xsd` (`<schemavalidate fullchecking="yes">`); `src/report.sch` (mit SchXslt kompiliert) → SVRL, `check-svrl.xsl` bricht bei `svrl:failed-assert` ab; leeres SVRL-Verzeichnis = Fehler | keine Fehler |
| `test-processing-error` | `default-report.xsl` direkt auf die Fixtures `processing-error-input.xml`, `processing-error-no-messages-input.xml`, `missing-svrl-input.xml`; 12 Textprüfungen (`build.xml:660-743`) | alle erfüllt |
| `test-integration-only` | Produktions-`scenarios.xml`, `-l DEBUG --check-assertions src/test/assertions-integration-testing.xml --html` über `src/test/integration/*` + acht Dateien aus `cen-unit-test` + `XRechnung-CEFACT*.xml` | 41 Zusicherungen |
| `test-check-svrl` | Selbsttest von `check-svrl.xsl` mit `src/test/svrl/{passing,failing}` | passing: Exit 0, failing: Exit ≠ 0 |
| `test-cen-expected-behaviour`, `create-validator-reports-from-testsuite` | XML-Mutate bzw. XRechnung-Testsuite (externe Artefakte, hier über `test/run-xmute-tests.cjs` bzw. den Korpus abgedeckt) | – |

---

## 4. Re-Implementierung `test/kosit-reference/KositReference.java`

Ein einziges Java-Programm (JDK 21 + Saxon HE, keine weiteren Abhängigkeiten) bildet die Schritte
aus Abschnitt 1 nach; Klassen/Methoden sind nach den Validator-Klassen benannt und mit deren
Fundstellen kommentiert. Gleiche Kommandozeilenoptionen wie der Validator (Abschnitt 2) plus
`--threads <n>`, `--engine-name <text>`, `--xsd-dir <dir mit createReportInput.xsd, scenarios.xsd,
svrl-kosit.xsd, xml.xsd>` (Standard: `src/main/model/xsd` des Validator-Klons). Gleiche
Exit-Semantik, gleiche Dateinamen (`<name>-report.xml`, `<name>-report.html`, `<name>-reportInput.xml`).

`run.sh build` baut das Repository im Layout des Releases (`build/kosit-reference/repository/`),
weil `resources/` nicht im Git liegt. **Ressourcen-Abbildung** (Quelle → Ort im Repository):

| Ort (`<location>` in `scenarios.xml`) | Quelle hier | Quelle in CI |
|---|---|---|
| `resources/ubl/2.1/xsd/{maindoc,common}/*.xsd` | `ext/os-UBL-2.1/xsdrt/` (OASIS-Paket `UBL-2.1.zip` aus `ph-ubl/docs`, SHA-256 `60b80d76…`, siehe `docs/XSD-VALIDATION.md`) | dito |
| `resources/cii/16b/xsd/CrossIndustryInvoice*.xsd` (4 Dateien) | `ext/ph-cii/…/d16b/data/standard/` (byte-identisch mit `eInvoicing-EN16931/cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact/data/standard/`, mit `cmp` geprüft) | dito |
| `resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl`, `resources/cii/16b/xsl/EN16931-CII-validation.xsl` | `eInvoicing-EN16931/{ubl,cii}/xslt/EN16931-{UBL,CII}-validation.xslt` (validation-1.3.16, von CEN mit dem ISO-Skeleton kompiliert) | dito |
| `resources/xrechnung/3.0.2/xsl/XRechnung-{UBL,CII}-validation.xsl` | `build-xrechnung-xsl.sh`: Merge (`peppol-into-xr.xsl`, xrechnung-schematron v2.6.0 + peppol-bis-invoice-3 `806866bd`) → ISO-Skeleton (ph-schematron `a8e0cd1a`, `20100710-xslt2`, `allow-foreign=true full-path-notation=4`) → `convert-dynamic-id-to-static.xsl` der Konfiguration. Die Ausgabe ist byte-identisch mit den Referenz-XSLTs von `test/build-oracle-xsl.sh` (geprüft mit `cmp`); die gemergten `.sch` haben die SHA-256 aus `build/STANDARDS_MANIFEST.json` (`e143facb…`, `53bb5c06…`) | dito |
| `resources/default-report.xsl`, `resources/xrechnung-report.xsl`, `resources/xsd/report.xsd` | `src/` der Konfiguration | dito |
| `resources/xsd/scenarios.xsd` | Validator-Klon `src/main/model/xsd/scenarios.xsd` (`provide-scenario-xsd` entpackt sie aus dem JAR) | dito |
| `scenarios.xml` | `tools/compile-scenarios.cjs --emit-xml` (dieselben Filter-Token wie `compile-scenario`; `@build.date@` := `2026-08-31`) | dito |

### 4.1 Abweichungen vom Original (bewusst, mit Grund)

| Nr. | Abweichung | Grund / Auswirkung |
|---|---|---|
| A1 | Schematron-XSLTs des Nachbaus sind mit dem **ISO-Skeleton** kompiliert, das Release mit **SchXslt 1.10.1** (Abschnitt 3.2). | Bewusst: der Nachbau soll eine vom Release unabhängige Kompilierung sein. Die Release-Kompilate selbst (SchXslt) prüft die Testreihe `kosit-official` mit dem Original-JAR (Abschnitt 5.2). Auswirkung nur auf die Notation von `@xpathLocation`; `compare-kosit.cjs` normalisiert beide Notationen (Selbsttest `--selftest`). Hinweis zur Verfügbarkeit (Korrektur einer früheren Aussage): SchXslt 1.10.1 ist auf GitHub erhältlich – als Kopie in `TEIC/TEI` unter `P5/Utilities/lib/schxslt-1.10.1/` (MIT; TEI-Commit `a1745378bf2f`, 2025-05-19, „Update schxslt from 1.9.5 to 1.10.1“; die Byte-Gleichheit mit dem Release auf codeberg.org ist nicht geprüft); die Release-Dateien von KoSIT (GitHub) enthalten die mit SchXslt erzeugten XSLTs selbst. |
| A2 | `report.sch` wird ebenfalls mit dem ISO-Skeleton statt SchXslt kompiliert. | wie A1; die Prüflogik ist identisch (reine `sch:assert`-Regeln). |
| A3 | Das Zwischenformat wird als DOM direkt nach `createReportInput.xsd` gebaut, nicht über JAXB; SVRL wird mit einer Whitelist nach `svrl-kosit.xsd` gefiltert (siehe 1.6). | Der Nachbau kommt ohne Abhängigkeiten außer JDK und Saxon aus (jakarta.xml.bind ist nicht im JDK und käme aus Maven Central). Das Original-JAR (5.2) enthält JAXB. Nicht reproduzierbar ohne JAXB: ob `StringTrimAdapter`/JAXB Leerraum in `xs:token`-/`NonEmptyString`-Werten (`s:match`, `s:resource/s:name`) normalisiert; die Präfixe des Zwischenformats (`in`, `s`, `svrl` statt JAXB-`ns2`…). Beides ohne Einfluss auf den Report-Inhalt, weil `default-report.xsl` nur über Namensräume adressiert und `s:*`-Elemente neu erzeugt. Das Zwischenformat wird wie im Original gegen `createReportInput.xsd` validiert (Schritt 6). |
| A4 | `engine/name` = `KoSIT Validator 1.6.3 (KositReference re-implementation)` statt `KoSIT Validator 1.6.3`. | Reports dürfen nicht als Ausgabe des Original-JAR missverstanden werden; mit `--engine-name` überschreibbar. |
| A5 | Konsolentabelle ohne ANSI-Farben und ohne Spaltenumbruch (`cmd/report/Grid.java` nicht nachgebaut). | Kosmetik; Statuszeilen und Exit-Codes sind identisch. |
| A6 | Bei `--check-assertions` gewinnt der exakte Schlüssel `<name>-report.xml`, danach die Dokumentreihenfolge (Original: `HashMap`-Reihenfolge, undefiniert, Abschnitt 2). | Deterministisches Verhalten; im Test-Material betrifft das nur `cii-bt-20-cardinality-check` / `-2`, deren Zusicherungen hier dem jeweils passenden Report zugeordnet werden. |
| A7 | `--threads n`: parallele Verarbeitung (der Validator arbeitet sequenziell). | Keine Auswirkung auf Ergebnisse (alle Saxon-Executables werden pro Dokument neu geladen). |
| A8 | Nur eine `-s`-Konfiguration; Daemon-Modus (`-D` …), `-m`, `-l`, `-d`, `-X` werden akzeptiert, aber nicht umgesetzt; ohne `<createReport>` bricht das Programm ab (Validator: `identity.xsl`). | Für die XRechnung-Konfiguration nicht benötigt. |
| A9 | Saxon HE 12.8 statt 12.9 (`pom.xml:51` des Klons). | Bewusst: 12.8 ist die Version, mit der die Konfiguration ihre XSLTs baut (`abu-saxon-provider.xml` Z. 4-5). Das Original-JAR enthält Saxon HE **12.9** (`net.sf.saxon.Version.getProductVersion()` im JAR = „12.9“); die Testreihe `kosit-official` (5.2) prüft also auch mit 12.9 – ohne Abweichung. (12.9 ist ebenfalls im Repository `Saxonica/Saxon-HE` erhältlich.) |
| A10 | Beim Lesen einer Datei wird der Hash vor dem Parsen über die Bytes gebildet (Original: im Stream während des Parsens). | Gleicher Wert (SHA-256 der Rohbytes). |

### 4.2 Ergebnis der Selbsttests der Konfiguration (`run.sh selftest`; die Zeilen „self-test:“ in `build/reports/kosit-reference.txt`)

```
instances/processing-valid  (Test-scenarios.xml, assertions.xml):  9 Dokumente, Acceptable 2 / Rejected 7,
                                                                     Assertions run: 229, Assertions failed: 0, Exit 0
instances/processing-error  (bin001.xml, ubl007.xml):                Acceptable 0 / Rejected 2 / Processing errors 2,
                                                                     Assertions run: 55, Assertions failed: 0, Exit 0
check-reports:               report.xsd: 9 + 2 Reports, 0 ungültig; report.sch über check-svrl.xsl: „No error reported in any svrl“ (Exit 0);
                             Negativprobe mit src/test/svrl/failing: Exit 2 (check-svrl.xsl erkennt failed-assert)
test-processing-error:       12 Prüfungen, 0 fehlgeschlagen
integration (Produktions-scenarios.xml, assertions-integration-testing.xml): 18 Dokumente, Acceptable 10 / Rejected 8,
                                                                     Assertions run: 41, Assertions failed: 0, Exit 0
Summe: 325 Zusicherungen, 0 fehlgeschlagen (= alle nicht auskommentierten Zusicherungen beider Dateien: 284 + 41).
```

---

## 5. Vergleich mit dem E-Rechnung Prüfer (`test/compare-kosit.cjs`)

Eingaben: ein Verzeichnis mit varl-Reports (Original-JAR oder `KositReference`) und ein
Verzeichnis mit JSON-Reports von `tools/pruefer-cli.cjs` (Paarung über den Basisnamen, rekursiv,
Unterverzeichnis als Zusatzschlüssel). Verglichene Felder je Dokument:

| Feld | Report | Prüfer-JSON |
|---|---|---|
| Szenario | `rep:scenarioMatched/s:scenario/s:name` (null bei `rep:noScenarioMatched`) | `scenario` |
| XSD-Urteil (nur mit Szenario) | `validationStepResult[@id='val-xsd']/@valid` | `xsd.valid` |
| Meldungen (nur schemagültig) | Multimenge `code \| Level nach customLevel \| Position` aus allen `val-sch.*`-Schritten; Level nach customLevel wie `rep:custom-level()` aus `//s:customLevel` des Reports | `findings[]`: `id \| level \| location` |
| Bewertung (nur mit Szenario) | `rep:assessment/rep:accept\|rep:reject`; Verarbeitungsfehler am Satz „nicht automatisiert angenommen werden“ erkannt | `assessment` (`not-processable` ⇔ Verarbeitungsfehler) |

Positionen werden auf `/local[n]/local[n]/@attr` normalisiert (ISO-Skeleton, SchXslt-EQName,
Prüfer-Präfixnotation; `--selftest` prüft sieben Beispiele). Dokumente ohne KoSIT-Szenario werden
vom Validator immer mit dem Fallback-Report zurückgewiesen, vom Prüfer informativ nach dem passenden
Regelwerk (Peppol BIS, Factur-X-Profil, EN 16931) geprüft; für sie werden nur das Feld „Szenario“ und das
Konfigurationsurteil verglichen (Bewertung = „nicht vergleichbar“, kein Unterschied).

Wie der Validator führt der Prüfer – im Browser und in `tools/pruefer-cli.cjs`, beide über
`src/pruefer-core.js` (`analyzeBytes`) – vor den Schematron-Regeln die XSD-Prüfung aus
(`src/xsd-validator.js`, Modell aus `build/xsd/` nach der `<validateWithXmlSchema>`-Ressource des
Szenarios; ohne Szenario nach dem Wurzelelement) und überspringt die Schematron-Regeln bei schemaungültigem
Dokument (`schematronSkipped: "xsd-invalid"`, `assessment: "reject"`); das JSON enthält `xsd: {schema,
resource, source, valid, errorCount, errors[{code, message, location}]}`.

### 5.1 Ergebnis über den Korpus (4 158 Dokumente, Nachbau: `build/reports/kosit-reference.txt`)

Korpus = alle Verzeichnisse von `test/build-corpus.cjs`: KoSIT-Testmaterial mit XML-Mutate-Mutationen
(`xr-*`), CEN-Unit-Tests (`cen-*`), XRechnung-Testsuite und Testmaterial der Konfiguration (`extra-*`),
Peppol BIS (Beispiele, Snippets, Unit-Test-Fragmente: `peppol-*`) und ZUGFeRD/Factur-X-Korpus (XML und
aus PDF extrahierte XML: `zugferd-*`).

```
reports: 4158; JSON: 4158; paired: 4158; JSON without report: 0
  cen-cii:        9 documents,    9 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  cen-ubl:     1131 documents, 1131 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  extra-cii:     73 documents,    1 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  extra-ubl:     68 documents,    7 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  peppol-cii:   351 documents,  351 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  peppol-ubl:   698 documents,  693 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  xr-cii:       581 documents,    0 without KoSIT scenario, 13 schema-invalid, 0 with mismatches
  xr-ubl:      1050 documents,    2 without KoSIT scenario, 74 schema-invalid, 0 with mismatches
  zugferd-cii:  167 documents,   50 without KoSIT scenario,  2 schema-invalid, 0 with mismatches
  zugferd-ubl:   30 documents,   23 without KoSIT scenario,  0 schema-invalid, 0 with mismatches
  scenario:    4158 identical, 0 different (of 4158)
  xsd verdict: 1891 identical, 0 different (of 1891 with matched scenario)
  xsd errors:    89 identical code sequences, 0 different (of 89 schema-invalid documents)
  messages:    1802 identical multisets, 0 different (of 1802 schema-valid documents with Schematron;
               code | level after customLevel | location)
  configuration verdict (accept under a KoSIT scenario, all documents): 4158 identical, 0 different
  assessment:  1891 identical, 0 different (of 1891 with matched scenario); 2267 without scenario
  processing errors: 0 on both sides, 0 on one side only
MISMATCHES: 0 document(s)
```

Dokumente ohne Szenario (2 267): Der KoSIT-Validator weist sie mangels Szenario zurück; der Prüfer
nimmt sie ebenfalls nie als XRechnung/EN 16931 an („configuration verdict“ identisch für alle 4 158)
und prüft sie stattdessen informativ nach dem passenden Regelwerk (`build/rulesets.json`: Peppol BIS,
Factur-X-Profil, EN 16931) bzw. meldet „nicht anwendbar“. Dazu gehören die CEN-Unit-Test-Fragmente
(ohne `CustomizationID`), Peppol-BIS-Dokumente, ZUGFeRD-Profile ohne KoSIT-Szenario (MINIMUM,
BASIC WL, BASIC, EXTENDED, alte Kennungen), Testinstanzen mit nicht ersetztem Platzhalter
`@xrechnung.spec.id@` und Mutationen mit ungültiger `CustomizationID`.

Paarung: Jeder Bericht muss genau einem Prüfer-JSON zugeordnet sein, sonst schlägt der Vergleich
fehl. Der Berichtsname folgt dem Original (aus `X.xml` wird `X-report.xml`, aus `X.pdf.xml`
`X.pdf-report.xml`, aus `X.XML.xml` `X-report.xml`; `cmd/DefaultNamingStrategy.java`).

### 5.2 Original: KoSIT-Validator 1.6.3 mit der Release-Konfiguration (`build/reports/kosit-official.txt`)

`test/kosit-official.cjs`: Release-Dateien von GitHub (SHA-256 vor Verwendung geprüft;
`tools/fetch-sources.cjs`):

| Datei | Herkunft | SHA-256 |
|---|---|---|
| `validator-1.6.3-standalone.jar` | `github.com/itplr-kosit/validator/releases/download/v1.6.3/` | `799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9` |
| `xrechnung-3.0.2-validator-configuration-2026-08-31.zip` | `github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/` | `2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8` |

Aufruf je Verzeichnis wie in der Dokumentation des Validators:
`java -jar validator-1.6.3-standalone.jar -s config/scenarios.xml -r config -o <out> build/corpus/<dir>`.
Das JAR enthält Saxon HE 12.9; die Regel-XSLTs des Release-ZIP sind mit SchXslt 1.10.1 kompiliert.
Ergebnis über dieselben 4 158 Dokumente: **identisch mit 5.1 in allen Feldern, 0 Abweichungen**
(Szenario 4 158/4 158, XSD-Urteil 1 891/1 891, XSD-Fehlercodes 89/89, Meldungen 1 802/1 802,
Konfigurationsurteil 4 158/4 158, Verarbeitungsfehler 0/0).

Dokumenttyp-Deklarationen (seit 0.3.1): Der XML-Parser des Validators läuft mit
`http://apache.org/xml/features/disallow-doctype-decl` (`impl/xml/ProcessorProvider.java`) und lehnt jedes
Dokument mit DOCTYPE ab („SXXP0003 … DOCTYPE is disallowed“, Verarbeitungsfehler, REJECT) – auch eines ohne
Entitäten. `test/kosit-official.cjs` prüft das zusätzlich an 8 Dokumenten im Verzeichnis `doctype`: das erste
XRechnung-UBL- und das erste -CII-Original in je drei Fassungen (mit DOCTYPE, mit interner Entität, mit DOCTYPE nach
einem Kommentar) sowie je ein Dokument mit Entity-Expansion und mit externen Entitäten. KoSIT und Prüfer melden beide
einen Verarbeitungsfehler (8/8), Szenario 4 166/4 166.

Korrektur einer früheren Aussage: In 0.1.0 hieß es, das Original-JAR sei nur über Maven Central
erhältlich und daher nur im CI prüfbar. Die GitHub-Release-Dateien sind erreichbar; der Vergleich
läuft deshalb lokal und im CI. Der CI-Job `kosit-jar-maven` prüft zusätzlich, dass das GitHub-JAR
byte-gleich mit `org.kosit:validator:1.6.3:standalone` auf Maven Central ist.

---

## 6. CI (`.github/workflows/verify.yml`)

* Job `verify`: `tools/fetch-sources.cjs` (gepinnte Quellen, Release-Dateien), Merge-Schritt,
  `tools/verify-all.cjs` mit allen Testreihen – darunter `kosit-official` (5.2) und `kosit-reference`
  (5.1; `run.sh build`, `run.sh selftest` mit den erwarteten Zahlen aus 4.2, `run.sh corpus`) –, dann
  die Freigabe `tools/verify-manifest.cjs --reports --strict`.
* Job `kosit-jar-maven`: GitHub-Release-JAR byte-gleich mit dem JAR auf Maven Central (`.sha1` geprüft).
