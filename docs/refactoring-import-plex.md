# Refactoring-Plan: Trakt, Plex, Bucketliste und Rumpelkammer

Stand: 25. September 2026. Implementiert im Arbeitsstand; noch nicht auf den Produktivbestand angewendet.

## Umsetzungsstand und Prüfung

- Migration 019 führt Herkunft, Sichtungsbelege und ausdrückliche Bucketlistenentscheidungen ein. Eine gemeinsame Datenbankberechnung bedient Import, Plex, manuelle Sichtungen und Korrekturen. Bestehende manuelle Wünsche bleiben geschützt; alte automatische Wünsche bleiben bis zum vollständigen Plex-Abgleich erhalten.
- Plex scannt paginiert den Bestand einschließlich Episoden, ermittelt Staffelwünsche und veröffentlicht die Einordnung atomar. Vorschau, manuelle Ausschlüsse, Herkunftsfilter, Uhrzeit und Ergebnisanzeige sind im Admin verfügbar. Ein laufender Job wird durch manuelle Starts nicht überschrieben; ein Folgeauftrag wird eingeplant.
- Trakt-Watchlist, Gesehen-Zusammenfassungen und verschachtelte Staffeln/Episoden werden verarbeitet. Import-Vorschau und nachgelagerter Plex-Abgleich sind eingebaut. Spätere Plex-Einrichtung stößt denselben Abgleich an.
- Specials (Staffel 0) werden wie andere Staffeln behandelt. Eine einzige vorhandene Episode belegt Staffelbestand; eine einzige belegte Sichtung verhindert die automatische Einstufung dieser Staffel als ungesehen. Manuelle Serien-Ausschlüsse unterdrücken auch automatische Staffelwünsche.
- Der bisherige Löschschutz bleibt bestehen: ein vom Import oder Plex belegter Gesehenstatus darf einen gelöschten Titel wieder aufnehmen. Es wird dabei nicht behauptet, dass diese Sichtung nach der Löschung erfolgt ist.
- 249 vorhandene Exportdateien zweimal in eine isolierte PostgreSQL-17-Testdatenbank importiert: in beiden Läufen 32.597 Medienobjekte, 25.326 Sichtungsereignisse, 1.543 Rumpel-Titel und 23 gemeldete Provider-Kollisionen. Keine Verdoppelung beim Wiederholungsimport. Die höhere Objektzahl gegenüber dem alten Import enthält nun auch Staffel-/Episodenstruktur aus Collection-Dateien.
- Typprüfung und Produktionsbuild unter Node 22 erfolgreich. Datenbankregression prüft Bestandsmigration, Staffelregeln, Vorschau-Rollback, Ausschlüsse, Sichtungskorrektur, wiederholten Import, Scanfehler und Jobplanung. HTTP-Prüfung testet Anmeldung, Adminanzeige, Scan-Vorschau, Staffel-Bucketliste, Ausschluss und ZIP-Vorschau/Import mit Folgeauftrag. Bestehende Unit-, Rumpelkammer-, Zuordnungs-, Scrobble-, Umzugs-, Demo- und Katalogprüfungen wurden ebenfalls ausgeführt.

Reproduzierbare Prüfungen mit `DATABASE_URL` auf einen Test-PostgreSQL-Server und Berechtigung zum Anlegen temporärer Datenbanken: `npm run test:classification`; nach `npm run build` zusätzlich `npm run test:classification:http`. Beide Skripte erzeugen und entfernen eigene Testdatenbanken. Der HTTP-Test verwendet Port 32119 und einen lokalen Plex-Testserver.

Offen bleibt die Abnahme an einer echten Plex-Verbindung mit deren konkreten Bibliotheksantworten. Keine produktive Migration und kein Live-Plexscan wurden ausgeführt. Die folgenden Abschnitte halten die Anforderungen und Entscheidungen des Plans fest.

## Ziel und abgestimmte Regeln

Eine gemeinsame Einordnung verwendet Importherkunft, ausdrückliche Wünsche, tatsächliche Sichtungen und aktuelle Plex-Verfügbarkeit. Das Ergebnis darf nicht von der Reihenfolge der Einrichtung abhängen: Trakt zuerst und Plex zuerst führen nach vollständigem Abgleich zum gleichen Ergebnis. Ein erneuter Trakt-Import ist beim späteren Anschließen von Plex nicht nötig.

