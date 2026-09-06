# Erste lokale Abnahme

Stand: 6. September 2026. Geza läuft als Docker-Paket auf `http://localhost:3080`.

## Daten

31.065 Medienobjekte, 25.326 Anschauereignisse, 5.576 Bewertungen und 28 Kommentare. Sechs Zeitpunkte sind unbekannt; 23 mehrfach zugeordnete Plex-GUIDs bleiben zur Prüfung erhalten. Bewertungen und Reviews sind öffentlich, Anschauinformationen privat.

## Ausprobieren

1. Ohne Login nach „Arrival“, „Dark“ oder einer IMDb-ID suchen; Live-Treffer und Enter-Ergebnisse vergleichen.
2. Öffentliche Detailseite öffnen: Bewertung und Reviews sichtbar, keine Anschauinformationen.
3. Mit `data/admin-access.txt` anmelden. Home zeigt zehn neueste Ereignisse.
4. History auf April 2020 setzen, Film/Serie filtern, weitere Einträge laden.
5. Detailseite öffnen und zurück zur vorherigen Ansicht navigieren.
6. Unter Data Erscheinungsjahr, Anschaujahr und Bewertung kombinieren.
7. Details oder Reviews bearbeiten; ein Review bei Bedarf bewusst als Entwurf speichern.
8. Abmelden und prüfen, dass private Seiten und APIs wieder gesperrt sind.

## Messungen und Verifikation

Lokaler Docker-Desktop-Host, PostgreSQL auf einem Docker-Volume. Keine Zusicherung für den späteren VPS oder eine Internetverbindung.

| Test                                                               | Ergebnis                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| HTTP-Suche: 50 Anfragen, fünf gleichzeitig, echter Bestand         | p95 ca. 41 ms vor der letzten Abfrageoptimierung                      |
| Suchabfrage: 310.650 Medienobjekte, fünf gleichzeitig, 50 Anfragen | p50 6 ms, p95 22 ms, Maximum 30 ms nach Optimierung                   |
| Backup und Wiederherstellung in isolierte Datenbank                | Alle Medien, Ereignisse, Bewertungen und Kommentare wiederhergestellt |

Der große Testbestand wiederholt vorhandene Metadaten zehnmal. Gemessen werden Datenbankabfragen samt Poolwartezeit mit warmen lokalen Daten, keine Bilddownloads oder Browserdarstellung. Die Live-Suche fügt 150 ms Tipp-Pause hinzu. Nach dem Hosting auf der Zielmaschine erneut messen.

Zugriffstests prüfen öffentliche Bewertungen/veröffentlichte Reviews, verborgene Entwürfe, private History, Login/Logout, CSRF, Monatsnavigation, Pagination, manuelle Metadatensperren und Sitemaps.

## Noch einzurichten

- Provider-Zugänge in Admin. Bis dahin fehlen Poster und ergänzende Metadaten.
- Plex-Server und echte Scrobble-/Rating-Ereignisse einschließlich Entfernen einer Bewertung testen.
- Automatische neue Plex-Reviewtexte: weiterhin offen, kein dokumentierter Review-Webhook.
- Zielserver, DNS und HTTPS auf Port 777. Sitemaps sind vorbereitet, lokal aber deaktiviert.

Ein öffentlicher Host wurde noch nicht aktiviert. „Öffentlich“ bezeichnet derzeit den ohne Login erreichbaren lokalen Geza-Bereich.
