# Reversible Länder- und Genre-Zuordnungen

`media.original_countries` und `media.original_genres` speichern die übernommenen Quellwerte vor statischer Normalisierung und manuellen Alias-Regeln. `countries` und `genres` bleiben die materialisierten Anzeigewerte für Suche und Sammlungen. Zuordnen und Lösen berechnen diese aus den Originalen neu; Alias-Ketten behalten ihre Kanten, damit auch ein späteres Zusammenführen eines Ziels rückgängig gemacht werden kann.

Provider-Updates speichern Originale und Anzeige unter derselben Transaktionssperre wie die Alias-Verwaltung. Länder/Genres dürfen dabei auch vom bisherigen Provider aktualisiert werden; manuell gesperrte Felder bleiben geschützt. Der Titel-Editor zeigt die Originalwerte. Installationstransfers bewahren auch explizit unbekannte Originalwerte (`NULL`).

## Einmaliger Startlauf

Migration `027_reversible_facets.sql` legt für einen vorhandenen Bestand genau einen Job `facet-recovery-v1` an. Neue, leere Installationen benötigen keinen Lauf. Der Worker priorisiert diesen Job nach dem Start:

1. Plex-Bibliotheken seitenweise lesen und anhand vorhandener Provider-IDs zuordnen. Interne Plex-Tag-IDs spielen beim Vergleich keine Rolle.
2. Fehlende Daten soweit möglich über TMDB/TVDB ergänzen. Nur eindeutige, nicht leere Quellwerte übernehmen; manuell gesperrte Felder und nicht rekonstruierbare Werte als offen markieren.
3. Originale und Fortschritt je Titel atomar speichern. Bei einem Neustart wird ab dem letzten Checkpoint fortgesetzt.
4. Nach der Quellprüfung die bestehenden Alias-Regeln auf die Originalwerte anwenden und Abschluss sowie Ergebniszahlen gemeinsam speichern.

Während des Laufs sind Alias-Änderungen gesperrt. Die restliche Anwendung bleibt nutzbar. Das Admin-Infofenster zeigt Fortschritt, Ergebnis und offene Titel. „Erneut prüfen“ startet nur für weiterhin fehlende Originale einen neuen Versuch. „Wiederherstellungsstatus anzeigen“ im Länder-/Genre-Manager öffnet eine geschlossene Meldung wieder. Ein abgeschlossener Lauf wird beim normalen Neustart nicht wiederholt.

Fehlende Quellen werden nicht durch bereits umgeschriebene Anzeigewerte ersetzt. Betroffene Werte bleiben unverändert; Zuordnungsänderungen, die unbekannte Originale betreffen, werden mit einer erklärenden Meldung abgelehnt. Korrekturen erfolgen über die Originalfelder des Titel-Editors oder durch erneute Quellenprüfung. Eine weiterhin vorhandene falsche Alias-Regel wird absichtlich nicht automatisch entfernt: der Lauf übernimmt die eingerichteten Regeln, die danach reversibel gelöst werden können.

## Prüfung und Betrieb

`npm run test:facets` verwendet eine eigene temporäre Datenbank. Abgedeckt sind Italien/Sowjetunion, Mehrfachwerte, Alias-Ketten, Neuimport, Originalwert-Erhalt, Checkpoints, Neustart und ungelöste Quellen. Der Transfer-Test prüft den vollständigen Erhalt der Originalwerte einschließlich unbekannter Werte.

Vor dem Update eine Datenbanksicherung erstellen. Nach dem Deployment starten Migration und Worker wie bisher über Docker Compose. Kein separater Reparaturbefehl ist nötig. Es werden ausschließlich Geza-Daten geändert, keine Metadaten in Plex.
