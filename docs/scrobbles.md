# Scrobbles in der History

Der Plus-Button in der History ist nur nach Admin-Anmeldung sichtbar. Er öffnet einen Dialog mit „Neu anlegen“ und „Offene Scrobbles“. Die Zahl am Button zählt endgültig fehlgeschlagene Plex-Scrobble-Aufträge; beim Öffnen wird sie aktualisiert. Auch ältere fehlgeschlagene Jobs sind enthalten. Laufende Wiederholungsversuche erscheinen erst nach ihrem letzten Fehlschlag.

## Neu anlegen

Die Suche fragt ausschließlich vorhandene Filme und Serien im Geza-Katalog ab. Bei einer Serie werden vorhandene Episoden nach Staffel gefiltert. Titel, Jahr und Datensatz-ID helfen beim Unterscheiden gleicher Namen. Noch nicht katalogisierte Filme oder Episoden lassen sich hier nicht neu importieren; eine spätere Anbietersuche benötigt einen eigenen Schritt zur verlässlichen Übernahme der Provider-IDs.

Das Datum ist erforderlich, die Uhrzeit optional. Die Eingabe wird als Europe/Berlin interpretiert und als UTC-Zeitstempel gespeichert. Ohne Uhrzeit dient 12 Uhr nur zur Sortierung; `time_estimated` kennzeichnet die fehlende genaue Uhrzeit. Nicht existierende Uhrzeiten bei der Frühjahrsumstellung werden abgelehnt. Bei der doppelt vorkommenden Stunde im Herbst verwendet PostgreSQL die Standardzeit.

## Offene Scrobbles

Empfangener Titel, Serie, Staffel/Episode, Fehler und Anfrageverlauf helfen beim Zuordnen. Der Admin sucht den passenden Katalogtitel, prüft Datum und Uhrzeit und bestätigt „Zuordnen und Scrobble speichern“. Wenn verfügbar, wird der ursprüngliche `lastViewedAt`-Zeitpunkt vorausgefüllt; sonst das Empfangsdatum ohne genaue Uhrzeit.

Speicherung und Abschluss des Jobs erfolgen in derselben Datenbanktransaktion mit einer Sperre auf dem Auftrag. Der Scrobble behält seine Plex-Ereignis-ID, sodass erneutes Absenden keinen zweiten Eintrag erzeugt. Die Entscheidung wird im Ereignisprotokoll aufgezeichnet. Eine konkurrierende abweichende Zuordnung wird abgelehnt.

Die Entscheidung gilt für dieses Ereignis. Sie überschreibt keine Provider-IDs und führt keine Katalogdatensätze zusammen. Ein zugrunde liegender ID-Konflikt kann daher bei einem späteren Webhook erneut auftreten; dessen dauerhafte Bereinigung erfordert die Prüfung der betroffenen Katalogdatensätze. Technische Fehler ohne ID-Konflikt erscheinen ebenfalls in der Liste und können manuell nachgetragen werden.

## Scrollpfeil

Der Pfeil erscheint nach 250 Pixeln Scrollen rechts unten. Der Ring bildet den Fortschritt im aktuell geladenen Dokument ab und wird bei nachgeladenen Inhalten neu berechnet. Auf der endlos ladenden History ist dies kein Anteil an der gesamten Datenbank. Ein Klick scrollt zum Anfang; bei reduzierten Bewegungseinstellungen ohne Animation.

## Prüfung

`node --import tsx scripts/scrobble-check.ts` benötigt `DATABASE_URL` und die Berechtigung, eine temporäre Testdatenbank anzulegen. Geprüft werden Zeitzonen, fehlende Uhrzeit, ungültige Daten, Wiederholungen, parallele Korrekturen und Transaktions-Rollback. Die Testdatenbank wird anschließend entfernt.
