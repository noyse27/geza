# Plex-Sync: Aufwand und Regressionstests

Der Bibliotheksscan lädt Verbindungseinstellungen und Serverkennung einmal pro Lauf.
Länder- und Genreregeln werden einmal innerhalb der gesperrten Scan-Transaktion
geladen; der nächste Scan liest sie neu ein. Unveränderte Metadaten werden nicht
erneut geschrieben. Änderungen an Quelle oder ursprünglichen Länder-/Genrewerten
werden weiterhin gespeichert, auch wenn der angezeigte Wert gleich bleibt.

Auftragsergebnisse werden in Paketen von höchstens 200 Einträgen innerhalb derselben
Transaktion gespeichert. Ein Rollback verwirft alle Pakete. Bibliotheksauswahl,
Vorschau, gespeicherte Zuordnungen und die Isolation einzelner Titelkonflikte bleiben
Teil desselben Ablaufs. Das Lesen der Plex-Einträge ist als eigener Schritt von der
Datenbankverarbeitung getrennt.

## Messung

Der Test `scan query budget for 40 unchanged films` in `tests/job-history.test.ts`
misst einen zweiten Scan von 40 bereits vorhandenen Filmen mit Ländern und Genres,
einschließlich Auftragsergebnissen. Die Plex-Antworten sind Testdaten.

| Stand | Datenbankaufrufe |
| --- | ---: |
| Vor der Optimierung (a7bce0b) | 792 |
| Mit wiederverwendeten Regeln, gebündelten Ergebnissen und vermiedenen Schreibvorgängen | 315 |

Das sind rund 60 % weniger Datenbankaufrufe in diesem Szenario, keine Messung einer
entsprechenden Laufzeitverbesserung im Produktivbetrieb. Fortschrittsmeldungen können
abhängig von der Laufzeit zusätzliche Aufrufe erzeugen; der Regressionstest erlaubt
deshalb weniger als 400 Aufrufe.

`npm run test:jobs` prüft zusätzlich unveränderte Änderungszeitpunkte, das Neuladen
geänderter Regeln, Ergebnisreihenfolge, Schwärzung sensibler Details und den Rollback
über mehrere Pakete. Die bestehenden Tests decken ausgewählte Bibliotheken,
fehlende IDs, Konflikte, Bucketliste und gespeicherte Zuordnungen ab.

Eine Umstellung der Bibliothekszuordnung von Namen auf stabile Plex-Section-IDs ist
eine separate Änderung und benötigt eine eigene Migration und Prüfung.
