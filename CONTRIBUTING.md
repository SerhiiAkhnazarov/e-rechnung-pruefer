# Mitarbeit

Beiträge sind willkommen – Fehlerberichte, abweichende Prüfergebnisse, Verbesserungen von Texten und Code.

**Sicherheitslücken bitte nie öffentlich** (kein Issue, kein Pull Request), sondern vertraulich melden:
https://serhiiakhnazarov.github.io/e-rechnung-pruefer/security-contact/ (Richtlinie: `SECURITY.md`).

## Fehler melden

Über ein Issue mit Version (Fußzeile der Seite), Browser und einer möglichst kleinen, **geschwärzten** Datei. Bei
abweichenden Prüfergebnissen hilft das Ergebnis des offiziellen KoSIT-Validators.

## Code beitragen

- Bauen und prüfen wie in `README.md`, Abschnitt „Bauen und prüfen“; vor einem Pull Request
  `node tools/verify-all.cjs --ext ext --skip pdfa-verapdf` (oder die betroffenen Testreihen mit `--only`). Der CI-Lauf
  prüft jede Änderung vollständig unter Linux und Windows.
- Regeln, die die Tests erzwingen: Inhalte von Rechnungen nur als Text ausgeben (Textknoten, nie HTML aus
  Zeichenketten); keine Netzwerkzugriffe; keine Inline-Ereignisse oder Stilattribute in der Seite (die
  Content-Security-Policy erlaubt nur Skripte mit bekannter SHA-256); keine unsichtbaren Steuer- oder
  Richtungszeichen im Quelltext (als Escape-Sequenz schreiben); neue Quellen nur mit Commit bzw. SHA-256 im Manifest
  (`tools/make-manifest.cjs`), mit Lizenzhinweis in `NOTICE` und in der Stückliste (`tools/make-sbom.cjs`).
- Abhängigkeiten der Prüfumgebung nur in festen Versionen (`package.json`, `package-lock.json`), Actions nur auf Commits
  festgelegt.
- Sichtbare Texte auf Deutsch; Aussagen zu Recht und Normen mit Quelle (`docs/UST-EINORDNUNG.md`).
- Änderungen in `CHANGELOG.md` beschreiben.

## Lizenz

Der E-Rechnung Prüfer steht unter der **EUPL-1.2** (`LICENSE`). Mit einem Beitrag stimmen Sie zu, dass er unter dieser
Lizenz veröffentlicht wird, und bestätigen, dass Sie dazu berechtigt sind. Für Inhalte Dritter gelten die Hinweise in
`NOTICE`.

Verhaltenskodex: `CODE_OF_CONDUCT.md`.