| Sachverhalt                                                                   | Ziel                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Nur Trakt Collection, keine Aktivität und keine bestätigte Plex-Verfügbarkeit | Rumpelkammer; ausstehende Prüfung ausdrücklich kennzeichnen                |
| Trakt-Watchlist oder manuell hinzugefügt                                      | Bucketliste; ausdrückliche Wünsche vor automatischer Umsortierung schützen |
| Ungesehener Film aktuell in Plex                                              | Bucketliste                                                                |
| Serie aktuell in Plex, keine Episode gesehen                                  | Ganze Serie in Bucketliste; keine doppelten Staffel-Einträge               |
| Serie begonnen, einzelne vorhandene Staffeln ohne gesehene Episode            | Nur diese Staffeln in Bucketliste; Serie bleibt im Archiv                  |
| Staffel begonnen                                                              | Nicht automatisch in Bucketliste, auch wenn Episoden fehlen                |
| Staffel nicht in Plex vorhanden                                               | Keine automatische Aufnahme aufgrund von Plex                              |
| Eigene Aktivität ohne offenen Wunsch                                          | Archiv                                                                     |

Aktuelle Verfügbarkeit ist nur durch einen erfolgreichen Plex-Abgleich belegt, niemals durch eine Plex-ID oder Trakt Collection. Ohne Plex entstehen Wünsche aus Watchlist und manueller Auswahl. Eine Serien-Watchlist bei begonnener Serie belegt keine konkreten ungesehenen Staffeln; diese nicht automatisch erfinden.

## Import und Einrichtung

- Importdialog zeigt den Abschnitt „Einordnung nach dem Import“.
- Plex eingerichtet: anschließend mit Plex abgleichen und die Staffelregel anwenden. Importerfolg und Abgleicherfolg separat anzeigen.
- Plex fehlt: Import ist trotzdem möglich. Hinweis: „Collection-Titel ohne eigene Aktivität bleiben zunächst in der Rumpelkammer. Sobald Plex verbunden ist, übernehmen wir vorhandene ungesehene Titel und Staffeln in die Bucketliste.“
- Plex später verbunden: vollständigen Bestandsabgleich anbieten und vorhandene Datensätze zuordnen, ohne Reimport.
- Dauerhafte Plex-Einstellung „Ungesehenen Plex-Bestand automatisch in die Bucketliste übernehmen“, Standard an nach Einrichtung. Der Import zeigt die Einstellung, fragt die Grundentscheidung nicht jedes Mal neu ab.
- Ohne Plex optional „Ungesehene Collection-Titel als Bucketliste übernehmen“, Standard aus, mit Vorschau und Herkunft „laut Trakt Collection“; keine Verfügbarkeitszusage.
- Trakt-Watchlist-Import ergänzen. Tatsächliche Exportformate anhand von Beispieldateien prüfen, insbesondere Staffelwünsche und verschachtelte Episoden-/Staffeldaten.
- Vorhandene Unterstützung für `watched-movies-*` und `watched-shows-*` prüfen: derzeit markieren diese Dateien Importaktivität für den Löschschutz, erzeugen aber nicht wie `watched-history-*` dauerhafte Sichtungen. Gesehenstatus erhalten, ohne historische Einzelereignisse oder Zeitpunkte zu erfinden.

## Gemeinsames Zustandsmodell

- Herkunft je Eintrag nachvollziehbar speichern: Collection, Watchlist, Plex, manuell; mehrere Quellen zulassen. Alte Herkunft nicht nachträglich als gesichert behaupten.
- Verfügbarkeit getrennt speichern: ungeprüft, vorhanden, nach vollständigem Abgleich nicht vorhanden; jeweils Server/Bibliothek, Prüfzeit und Laufbezug. Veraltete Ergebnisse sichtbar lassen.
- Gesehenstatus von Sichtungsereignissen und Bewertungen trennen. Vorhandene Trakt-/Geza-Sichtungen mitzählen; eine Bewertung oder ein Friend-Review beweist keine gesehene Episode.
- Zuordnungsgrund speichern oder reproduzierbar ermitteln und im Admin anzeigen, zum Beispiel „Staffel 3 in Plex, keine Episode gesehen“.
- Eine gemeinsame Berechnung für Import, Scan, Webhooks, manuelle Sichtungen, Bewertungen und deren Korrektur/Löschung verwenden. Keine konkurrierenden Sonderregeln in Triggern und Anwendungscode.
- Serie im Archiv plus ungesehene Staffel in Bucketliste unterstützen. Bestehende Vererbung von `rumpel` über den gesamten Serienbaum entsprechend umbauen.
- Expliziten Bucketlistenwunsch und automatische Aufnahme unterscheiden. Alle manuellen Hinzufügewege gleich schützen; `manual_entry` und `bucketlist_pinned` konsistent migrieren.

