# Öffentliche Demo

Demo und Produktion immer separat installieren. Die Demo verweigert den Start auf einer bereits gefüllten Datenbank. Ein Wechsel per Umgebungsvariable ist kein Weg, eine produktive Installation umzuwandeln.

Windows: `./setup.ps1 -Mode demo`. Linux/macOS: `sh setup.sh demo`.
Ohne Argument wird Produktion installiert. Die Demo verwendet `.env.demo`, das Compose-Projekt `geza-demo`, ein eigenes Datenbankvolume und Port **3081**. Zugang: **admin / admin**.

Seit v1.2.1 ergänzt das Setup auch eine bereits vorhandene, unvollständige `.env.demo`, beispielsweise wenn dort zuerst nur `PUBLIC_URL` eingetragen wurde. Bestehende Werte bleiben erhalten. Bei „POSTGRES_PASSWORD is missing a value“ aus v1.2.0 den Code aktualisieren und `sh setup.sh demo` erneut ausführen. Falls die Datenbank früher bereits erfolgreich eingerichtet war und ihr Passwort verloren ging, muss deren ursprüngliches Passwort wiederhergestellt werden; ein neu erzeugtes Passwort ändert keine vorhandene PostgreSQL-Datenbank. Die Konfigurationsdatei oder das Datenbankvolume dafür nicht löschen.

In `.env.demo` die öffentliche Demo-Adresse als `PUBLIC_URL` setzen, beispielsweise `https://demo.example.com`. Anschließend:

```sh
docker compose --env-file .env.demo -p geza-demo up -d --build
```

`DEMO_RESET_MINUTES=60` setzt alle Daten und Anmeldungen stündlich zurück (erlaubt: 5–1440 Minuten). Der Worker prüft alle fünf Sekunden; nach Ausfall wird ein fälliger Reset beim Neustart nachgeholt. Der Reset ist transaktional, mit Datenbanksperre gegen parallele Resets. Alle Besucher teilen denselben Stand. Der Worker muss laufen.

Reviews, Bewertungen, Metadatenbearbeitung und Scrobble-Nachpflege funktionieren. Die drei offenen Scrobbles stehen auf der Data-Seite bereit. Verbindungen zeigen feste Fantasiewerte. Providerabfragen, automatische Module, Webhooks, Wiederherstellung und vollständige Sicherung sind gesperrt. Ein Trakt-Upload liefert die vom Parser erkannten Mengen ohne Datenbankänderung; es ist eine Vorschau ohne Dublettenabgleich, keine Zusage über die Zahl neuer Datensätze. Temporäre Uploaddateien werden anschließend gelöscht. Demo-Uploads sind auf 10 MiB, entpackte JSON-Dateien auf 20 MiB begrenzt.

`demo.geza` enthält eine kleine Auswahl öffentlicher Katalogdaten und passender Film-/Seriencover. Bewertungen, Reviews, Anschauereignisse, Scrobbles und Zugangsdaten sind erfundene Testdaten; persönliche Daten aus der Sicherung werden nicht übernommen. Alle Cover sind in der Datei eingebettet und werden ohne externe Bildanfragen angezeigt. Quellen stehen in `assets/demo/catalog.json`. Sie wird automatisch bei Installation und Reset eingespielt. Erneut erzeugen: `node --import tsx scripts/generate-demo.ts`. Die Datei kann auch in einer leeren normalen Installation über die vorhandene Wiederherstellung importiert werden. Der öffentliche Wiederherstellungsschlüssel besteht aus **64 Nullen**; beim Import ohne Konten kann ein eigenes sicheres Passwort gewählt werden. **Die Datei aktiviert selbst keinen Demomodus.** Das bekannte Demo-Konto niemals als produktives Konto verwenden.

Bei einem Update einer bestehenden Demo werden die neuen Titel und Cover mit dem nächsten planmäßigen Reset übernommen. Das aktualisierte Image muss für App und Worker neu gebaut und gestartet werden; die Datenbank muss dafür nicht gelöscht werden.

## Simulierte Wiedergabe

Nach Anmeldung zeigt **Home** eine simulierte Wiedergabe: ein laufender Film mit fortschreitendem Balken, Restlaufzeit und geschätztem Ende sowie eine pausierte Episode. Beide Karten sind als „Demo · Simuliert“ gekennzeichnet und verlinken auf vorhandene Katalogtitel mit lokalen Covern. Es gibt keine Plex-Verbindung und keine neuen Anschauereignisse. Der Film beginnt nach seiner Laufzeit wieder von vorn; die Episode bleibt pausiert. Gelöschte Titel werden automatisch durch die nächsten passenden Katalogeinträge ersetzt.

## Einbindung

Ein normaler Link auf die Demo funktioniert unabhängig von Browser-Cookie-Regeln. Für ein iframe in `.env.demo` zusätzlich `DEMO_FRAME_ANCESTORS=https://www.example.com` setzen (mehrere exakte HTTPS-Origins durch Leerzeichen trennen). Nur diese Ursprünge dürfen die Demo einbetten:

```html
<iframe src="https://demo.example.com" title="Geza ausprobieren"
        style="width:100%;height:900px;border:0" loading="lazy"></iframe>
<a href="https://demo.example.com" target="_blank" rel="noopener">Demo separat öffnen</a>
```

Für Anmeldung im iframe Demo und Website unter derselben Hauptdomain mit HTTPS betreiben. Bei fremden Domains können Browser Cookies im iframe blockieren; dann den separaten Link verwenden. `PUBLIC_URL` bleibt die Adresse der Demo, nicht die der einbettenden Website. Produktion bleibt gegen Framing gesperrt. Vor einer öffentlichen Freigabe am Reverse-Proxy zusätzlich angemessene Anfrage- und Uploadlimits setzen.

## Integrationstests

Mit Docker und PostgreSQL 16 geprüft: Erstinstallation aus `demo.geza`, Login, Seitenaufrufe, iframe-Header, gesperrte Provider- und Importaktionen, unveränderte Datenbank nach Trakt-Vorschau, Uploadlimit, Origin-Prüfung, Review-Erstellung und Scrobble-Zuordnung. Ein vorgezogener Reset-Termin wurde vom echten Worker verarbeitet: Ausgangsdaten wiederhergestellt, Sitzungen beendet und neue Anmeldung sowie neue Datensätze erfolgreich geprüft.

- `npm run test:demo:safety`: benötigt `DATABASE_URL` und das Recht, eine temporäre Testdatenbank anzulegen. Prüft den Schutz vorhandener Daten, die Wiederholung der Installation ohne vorzeitigen Reset sowie die Sperre beim Wechsel von Demo auf Produktion. Die eigene Testdatenbank wird anschließend entfernt.
- `npm run test:demo:http`: ausschließlich gegen eine separate, wegwerfbare Demo ausführen. Benötigt `GEZA_DEMO_TEST=1`, `DATABASE_URL` dieser Demo und optional `GEZA_TEST_URL` (Standard: `http://127.0.0.1:33081`). App und Worker müssen laufen; für den iframe-Test `DEMO_FRAME_ANCESTORS=https://www.example.com` setzen. Der Test setzt die Demo mehrfach zurück und lässt sie bei Erfolg im Ausgangszustand zurück.
