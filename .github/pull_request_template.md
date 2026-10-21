<!-- Sicherheitslücken bitte nicht über einen Pull Request offenlegen, sondern vertraulich melden: SECURITY.md -->

## Änderung

<!-- Was ändert sich und warum? -->

## Prüfung

- [ ] `node tools/verify-all.cjs --ext ext --skip pdfa-verapdf` bestanden (oder die betroffenen Testreihen mit `--only`)
- [ ] neue oder geänderte Funktion mit Tests abgedeckt
- [ ] keine Ausgabe von Rechnungsinhalten als HTML (nur Textknoten), keine Netzwerkzugriffe, keine neuen Abhängigkeiten
      ohne Eintrag im Manifest, in `NOTICE` und in der Stückliste
- [ ] sichtbare Texte auf Deutsch, Rechtsangaben mit Quelle
- [ ] `CHANGELOG.md` ergänzt

Mit dem Einreichen stimmen Sie zu, dass Ihr Beitrag unter der EUPL-1.2 veröffentlicht wird (`CONTRIBUTING.md`).
