# Sammlungen

`/collections` bietet Filmreihen, Genres, FSK, Länder, Erscheinungsjahre und GEZA-Bewertungen. Die Angaben auf der Detailseite führen direkt zur passenden Sammlung. Es werden Filme aus dem vorhandenen Katalog angezeigt; Serien, Staffeln und Episoden sind nicht Teil dieser Sammlungen.

Die Altersfreigabe wird beim Speichern (Anbieterabgleich und manuelle Bearbeitung) einheitlich auf `FSK <Wert>` normalisiert. Filme ganz ohne Altersangabe erscheinen in der eigenen Kachel „Keine Altersangabe“ statt in der Sammlung zu fehlen.

- Jede Unterkachel zeigt die Anzahl unterschiedlicher Filme. Mehrere Anschauereignisse und doppelte Genreangaben erzeugen keine doppelten Filmzeilen.
- Die Ergebnisliste enthält 50 Filme pro Seite. „Weitere 50“ und „Vorherige 50“ blättern durch alle Ergebnisse. Suche und Sortierung gelten für die gesamte ausgewählte Sammlung; eine neue Suche beginnt auf Seite 1.
- Die gespeicherte Reihenfolge aus `film_series_members` bleibt der Standard für Filmreihen. Die vorhandene Reihenfolgebearbeitung ist für Admins verlinkt.
- Filmzeilen öffnen ausschließlich innerhalb der Sammlungen die wiederverwendete Detailansicht als Modal. Schließen, Escape und Browser-Zurück erhalten Liste, Suche, Sortierung und Scrollposition. Vorheriger/Nächster blättert durch die aktuelle Ergebnisseite.
- Ein Kategorienklick im Modal ersetzt dessen Navigationseintrag durch die neue Sammlung. Browser-Zurück führt dadurch zur vorherigen Sammlung, ohne Modalstapel.
- Ein direkter Aufruf oder Neuladen von `/collections/title/:id` führt zur normalen `/title/:id`-Seite. Der Link „Detailseite öffnen“ bietet denselben Ausstieg.
- Änderungen im Modal aktualisieren beim Zurückkehren die Liste und deren Anzahl. Private Funktionen und Entwurfsreviews verwenden dieselbe serverseitige Zugriffsprüfung wie die normale Detailseite.

## Betrieb und Geschwindigkeit

Migration `011_collections.sql` ergänzt Indizes für Genre, Land, FSK, Titel und Bewertung. Vor dem Start einer aktualisierten Installation `npm run db:migrate` mit der passenden `DATABASE_URL` ausführen; Docker Compose erledigt dies bereits über den vorhandenen Migrationsdienst.

Listen laden nur Zeilendaten und maximal 51 Datensätze (50 plus Erkennung einer Folgeseite). Vollständige Details werden erst beim Öffnen angefordert. Suche und Sortierung laufen in PostgreSQL; externe Anbieter werden für die Ergebnisanzeige nicht abgefragt. Die Liste bleibt beim Öffnen eines Modals im Browser erhalten. Es gibt keinen dauerhaften Cache privater Detaildaten.

Lokale Messung am 09.09.2026 mit PostgreSQL 16 und 20.080 synthetischen Filmen: Gruppenanzahlen und erste Ergebnisseite zusammen benötigten im warmen Median 17 ms für Genre, 16 ms für Land, 7 ms für FSK, 14 ms für Jahr und 1 ms für Bewertung. Das sind Datenbank-/Abfragezeiten, keine Garantie für die vollständige Browseranzeige oder den Produktivbestand.

## Prüfung

`npm run test:collections` benötigt eine migrierte Testdatenbank. Der Test prüft exakte Filter, mehrere Länder, Duplikatfreiheit, mehr als 50 Treffer, Suche, stabile Reihenfolge, ungültige Eingaben und das Fehlen privater Anschauerdaten in Listen. Er läuft auch in der CI.

Zusätzlich im Browser mit isolierten Testdaten geprüft: Paging, Modal öffnen/schließen, Scrollposition, Vorheriger/Nächster, Kategorienwechsel und Browser-Zurück, Bewertungsänderung mit Entfernung aus der bisherigen Sammlung, Titelbearbeitung sowie mobile Darstellung.
