# Geza

[![CI](https://github.com/noyse27/geza/actions/workflows/ci.yml/badge.svg)](https://github.com/noyse27/geza/actions/workflows/ci.yml)

Film- und Serienportal mit öffentlichen Bewertungen und Reviews sowie einem privaten Anschautagebuch. Next.js, PostgreSQL und Docker Compose. Die Schrift Syne wird lokal ausgeliefert.

## Sichtbarkeit

**Öffentlich:** Katalog, Suche, Sammlungen, Detailseiten, Zehnerbewertungen und Reviews. Neue und importierte Reviews sind standardmäßig öffentlich; ein Review kann im Editor bewusst als Entwurf gespeichert werden. Die History zeigt ohne Login nur Anschauereignisse mit mindestens einer Bewertung oder einem öffentlichen Review; alle anderen Einträge sind ausgeblendet.

**Nach Login:** Alle Anschauereignisse ohne Filterung, Home, Data, persönliche Statistik, Bearbeitung und Export. Ein erneuter Import behält die bestehende Review-Sichtbarkeit bei.

## Demomodus

Seit **v1.2.0** lässt sich Geza als öffentliche Demo für die eigene Website installieren:

```powershell
# Windows
./setup.ps1 -Mode demo
```

```sh
# Linux / macOS
sh setup.sh demo
```

| | Produktion | Demo |
| --- | --- | --- |
| Installation | `./setup.ps1` / `sh setup.sh` | `./setup.ps1 -Mode demo` / `sh setup.sh demo` |
| Lokale Adresse | `http://localhost:3080` | `http://localhost:3081` |
| Konfiguration | `.env` | `.env.demo` |
| Adminzugang | Bei der Einrichtung selbst festlegen | **admin / admin** |
| Ausgangsdaten | Leer oder eigene Wiederherstellung | Automatisch aus [demo.geza](demo.geza) |
| Trakt-Upload | Import | Vorschau ohne Datenbankänderung |
| Provider und Geza-Wiederherstellung | Verfügbar | Gesperrt; Verbindungen zeigen Fantasieschlüssel |
| Zurücksetzen | Kein automatischer Reset | Standardmäßig alle 60 Minuten |

Die Demo verwendet eine eigene Datenbank und zwölf Medieneinträge mit lokalen Film- und Seriencovern sowie erfundene Bewertungen, Reviews und drei offene Scrobbles zur Nachpflege. Reviews, Bewertungen und Bearbeitung können ausprobiert werden. Alle Besucher teilen denselben Datenbestand; beim Reset verschwinden Änderungen und Anmeldungen. Bitte keine persönlichen Daten eingeben.

Demo und Produktion immer getrennt installieren. Für die Website `PUBLIC_URL` in `.env.demo` setzen; iframe-Einbettung lässt sich mit `DEMO_FRAME_ANCESTORS` auf die eigene Domain beschränken. Details zu Hosting, Reset, Uploadlimits und Tests stehen in [Installation und Website-Einbindung](docs/demo.md).

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
bleiben erhalten. Ohne vorhandenes Admin-Konto zeigt Geza beim ersten Start automatisch die Auswahl
„Neu einrichten“ oder „Geza wiederherstellen“. Danach ist diese Einrichtung gesperrt und `/login` ist die normale Anmeldung.

- Anwendung: <http://localhost:3080>
- Erster Admin und Anmeldung: <http://localhost:3080/login>
- Provider-Zugänge: nach Anmeldung unter **Admin**

Die lokale App ist nur an `127.0.0.1` gebunden. Der Datenbankport ist im normalen Betrieb geschlossen; `compose.dev.yaml` stellt bei Bedarf PostgreSQL auf `127.0.0.1:5439` bereit.

## Sammlungen und Filmreihen

Unter **Sammlungen** führen Kacheln für **Filmreihen, Genres, FSK, Länder, Erscheinungsjahre und GEZA-Bewertungen** zu Unterkacheln mit Filmanzahlen. Ein Klick öffnet die entsprechende Filmliste. Jahr, Altersfreigabe, Länder, Genres, GEZA-Bewertung und Filmreihe sind auch auf der Detailseite direkt anklickbar.

Die Listen zeigen **50 Filme pro Seite**. Mit „Weitere 50“ und „Vorherige 50“ sind alle Treffer erreichbar; Suche und Sortierung gelten für die gesamte ausgewählte Sammlung. Jeder Film erscheint einmal, unabhängig von seinen Anschauereignissen. Filmreihen verwenden standardmäßig ihre gespeicherte Reihenfolge, die Admins weiterhin bearbeiten können.

Ein Film aus einer Sammlung öffnet seine vollständigen Details **im Modal**, einschließlich Reviews und der nach Login verfügbaren Bearbeitung. Beim Schließen bleiben Suche, Sortierung und Scrollposition erhalten. „Vorheriger“ und „Nächster“ wechseln innerhalb der aktuellen Ergebnisseite. Ein Kategorienklick im Modal führt zur neuen Sammlung; Browser-Zurück führt zur vorherigen Liste. „Detailseite öffnen“ sowie ein direkt aufgerufener oder neu geladener Filmlink öffnen die normale Detailseite.

Ergebnisse stammen aus der lokalen Datenbank und warten nicht auf externe Anbieter. Migration **011** ergänzt passende Indizes; vollständige Details werden erst beim Öffnen geladen. Änderungen im Modal aktualisieren anschließend die Liste und deren Anzahl. Technische Hinweise und Testmessungen stehen in [Sammlungen](docs/sammlungen.md).

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

Die private Home-Seite zeigt mit „Now Playing“ aktive Film- und Episodenwiedergaben des verbundenen Plex-Servers. Der Block lädt separat und fragt alle 15 Sekunden `/status/sessions` ab, solange der Browser-Tab sichtbar ist. Er zeigt Titel, Staffel/Episode, Fortschritt, Restlaufzeit und während der Wiedergabe die geschätzte Endzeit in Berlin. Pausierte und puffernde Wiedergaben sind gekennzeichnet; mehrere Sitzungen erscheinen als einzelne Karten. Angezeigt werden alle aktiven Sitzungen des verbundenen Servers, ausschließlich nach Admin-Anmeldung. Ohne Wiedergabe, ohne Plex-Konfiguration oder bei Verbindungsfehlern bleibt der Block ausgeblendet. Eindeutige Katalogtreffer erhalten Detail-Link und vorhandenes Katalog-Cover; Fehlt ein Katalog-Cover, verwendet ausschließlich dieser private Block das Plex-Cover als Fallback (bei Episoden bevorzugt das Serienposter). Das Bild wird über eine admin-geschützte Route ohne Weitergabe des Plex-Tokens geladen und nicht im Katalog gespeichert. Es sind weder neue Webhooks noch eine Migration erforderlich.

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

**Pflicht bei jedem Zugriff über einen Domainnamen** (eigener Reverse-Proxy, Plesk, Caddy, etc.), nicht nur
für Sitemap/Hosting: Login, Setup-Assistent und alle anderen verändernden Anfragen vergleichen den
`Origin`-Header des Browsers mit `PUBLIC_URL` und lehnen bei Abweichung mit „Ungültige Anfrage“ ab. Ohne
Domain funktioniert nur der lokale Zugriff über `localhost`/`127.0.0.1`. Der Wert muss exakt Schema, Host
und – falls verwendet – Port enthalten, wie ihn der Browser tatsächlich aufruft (z. B. `https://geza.example.com`
ohne Port bei Standard-HTTPS). Nach einer Änderung `docker compose up -d`, damit sie wirksam wird.

Ein vorhandener HTTPS-Reverse-Proxy kann auf `127.0.0.1:3080` weiterleiten. Ohne vorhandenen Proxy gibt es eine optionale Caddy-Konfiguration:

```sh
docker compose -f compose.yaml -f compose.hosted.yaml up -d
```

Dafür müssen DNS sowie TCP-Port **80** für die Zertifikatsvalidierung und **777** für HTTPS erreichbar sein. Port 80 darf nicht bereits belegt sein. Das tatsächliche Hosting erfordert noch den Zielserverzugang.

Bei gesetzter `PUBLIC_URL` werden `/sitemap.xml` und auf jeweils 10.000 URLs aufgeteilte `/sitemaps/0`, `/sitemaps/1` usw. aktiviert. Nur öffentliche Detailseiten werden eingetragen; Canonicals behalten den Port. Ohne Domain-Konfiguration liefert die Sitemap 404 und die lokale Vorschau ist `noindex`. Private Seiten und Suchergebnisse werden nicht indexiert.

## Sicherung und Updates

### Vollständiger Serverumzug

1. Alte und neue Installation auf dieselbe Geza-Version aktualisieren. Unter **Admin → Sicherung und Umzug**
   den Wiederherstellungsschlüssel erzeugen und **separat** sichern, anschließend die `.geza`-Datei herunterladen.
2. Geza auf dem Zielserver mit **leerer Datenbank**, neu erzeugter `.env` und passender `PUBLIC_URL` installieren.
   Beim ersten Aufruf **Geza wiederherstellen** wählen, Exportdatei hochladen und Schlüssel prüfen.
3. Admin-Konto, API-Zugänge und automatische Reviewmodule unabhängig auswählen. Die Vorschau zeigt Datum
   und Datensatzanzahlen. Bei falschem oder fehlendem Schlüssel erneut versuchen oder ausdrücklich
   **Ohne Konten und Zugangsdaten fortfahren** wählen.
4. Import starten. Danach mit dem bisherigen Admin-Passwort anmelden oder im selben Browser einen neuen
   Admin anlegen. Bis zum Abschluss bleibt die Installation einschließlich APIs und Worker gesperrt.
5. Unter **Admin** die Verbindungen prüfen und die **neue Webhook-Adresse in Plex eintragen**. Pausierte
   Reviewmodule lassen sich dort wieder aktivieren. Bei Bedarf Metadatenabfragen und Plex-Review-Abgleich neu starten.

Als CLI-Alternative zum Browser-Upload, etwa wenn ein vorgeschalteter Reverse-Proxy (z. B. Plesk) große
Uploads abbricht oder puffert: die `.geza`-Datei nach `data/` legen und direkt gegen die Datenbank einspielen.
Zeigt jeden Schritt (Datei lesen, entschlüsseln, Tabellen prüfen, Einspielen) sofort in der Konsole:

```sh
docker compose exec -T worker node --import tsx scripts/restore.ts /imports/DEINE-DATEI.geza --key DEIN-WIEDERHERSTELLUNGSSCHLUESSEL
```

Ohne Schlüssel stattdessen `--without-key` setzen; danach fehlt das Admin-Konto und wird wie gewohnt mit
`scripts/finish-restore.ts` angelegt. `--no-api-keys` beziehungsweise `--no-modules` lassen sich einzeln
weglassen. Nur für eine leere Zielinstallation, wie beim Browser-Import.

Enthalten sind alle Medienfelder und Zuordnungen, History samt Originalzeiten, Bewertungen, eigene Reviews
einschließlich Entwürfen, externe Reviews, Anbieterbewertungen, gespeicherte Cover, Filmreihen mit Reihenfolge,
Reviewanbieter, Importberichte und Aufgaben einschließlich ungeklärter Scrobbles. Der Export ist ein konsistenter
Datenbankschnappschuss. Neue Ereignisse nach diesem Zeitpunkt gehören nicht zum Export: Für den abschließenden
Umzug die Einspeisung am alten Server pausieren und erst danach exportieren.

Konten (mit Passwort-Hashes) und verwendete Provider-Zugänge, auch aus Umgebungsvariablen, werden mit AES-256-GCM
und einem zufälligen 256-Bit-Wiederherstellungsschlüssel geschützt. Auf dem Zielserver werden Zugangsdaten mit
dem **neuen** Installationsschlüssel gespeichert. Mediendaten sind absichtlich ohne Schlüssel lesbar, damit der
Import ohne Zugangsdaten möglich bleibt; dies umfasst auch private History und Entwürfe. Die Prüfsumme erkennt
Beschädigungen, belegt aber nicht die Vertrauenswürdigkeit einer fremden Datei.

Sitzungen, Loginversuche, technische Ereignisprotokolle, Datenbank-/Sitzungsgeheimnisse und das alte
Webhook-Geheimnis werden nicht übertragen. Offene Hintergrundjobs werden erhalten, aber pausiert; Reviewmodule
starten nur entsprechend der gewählten Option. Eine Wiederherstellung in vorhandene Datenbestände ist ausgeschlossen.
Fehler während der Übernahme rollen sämtliche importierten Tabellen zurück. Dateiformat und Datenbankschema müssen
unterstützt sein; der bisherige JSON-Medienauszug ist **kein** vollständiges Umzugsbackup.

Der Browserimport unterstützt maximal **256 MiB komprimiert / 512 MiB entpackt**. Der Server benötigt ausreichend
Arbeitsspeicher für die Verarbeitung; gegebenenfalls das Uploadlimit und Timeout des Reverse-Proxys anpassen.
Für größere Installationen bleibt die nachfolgende PostgreSQL-Sicherung verfügbar. Exportdateien und Schlüssel
werden nicht auf dem Geza-Server als Dateien abgelegt. Die Einrichtungssitzung bleibt sieben Tage im ursprünglichen
Browser verfügbar; die Admin-Einrichtung direkt nach dem Import abschließen.

Falls diese Browsersitzung verloren geht, lässt sich ausschließlich eine bereits importierte, noch nicht
abgeschlossene Wiederherstellung am Zielserver beenden:
`docker compose exec -it app node --import tsx scripts/finish-restore.ts`.
Das Skript fragt Benutzername und Passwort interaktiv ab (Passwort unsichtbar) und ersetzt niemals einen vorhandenen Admin.

Automatische Umzugstests: `npm run test:unit` und `npm run test:transfer`. Letzteres benötigt `DATABASE_URL`
und das Recht, eine temporäre Testdatenbank anzulegen; vorhandene Anwendungsdaten werden nicht verändert.
Nach `npm run build` prüft `npm run test:transfer:http` zusätzlich echte HTTP-Aufrufe und große Uploads.

### PostgreSQL-Sicherung

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

Mit lokalem Node.js: `npm ci`, `npm run lint`, `npm run test:unit`, `npm run db:migrate`, `npm run test:integration`, `npm run test:collections`, `npm run build`. Datenbankbefehle benötigen `DATABASE_URL` für eine Testdatenbank. Der Sammlungstest prüft unter anderem exakte Filter, Duplikatfreiheit, Paging mit mehr als 50 Filmen und die Reihenfolge vorhandener Filmreihen.

Die GitHub-CI folgt `adolar-songster` und `bloeki`: Typprüfung, Tests, Build, Trivy, Gitleaks, CodeQL und Image-Scan. Dependabot prüft npm, Docker und GitHub Actions montags in Europe/Berlin mit gruppierten Minor-/Patch-Updates. Entwicklungscompiler und Paketmanager werden nicht im Laufzeitimage ausgeliefert.

```sh
node --import tsx scripts/http-check.ts
docker compose exec -T app node --import tsx scripts/benchmark.ts
docker compose exec -T app node --import tsx scripts/scale-check.ts
```

Der HTTP-Test nutzt die lokale Admin-Zugangsdatei. Der Skalierungstest erzeugt und entfernt ausschließlich seine eigene temporäre Testdatenbank. Siehe [Abnahmehinweise](docs/ABNAHME.md).

### Externe Reviews und Anbieterbewertungen

Unter den eigenen Reviews stehen öffentliche Blöcke „Reviews bei Freunden“. Als Admin lassen sich mit „＋ Neu“ weitere Quellen mit Name, HTTPS-Link und optionaler Bewertung samt Skala anlegen. Zum Entfernen den Link leeren. Für eigene Quellen gibt es keine automatischen Abrufe; manuelle Angaben bleiben bei Hintergrundläufen erhalten.

Filmdienst und wortvogel.de werden für aufgerufene Filme im Hintergrund gesucht. Geza speichert nur Link und Sterne, keine fremden Review-Texte; wortvogel.de liefert keine Sternebewertung, nur den Link. Titel und Produktionsjahr beziehungsweise eine passende IMDb-ID dienen zur Zuordnung. Bei wortvogel.de wird nach `<Filmtitel> "kino kritik"` gesucht und nur ein Artikel übernommen, dessen Titel „Kino Kritik: <Filmtitel>“ eindeutig zu Titel und Produktionsjahr passt. Höchstens drei Kandidaten werden geprüft; unsichere oder mehrdeutige Treffer werden nicht veröffentlicht. Zwischen Abrufen liegen je Anbieter mindestens zehn Sekunden. Treffer bleiben gespeichert, fehlende Treffer werden frühestens nach 30 Tagen, Fehler nach einem Tag erneut geprüft. Geänderte robots.txt-Sperren stoppen die automatische Suche. Die vorhandenen Plex-Aufgaben laufen davon unabhängig.

Detailseiten zeigen TMDB-Durchschnittsbewertungen sowie ausdrücklich als IMDb gekennzeichnete Plex-Bewertungen mit Quellenlink. Diese Werte werden lokal gespeichert; aufgerufene Titel werden frühestens nach sieben Tagen erneut zur Metadatenanreicherung vorgemerkt. TVDBs API-score ist ein Popularitätswert und wird nicht als Sternebewertung ausgegeben. Fehlende Anbieterwerte werden entsprechend bezeichnet. Externe Reviews und Anbieterbewertungen sind im Admin-JSON-Export und Datenbank-Backup enthalten.

## Changelog

### v1.2.1

- Setup ergänzt fehlende oder leere Pflichtwerte in vorhandenen `.env`-/`.env.demo`-Dateien und erhält vorhandene Einstellungen. Dadurch funktioniert die Demo-Installation auch nach dem vorherigen Eintragen von `PUBLIC_URL`.
- Setup-Meldungen nennen die tatsächlich verwendete Datei; widersprüchliche Modusangaben werden vor Änderungen abgewiesen. Die Demo zeigt keine zusätzliche Produktionsadresse mehr an.

### v1.2.0

- Separat installierbarer Demomodus mit `admin / admin`, automatischer Einspielung von `demo.geza`, erfundenen Beispieldaten und offenen Scrobbles.
- Konfigurierbarer automatischer Reset einschließlich Sitzungen; Schutz vor dem Überschreiben vorhandener Daten und versehentlichem Start einer Demo-Datenbank als Produktion.
- Trakt-Vorschau ohne Datenbankänderung mit Uploadlimits; Geza-Wiederherstellung, Providerzugriffe und Änderungen an Zugangsdaten in der Demo gesperrt.
- Gezielte iframe-Freigabe für die eigene Website, sichtbarer Demohinweis und Ausschluss der Demo von Suchmaschinen.
- Docker-/HTTP-Integrationstests für Importvorschau, Bearbeitung, Scrobble-Nachpflege und den tatsächlichen Worker-Reset; Schutz vorhandener Daten zusätzlich in der CI geprüft.
- Worker-Image wird bei einer frischen Compose-Installation mitgebaut; `PUBLIC_URL` als Voraussetzung für Zugriffe über einen Domainnamen dokumentiert.
- Filmdienst-Titelsuche und Abgleich des Produktionsjahrs korrigiert.

- CLI-Alternative `scripts/restore.ts` zum Browser-Import bei der Wiederherstellung, mit Fortschrittsausgaben in der Konsole; nützlich wenn ein vorgeschalteter Reverse-Proxy große Uploads abbricht.
- Vollständiger verschlüsselter Konten-/Zugangsdatenexport mit allen Nutzdaten und Erststart-Assistent für Serverumzüge; optionale Konten-, API- und Reviewmodulübernahme, atomare Wiederherstellung und neue Plex-Webhook-Adresse.

- Now Playing verwendet bei fehlendem Katalog-Cover das Plex-Poster über eine geschützte Bildroute. Diese Ausnahme betrifft nur den privaten Wiedergabeblock; Plex-Cover werden weiterhin nicht importiert.

- Now Playing ergänzt fehlende externe IDs aus den Plex-Bibliotheksmetadaten, damit vorhandene Katalog-Cover auch bei unvollständigen Sitzungsdaten gefunden werden. Ein fehlgeschlagener zusätzlicher Abruf blendet die Wiedergabe nicht aus; mehrdeutige Treffer bleiben unzugeordnet.

- Offene Scrobbles können nach dem Speichern im selben Dialog weiter zugeordnet werden; die History wird erst beim Schließen aktualisiert.
- Serientreffer bei der Scrobble-Zuordnung zeigen die Anzahl ihrer bereits zugeordneten Katalogepisoden.
- Die private Home-Seite zeigt aktive Plex-Wiedergaben mit Katalog-Cover, Fortschritt, Restlaufzeit, geschätzter Endzeit und Pausenstatus; automatische Aktualisierung alle 15 Sekunden.

### v1.1.1 (current)
- Migrationen laufen nicht mehr in den 8s-Statement-Timeout der App; verhinderte auf größeren Produktivbeständen den Abschluss von Migration 013

### v1.1.0

- Neuer Bereich Sammlungen mit Filmreihen, Genres, FSK, Ländern, Erscheinungsjahren und GEZA-Bewertungen
- Klickbare Detailangaben führen direkt zu passenden Filmlisten; Suche, Sortierung und Paging mit 50 Filmen pro Seite
- Vollständige Filmdetails als Modal innerhalb von Sammlungen, mit erhaltener Scrollposition, Vorheriger/Nächster und aktualisierten Listen nach Änderungen
- Filmreihen mit Zuordnung und bearbeitbarer Reihenfolge; bestehende Reihen werden in Sammlungen übernommen
- Filmicon als Favicon und im Footer
- Datenbankmigration 011 für schnelle Sammlungsabfragen und neue Regressionstests in der CI
- Neue Sammlungen für Regie und Besetzung, direkt aus den Filmdetails klickbar
- FSK-Angaben werden beim Anbieterabgleich und bei manueller Bearbeitung einheitlich auf „FSK <Wert>" normalisiert; Filme ohne Altersangabe erscheinen in einer eigenen Sammlung „Keine Altersangabe" statt zu fehlen

### v1.0.2
- Titel-Links in Reviews grün hervorgehoben (Akzentfarbe mit Pfeil), analog zu den anderen Geza-Links

### v1.0.1
- Footer zeigt Copyright-Hinweis mit Link auf PolzeSoft; Kontaktblock mit Mailadresse unter „Daten & Quellen"
- Interne Titel-Links in Reviews zeigen statt der nackten URL den Filmtitel als Link

### v1.0
- Öffentlicher Katalog mit Suche, Detailseiten, Zehnerbewertungen und Reviews; privates Anschautagebuch nach Login
- Trakt-Import per ZIP-Upload im Admin oder CLI für History, Bewertungen, Kommentare und Sammlung
- Plex-Webhook-Sync für Anschauereignisse sowie persönliche Reviews via community.plex.tv, mit Schutz vor doppelten Reviews
- Zuordnungskorrektur für Episoden/Staffeln und Löschen von Mediendatensätzen im Admin
- Externe Reviews und Anbieterbewertungen über pluggable Provider-Module (TMDB, TVDB, Filmdienst, Wortvogel, eigene Quellen)
- History-Filter im Adminmodus: nach Typ, Monat und (neu) „Nur mit Review"
- Docker-Compose-Setup mit Sicherung/Wiederherstellung, Erstadmin-Einrichtung und CI mit Typprüfung, Tests, Trivy, Gitleaks, CodeQL und Image-Scan

Lokaler HTTP-Funktionstest für zusätzliche Quellen: `npx tsx scripts/friend-check.ts` (nutzt den lokalen Adminzugang, legt eine temporäre Testquelle an und entfernt sie wieder).