## Plex-Abgleich und Jobs

- Bestehende getrennte Bestandsimporte und Rumpelkammer-Prüfungen auf einen gemeinsamen vollständigen Bestandssnapshot stützen; Verfügbarkeit auch für Bucketliste und Archiv nutzbar machen.
- Serien, Staffeln und nötige Episodeninformationen abfragen. Fehlende Werte nicht als null gesehene Episoden interpretieren. Staffelverfügbarkeit erfordert tatsächlich vorhandene Episoden.
- Bibliotheken gemeinsam auswerten: identische Titel in mehreren Bibliotheken dürfen nicht abhängig von der Verarbeitungsreihenfolge unterschiedlich einsortiert werden.
- Stabile Zuordnung über Provider-IDs und bei Staffeln/Episoden Serienzugehörigkeit plus Nummer prüfen. Mehrdeutige Treffer zur Klärung ausweisen, nicht still zusammenführen.
- Vollständigkeit der Bibliotheksantworten und gegebenenfalls Pagination prüfen. Bei Teilfehlern keine negative Verfügbarkeit oder darauf beruhende Entfernung anwenden.
- Ergebnisse konsistent veröffentlichen; Fehler beim Schreiben mehrerer Batches dürfen keinen scheinbar vollständigen Abgleich hinterlassen.
- Tägliches Scheduling reparieren: Worker darf den neu geplanten Job nicht wieder auf `done` setzen. Wiederholungszähler erhalten; manuelles Payload nicht in Folgeläufe übernehmen.
- Parallele manuelle Starts, laufende Imports, Webhooks und lange Scans berücksichtigen. Wiederholung darf weder doppelte Sichtungen noch gegensätzliche Zuordnungen erzeugen.
- Plex-Abschaltung oder Ausfall erhält bestehende Zuordnungen und zeigt den letzten Prüfstand. Nur ein vollständiger erfolgreicher Abgleich belegt entfernten Bestand; niemals automatisch Medien löschen.

## Angrenzende Abläufe und zusätzliche Vorschläge

Diese Punkte gehören in den Entwurf; noch offene Produktentscheidungen vor Umsetzung konkret festlegen:

1. **Manuelles Entfernen aus der Bucketliste:** Vorschlag: als ausdrücklichen Ausschluss merken, damit der nächste Scan den Titel nicht sofort zurückholt. „Wieder automatisch berücksichtigen“ anbieten. Von vollständigem Löschen unterscheiden.
2. **Gelöschte Titel:** bestehenden Löschschutz erhalten. Wiederaufnahme bei neuer Aktivität nachvollziehbar protokollieren. Offener Detailfall: bloß bereits vorhandener Plex-Gesehenstatus versus eine nach der Löschung neu erfolgte Sichtung.
3. **Nicht mehr in Plex:** automatische Wünsche nach bestätigtem Wegfall neu einordnen, manuelle/Watchlist-Wünsche behalten. Verfügbarkeit und Sehwunsch bleiben getrennt.
4. **Neue Staffel:** bei einer begonnenen Serie nach erfolgreichem Scan automatisch aufnehmen, sobald Episoden vorhanden und noch keine gesehen sind. Erste Sichtung entfernt nur den betroffenen automatischen Staffelwunsch.
5. **Grenzfälle bei Serien:** Specials/Staffel 0, teilweise vorhandene Staffeln, gesehene inzwischen entfernte Episoden und widersprüchliche Quellen ausdrücklich testen. Vorschlag: jede belegte Sichtung verhindert die Einstufung als vollständig ungesehen; unbekannter Status bleibt unbekannt. Specials-Default noch festlegen.
6. **Bucketlistenanzeige:** Staffeln mit Serienname und Staffelnummer anzeigen; Zählung als „Serien/Staffeln“ verständlich machen. Details, Suche, Sammlungen und öffentliche Sichtbarkeit auf die neue Hierarchie abstimmen.
7. **Nachvollziehbarkeit:** Filter für Herkunft, Zuordnungsgrund, ungeprüft und zuletzt abgeglichen. Im Importbericht neue Titel, vorhandene Treffer, nicht zuordenbare IDs und nachfolgende Umsortierungen getrennt zählen.
8. **Bestandsumstellung:** Vorschau mit Vorher/Nachher und Gründen, dann wiederholbare Migration. Manuelle Wünsche, Aktivitäten und Löschschutz erhalten. Bei alten Daten unbekannte Herkunft offenlegen; keine pauschale Leerung der Bucketliste.
9. **Export/Serverumzug:** neue Herkunft, Wünsche, Ausschlüsse und Geseheninformationen mitnehmen. Plex-Verfügbarkeit nach Wechsel der Verbindung erneut prüfen statt alte Serverdaten als aktuell auszugeben.
10. **Dokumentation:** README-Aussage „Collection-Dateien = Plex-Bibliothek“ korrigieren; Einrichtung, Importhilfe, Demo und Abnahme auf tatsächlich implementiertes Verhalten aktualisieren.

