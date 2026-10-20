# Artefakte neu erzeugen und prüfen (neue Versionen von CEN / KoSIT / Peppol / Factur-X)

Alle Schritte sind deterministisch. Die gepinnten Stände (Commits, SHA-256) stehen in
`build/STANDARDS_MANIFEST.json`; alle Pfade dort sind logisch (`<Repository>/<Pfad>`), also
unabhängig vom Rechner. Dieselben Skripte laufen lokal und in CI (`.github/workflows/verify.yml`).

## 0. Quellen holen

```sh
node tools/fetch-sources.cjs ext
```

klont jedes Repository des Manifests genau am gepinnten Commit (teilweise als Sparse-Checkout),
packt das OASIS-UBL-2.1-Paket aus (`ph-ubl/docs/UBL-2.1.zip`, SHA-256 geprüft) und lädt die
Release-Artefakte – jedes vor der Verwendung gegen seine SHA-256 geprüft:

| Artefakt | Quelle | SHA-256 |
|---|---|---|
| Saxon HE 12.8 (`SaxonHE12-8J.zip`) | `github.com/Saxonica/Saxon-HE`, Commit `45924081b69c`, `12/Java/` | `2ba851ae…003598` |
| KoSIT-Validator 1.6.3 (`validator-1.6.3-standalone.jar`) | GitHub-Release `itplr-kosit/validator` v1.6.3 | `799e64be…b9a7c9` |
| XRechnung-Konfiguration (`xrechnung-3.0.2-validator-configuration-2026-08-31.zip`) | GitHub-Release `itplr-kosit/validator-configuration-xrechnung` v2026-08-31 | `2530cd10…1221a8` |

`ext/DOWNLOADS.txt` protokolliert URL, SHA-256 und Größe jedes Downloads. Der CI-Job
`kosit-jar-maven` vergleicht das JAR zusätzlich byte-genau mit der Kopie auf Maven Central
(`org.kosit:validator:1.6.3:standalone`, geprüft mit deren `.sha1`).

## 1. KoSIT-Merge-Schritt (XRechnung + Peppol-Whitelist)

```sh
sh tools/merge-xrechnung-sch.sh ext
```

= Ziel `merge-peppol-rules-with-xr-rules` von `xrechnung-schematron/build.xml`: das
Repository-eigene `src/xsl/peppol-into-xr.xsl` (Saxon HE 12.8) fügt die Peppol-Regeln aus
`src/xsl/rule-list.xml` ein. Ergebnis `xrechnung-schematron/build/schematron/{ubl,cii}/…`,
SHA-256 `e143facb…` (UBL) und `53bb5c06…` (CII) – identisch mit dem Manifest.

## 2. Regelwerke, XSD-Modelle, Szenarien

```sh
sh tools/compile-rules.sh ext          # build/schemas/*.json  (tools/compile-sch.cjs; PEPPOL-* nur lokal, nicht ausgeliefert)
sh tools/compile-xsd-models.sh ext     # build/xsd/*.json      (tools/compile-xsd.cjs)
node tools/compile-scenarios.cjs ext/validator-configuration-xrechnung build/scenarios.json
node tools/make-manifest.cjs           # build/STANDARDS_MANIFEST.json (Pfade im Kopf des Skripts = Klone der Entwicklungsumgebung)
```

`node tools/check-reproducible.cjs ext` erzeugt Merge-Ergebnis, alle Regelwerke, XSD-Modelle und
Szenarien in einem leeren Verzeichnis neu und vergleicht byteweise mit dem Repository.

## 3. XPath-Engine (fontoxpath + Patches)

```sh
sh tools/check-engine.sh ext [esbuild]             # Nachweis: vendor/* = Upstream + Patches
sh tools/build-engine.sh <fontoxpath-arbeitskopie> ext [esbuild]   # nach Änderung: Patch neu erzeugen + vendor/ neu bauen
```

`check-engine.sh` klont fontoxpath (Commit `7506ae0cd03d`, Version 3.34.0) und die Abhängigkeiten
xspattern, whynot, prsc, slimdom an ihren Manifest-Commits in ein leeres Verzeichnis, wendet
`patches/fontoxpath-pruefer.patch` und `patches/xspattern-pruefer.patch` an, erzeugt die
Unicode-Tabellen von xspattern aus der **Unicode Character Database 15.0.0** (`UnicodeData.txt`,
`Blocks.txt`; von unicode.org, sonst aus `github.com/unicode-org/unicodetools`, `data/ucd/15.0.0`)
und prüft deren SHA-256, bündelt mit esbuild 0.28.2 (fontoxpath `--target=es2020`, slimdom
`--target=es2019`) und vergleicht die vier Bundles in `vendor/` byteweise.

## 4. Browser für die Browser-Testreihen

```sh
npx playwright install --with-deps chromium webkit firefox   # Playwright 1.56.0
```

lädt die Browser-Builds vom offiziellen Playwright-CDN (Chromium 141.0.7390.37 / Revision 1194, WebKit 26.0 /
2215, Firefox 142.0.1 / 1495; `playwright-core/browsers.json`) – lokal und in CI (`verify.yml`) gleich. Das
Repository enthält und verbreitet keine Browser-Builds. Ist ein Browser nicht installiert, markiert
`verify-all` seine Testreihen als „nicht gelaufen“, und die Freigabe mit `--strict` schlägt fehl.

## 5. Referenzen und Prüfung

```sh
node tools/verify-all.cjs --ext ext            # alles: Referenzen neu erzeugen, Reproduzierbarkeit, alle Testreihen
node tools/verify-manifest.cjs ext --reports --strict   # Freigabe: jede Testreihe gelaufen, bestanden, aktueller Fingerprint
```

Stufe 1 von `verify-all` erzeugt die Referenzergebnisse jedes Mal neu aus den gepinnten Quellen
(Korpus, Saxon-SVRL über die ISO-Skeleton-Kompilate, Saxon-XPath-Erwartungen, JDK-21-Xerces für
XSD); Stufe 2 vergleicht. `--reuse-references` überspringt Stufe 1 für schnelle Entwicklungsläufe
und markiert sie als „nicht gelaufen“ (die Freigabe mit `--strict` schlägt dann fehl).

Hinweis zur Kompilierung der KoSIT-Regel-XSLTs: Das Release der Konfiguration kompiliert die CEN-
und XRechnung-Schematron-Dateien mit **SchXslt 1.10.1** (`pipeline-for-svrl.xsl`,
`full-path-notation=3`, `generate-fired-rule=false`; `abu-schematron-schxslt.xml`). Die Testreihe
`kosit-official` benutzt genau diese Release-XSLTs (Release-ZIP) mit dem Original-JAR; die
unabhängige Nachbildung `test/kosit-reference/` kompiliert mit dem ISO-Skeleton (siehe
`docs/KOSIT-REFERENCE.md`).
