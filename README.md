# Geza

[![CI](https://github.com/noyse27/geza/actions/workflows/ci.yml/badge.svg)](https://github.com/noyse27/geza/actions/workflows/ci.yml)

Film- und Serienportal mit öffentlichen Bewertungen und Reviews sowie einem privaten Anschautagebuch. Next.js, PostgreSQL und Docker Compose. Die Schrift Syne wird lokal ausgeliefert.

## Sichtbarkeit

**Öffentlich:** Katalog, Suche, Detailseiten, Zehnerbewertungen und Reviews. Neue und importierte Reviews sind standardmäßig öffentlich; ein Review kann im Editor bewusst als Entwurf gespeichert werden. Die History zeigt ohne Login nur Anschauereignisse mit mindestens einer Bewertung oder einem öffentlichen Review; alle anderen Einträge sind ausgeblendet.

**Nach Login:** Alle Anschauereignisse ohne Filterung, Home, Data, persönliche Statistik, Bearbeitung und Export. Ein erneuter Import behält die bestehende Review-Sichtbarkeit bei.

## Lokal starten

Voraussetzung: Docker mit Compose. Kein separates Node.js oder PostgreSQL erforderlich.

```powershell
# Windows, im Projektordner
./setup.ps1
```

```sh
# Linux / macOS
sh setup.sh
```

Die Skripte erzeugen `.env` mit zufälligen Zugangsdaten und bauen das Image. Vorhandene Einstellungen
bleiben erhalten. Ohne vorhandenes Admin-Konto zeigt `/login` beim ersten Start automatisch eine Maske
zum Anlegen des Admins. Danach ist diese Einrichtung gesperrt und `/login` ist die normale Anmeldung.

- Anwendung: <http://localhost:3080>
- Erster Admin und Anmeldung: <http://localhost:3080/login>
- Provider-Zugänge: nach Anmeldung unter **Admin**

Die lokale App ist nur an `127.0.0.1` gebunden. Der Datenbankport ist im normalen Betrieb geschlossen; `compose.dev.yaml` stellt bei Bedarf PostgreSQL auf `127.0.0.1:5439` bereit.

## Trakt-Import

Nach der Anmeldung unter **Admin → Trakt-Export importieren** die ZIP-Datei aus dem Trakt-Export
hochladen. Geza entpackt die ZIP in ein temporäres Verzeichnis, übernimmt nur passende JSON-Dateien
für History, Bewertungen, Kommentare und Sammlung und entfernt die temporären Dateien danach wieder.

Als CLI-Alternative den entpackten Export in `data/trakt-export-noyse` ablegen:

```sh
docker compose exec -T worker node --import tsx scripts/import.ts /imports/trakt-export-noyse
```

Importiert werden History, Bewertungen, Kommentare und Bibliotheksobjekte. Trakt-Ereignis-IDs verhindern doppelte Importe; Wiederholungen bleiben erhalten. UTC-Zeitstempel werden für Berlin angezeigt. Der Epoch-Platzhalter von 1970 bleibt als unbekannter Zeitpunkt mit Originalwert erhalten. Mehrdeutige externe IDs werden im Importbericht gemeldet und nicht automatisch zusammengeführt. Auch Kommentare mit `review: false` bleiben erhalten, Antworten sind gekennzeichnet.

Exporte, Zugangsdaten, Backups und lokale Protokolle sind von Git und Docker-Builds ausgeschlossen.

## Metadaten und Plex

Auf Episoden- und Staffelseiten können angemeldete Admins über **Zuordnung korrigieren** eine vorhandene Serie suchen und Staffel sowie Episodennummer ändern. Cover, Jahr, Datensatz-ID und ein Link zur Serienansicht helfen bei gleichnamigen Treffern. Anschauereignisse, Bewertungen und Reviews bleiben am bisherigen Datensatz erhalten; erneute Trakt-Importe überschreiben die korrigierte Zuordnung nicht. Die Funktion führt keine doppelten Episoden zusammen.

Regressionstest mit einer automatisch angelegten und anschließend entfernten Testdatenbank: `node --import tsx scripts/assignment-check.ts` (benötigt `DATABASE_URL` und Berechtigung zum Anlegen einer Datenbank).

Unter **Admin → Verbindungen** TMDB Read Access Token, optional TVDB API-Key/PIN und Plex-URL/Token eintragen. Zugangsdaten werden mit `SESSION_SECRET` verschlüsselt gespeichert. Leere Felder behalten bestehende Werte. Alternativ funktionieren die Umgebungsvariablen aus `.env.example`.

Danach **Fehlende Metadaten laden** wählen. Priorität je Feld: manuelle Korrektur → Plex → TVDB bei Serien → TMDB. Jüngste Anschauereignisse werden zuerst bearbeitet. Der Hintergrundprozess wiederholt Fehler; Suche und History warten nicht auf Provider. Cover stammen ausschließlich von TMDB, ersatzweise TVDB. Angepasste Plex-Cover werden weder importiert noch bei Webhooks übernommen; bereits importierte Plex-Cover werden durch Migration 007 entfernt und zur Neuanreicherung vorgemerkt.

Für Webhooks müssen zusätzlich Account-ID, Server-UUID und ein zufälliges Webhook-Geheimnis gesetzt sein:

```text
https://geza.schwarzesherz.info:777/api/plex/DEIN-WEBHOOK-GEHEIMNIS
```

Unterstützt sind `media.scrobble` und `media.rate`. `userRating` wird als 0–10 interpretiert; 0 entfernt die Bewertung. Ohne verlässlichen Ereigniszeitpunkt wird die Empfangszeit als geschätzt gekennzeichnet. Die tatsächlichen Payloads des eigenen Plex-Servers müssen bei der Einrichtung geprüft werden.

Unter **Admin → Ereignisprotokoll** (`/admin/logs`) stehen Webhook-Empfang und Ablehnungsgründe, Anbieterabfragen mit URL/HTTP-Status sowie Job-Ergebnisse und Wiederholungsversuche. Über die Anfrage-ID lässt sich ein Webhook bis zur Verarbeitung verfolgen. Filter und ältere Einträge sind verfügbar; zum Nachladen die Seite aktualisieren. Zugangsdaten, Cookies und vollständige Request-Bodies werden nicht gespeichert. Der Worker löscht stündlich Einträge, die älter als 14 Tage sind. Bei Datenbankausfällen schreibt der Logger ersatzweise in die Container-Konsole; deren Aufbewahrung richtet sich nach der Docker-Konfiguration. Anfragen, die Geza gar nicht erreichen, können hier nicht erscheinen. Bestehende alte Jobfehler erhalten nachträglich keine zusätzlichen Details.

**Neue Plex-Reviewtexte:** Ihre automatische Übernahme ist weiterhin offen, weil kein dokumentierter Review-Webhook vorliegt. Trakt-Reviews und in Geza geschriebene Reviews funktionieren unabhängig davon.

## Hosting und Google

Auf dem Zielserver in `.env` setzen:

```text
PUBLIC_URL=https://geza.schwarzesherz.info:777
```

Ein vorhandener HTTPS-Reverse-Proxy kann auf `127.0.0.1:3080` weiterleiten. Ohne vorhandenen Proxy gibt es eine optionale Caddy-Konfiguration:

```sh
docker compose -f compose.yaml -f compose.hosted.yaml up -d
```

Dafür müssen DNS sowie TCP-Port **80** für die Zertifikatsvalidierung und **777** für HTTPS erreichbar sein. Port 80 darf nicht bereits belegt sein. Das tatsächliche Hosting erfordert noch den Zielserverzugang.

Bei gesetzter `PUBLIC_URL` werden `/sitemap.xml` und auf jeweils 10.000 URLs aufgeteilte `/sitemaps/0`, `/sitemaps/1` usw. aktiviert. Nur öffentliche Detailseiten werden eingetragen; Canonicals behalten den Port. Ohne Domain-Konfiguration liefert die Sitemap 404 und die lokale Vorschau ist `noindex`. Private Seiten und Suchergebnisse werden nicht indexiert.

## Sicherung und Updates

Sicherung: `./scripts/backup.ps1` auf Windows oder `sh scripts/backup.sh` auf Linux. **Zusätzlich `.env` sicher aufbewahren**, weil ihr Schlüssel für die Provider-Zugangsdaten benötigt wird. Datenbanksicherungen enthalten auch gespeicherte Poster. Im Adminbereich gibt es zusätzlich einen JSON-Export.

Wiederherstellung in eine **leere** Zieldatenbank:

```sh
docker compose stop app worker
docker compose cp backups/DEIN-BACKUP.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U geza -d geza --exit-on-error /tmp/restore.dump
docker compose up -d app worker
```

Eine vorhandene Datenbank nicht ungeprüft überschreiben. Updates nach Sicherung:

```sh
git pull --ff-only
docker compose build app
docker compose up -d
```

Migrationen laufen vor App und Worker. Das benannte Datenbankvolume überlebt Containerwechsel. `docker compose down -v` löscht es. Ein Code-Rollback allein macht Migrationen nicht rückgängig.

## Prüfungen

Mit lokalem Node.js: `npm ci`, `npm run lint`, `npm run test:unit`, `npm run db:migrate`, `npm run test:integration`, `npm run build`. Datenbankbefehle benötigen `DATABASE_URL` für eine Testdatenbank.

Die GitHub-CI folgt `adolar-songster` und `bloeki`: Typprüfung, Tests, Build, Trivy, Gitleaks, CodeQL und Image-Scan. Dependabot prüft npm, Docker und GitHub Actions montags in Europe/Berlin mit gruppierten Minor-/Patch-Updates. Entwicklungscompiler und Paketmanager werden nicht im Laufzeitimage ausgeliefert.

```sh
node --import tsx scripts/http-check.ts
docker compose exec -T app node --import tsx scripts/benchmark.ts
docker compose exec -T app node --import tsx scripts/scale-check.ts
```

Der HTTP-Test nutzt die lokale Admin-Zugangsdatei. Der Skalierungstest erzeugt und entfernt ausschließlich seine eigene temporäre Testdatenbank. Siehe [Abnahmehinweise](docs/ABNAHME.md).

### Externe Reviews und Anbieterbewertungen

Unter den eigenen Reviews stehen öffentliche Blöcke „Reviews bei Freunden“. Als Admin lassen sich mit „＋ Neu“ weitere Quellen mit Name, HTTPS-Link und optionaler Bewertung samt Skala anlegen. Zum Entfernen den Link leeren. Wortvogel wird ausschließlich manuell gepflegt; für eigene Quellen gibt es ebenfalls keine automatischen Abrufe. Manuelle Angaben bleiben bei Hintergrundläufen erhalten.

Filmdienst wird für aufgerufene Filme im Hintergrund gesucht. Geza speichert nur Link und Sterne, keine fremden Review-Texte. Titel und Produktionsjahr beziehungsweise eine passende IMDb-ID dienen zur Zuordnung. Höchstens drei Kandidaten werden geprüft; unsichere Treffer werden nicht veröffentlicht. Zwischen Abrufen liegen mindestens zehn Sekunden. Treffer bleiben gespeichert, fehlende Treffer werden frühestens nach 30 Tagen, Fehler nach einem Tag erneut geprüft. Geänderte robots.txt-Sperren stoppen die automatische Suche. Die vorhandenen Plex-Aufgaben laufen davon unabhängig.

Detailseiten zeigen TMDB-Durchschnittsbewertungen sowie ausdrücklich als IMDb gekennzeichnete Plex-Bewertungen mit Quellenlink. Diese Werte werden lokal gespeichert; aufgerufene Titel werden frühestens nach sieben Tagen erneut zur Metadatenanreicherung vorgemerkt. TVDBs API-score ist ein Popularitätswert und wird nicht als Sternebewertung ausgegeben. Fehlende Anbieterwerte werden entsprechend bezeichnet. Externe Reviews und Anbieterbewertungen sind im Admin-JSON-Export und Datenbank-Backup enthalten.

Lokaler HTTP-Funktionstest für zusätzliche Quellen: `npx tsx scripts/friend-check.ts` (nutzt den lokalen Adminzugang, legt eine temporäre Testquelle an und entfernt sie wieder).