## Adminumfang

Direkt sichtbar: automatische Plex-Einordnung, Zeitplan, explizite Auswahl „Alle Bibliotheken“/„Ausgewählte Bibliotheken“, Vorschau und „Jetzt abgleichen“. Keine Bibliotheken ausgewählt darf nicht verdeckt alle bedeuten.

Ergebnisanzeige: letzter erfolgreicher Lauf, nächster Lauf, Vollständigkeit, neue/umgeordnete Titel und Staffeln, geschützte Wünsche, ignorierte gelöschte Titel und Fehler. Importumfang und Verfügbarkeits-Prüfumfang bei abweichender Bibliotheksauswahl klar erklären.

Kein Zielschalter „Plex-Ungesehenes in Rumpelkammer oder Bucketliste“ pro Bibliothek nötig: bei aktivierter Automatik gilt die abgestimmte Regel einheitlich. Technische Schutzregeln sind keine optionalen Adminschalter.

## Umsetzung und Abnahme

1. Exportformate und bestehende Daten prüfen; offene Produktdetails festlegen. Gemeinsame Regeln und Datenmigration entwerfen.
2. Scheduling und vollständige Plex-Bestandserfassung reparieren; Staffel-/Episodenzuordnung ergänzen.
3. Gemeinsame Einordnung mit Herkunft, Wünschen und Gesehenstatus implementieren; alle schreibenden Abläufe anschließen.
4. Import-/Einrichtungsdialog, Staffel-Bucketliste und Erklärungen ergänzen.
5. Vorschau für Bestandsumstellung prüfen; Migration und Dokumentation abschließen.

Erforderliche Prüffälle:

- Trakt zuerst/Plex später und umgekehrte Reihenfolge ergeben nach Abgleich denselben automatischen Zustand.
- Reiner Trakt-Import: Collection ohne Aktivität wird Rumpel, Watchlist wird Wunsch, belegtes Gesehen wird erhalten.
- Serie vollständig ungesehen; nur einzelne Staffeln ungesehen; Staffel begonnen; neue Staffel; leere oder fehlende Staffel; Specials.
- Plex meldet ungesehen, lokale Episode ist gesehen: keine fälschlich vollständig ungesehene Serie/Staffel.
- Manuelles Hinzufügen, Entfernen, erneutes Freigeben, Sichtung und Sichtungskorrektur bleiben über wiederholte Scans konsistent.
- Fehlgeschlagener/teilweiser Scan, abgeschaltetes Plex und Serverwechsel erzeugen keine falsche Abwesenheit.
- Mehrere Bibliotheken, widersprüchliche IDs und wiederholte Imports erzeugen keine Duplikate oder reihenfolgeabhängigen Zustände.
- Tägliche Folgeläufe, begrenzte Fehlerwiederholung und manueller Start während laufendem Job funktionieren.
- Migration und Export/Import erhalten Aktivitäten, ausdrückliche Wünsche und Löschschutz; öffentliche und private Daten bleiben korrekt getrennt.

Der implementierte und geprüfte Umfang sowie die verbleibende Live-Abnahme stehen oben im Umsetzungsstand.
