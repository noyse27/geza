# Offene Anforderungen: Verarbeitung nachvollziehen und Probleme lösen

Festgehalten am 08.10.2026 aus Nutzerfeedback. Implementiert auf dem Feature-Branch
`codex/admin-job-results`; noch nicht auf der laufenden Installation bereitgestellt.

Umgesetzt: getrennte Laufhistorie, Liveanzeige mit Zeiten und Fortschritt, Fehleralter,
anklickbare Ergebnislisten, Tageszuwächse für Reviews/Metadaten, Konfliktvergleich mit
ID-Korrektur, erneutes Prüfen und aktuelle Listen ungeklärter Sichtungen/Plex-ID-Gruppen.
Die bestehende Bucketlisten-Darstellung bleibt erhalten. Historische Ergebnislisten
können erst ab Migration 028 erfasst werden. „Dick und Jane“ wurde mit isolierten
Testdaten geprüft; der tatsächliche Titel auf der laufenden Installation wurde nicht geändert.

## Ziel

Die Administration soll verständlich zeigen, was wann mit welchen Titeln passiert ist,
warum ein Ergebnis entstanden ist und wie ein Problem geprüft und korrigiert werden kann.
Zähler, Fehlermeldungen und rohe JSON-Daten allein reichen dafür nicht aus.

## Verarbeitung und Jobs

- Datum und Uhrzeit sowie den Bezugszeitraum der angezeigten Informationen nennen.
- Wartend, geplant und tatsächlich laufend verständlich unterscheiden. Anzeigen:
  eingereiht seit, geplanter Start, tatsächlich gestartet, letzter Fortschritt und
  abgeschlossen/fehlgeschlagen, soweit erfasst. Ein wartender Scan ist kein laufender Scan.
- Reviews und Metadaten mit Zuwächsen anzeigen: Was kam im jeweiligen Lauf bzw.
  ausgewiesenen Zeitraum neu hinzu, was wurde aktualisiert, was blieb unverändert?
  Erfolgreiche Jobs nicht mit neu hinzugekommenen Reviews oder Titeln gleichsetzen.
- Jobs bzw. zusammengefasste Jobgruppen anklickbar machen. Ergebnislisten mit
  betroffenen Titeln, Links, Änderungen, ausgelassenen Fällen und Fehlern anbieten.
- Fehler verständlich erklären und zur betroffenen Stelle sowie zu einer passenden
  Korrekturmöglichkeit führen. Erneutes Ausführen nach einer Korrektur ermöglichen,
  wo sinnvoll. Historische Fehler von aktuell offenen Problemen unterscheiden.

## Ereignisprotokoll und Webhooks

- In verständlicher Sprache zeigen: empfangenes Ereignis, betroffener Titel,
  Zuordnung, Verarbeitungsergebnis und gegebenenfalls konkrete Fehlerursache.
- Bei widersprüchlichen Provider-IDs die Kandidaten mit Titel, Jahr und IDs
  gegenüberstellen und den konkreten Widerspruch sichtbar machen.
- Titel, Job und zugehörige Ereignisse miteinander verlinken.
- Technische Rohdaten ergänzend aufklappbar lassen; sie ersetzen keine Erklärung.
- Konkreter Prüffall aus dem Screenshot: „Saint Clare – Engel der Vergeltung“,
  fehlgeschlagene Zuordnung im Plex-Scan, Job 235666, 08.10.2026 um 16:30:56.
  Ursache anhand tatsächlicher Daten prüfen, nicht aus dem Ausschnitt unterstellen.

## Importfälle abarbeiten

- Aktuelle Liste ungeklärter Anschauzeitpunkte mit Titelverweisen und Bearbeitung.
- Aktuelle Liste mehrfach zugeordneter Plex-IDs mit den betroffenen Datensätzen
  und einer sicheren Korrekturmöglichkeit; keine automatische Zusammenführung
  allein wegen einer gemeinsamen Plex-ID.
- Historischen Importbericht ausdrücklich als solchen kennzeichnen. Seine Zahlen
  sind keine aktuellen offenen Aufgaben und sinken nach Korrekturen nicht automatisch.
- Ausgangsbeispiel: Importbericht mit 6 ungeklärten Zeitpunkten und 23 mehrfach
  zugeordneten Plex-ID-Gruppen. Diese Werte sind keine verifizierten aktuellen Bestände.

## Bucketliste und Zuordnungsgründe

- Präzisierung des Nutzers: Die bestehende Bucketlisten-Darstellung reicht aus.
  Keine zusätzliche Erklärung auf jeder Titelseite oder eigene Bucketlisten-Diagnose.
- Im Ergebnis des abgeschlossenen Bibliotheksscans neue Einträge, betroffene Titel
  und ihr Ziel anzeigen; nicht verarbeitete Titel mit Grund und Korrekturmöglichkeit
  aufführen. Auch noch nicht in Geza angelegte Plex-Titel müssen dort auffindbar sein.
- Konkreter Prüffall: „Dick und Jane“ (2005) ist laut Screenshot in der Plex-Bibliothek
  „#NEU“ vorhanden und soll laut Nutzer auf der Geza-Bucketliste stehen, fehlt dort
  aber im gezeigten Ausschnitt. Prüfen, ob importiert, anders benannt, anders
  einsortiert, übersprungen oder wegen eines Scanfehlers noch nicht abgeglichen.
  Die tatsächliche Ursache ist bislang ungeklärt.

## Abnahmekriterium

Von einer Meldung oder Zahl aus lässt sich ohne Lesen von JSON feststellen:
Wann war das? Welche Titel betrifft es? Was hat sich geändert? Warum ist ein Fall
offen oder ein Titel anders einsortiert? Wo kann ich ihn kontrollieren und korrigieren?

Referenzbilder: 16_53_31.png, 16_58_51.png und 17_04_39.png im lokalen
Screenshot-Verzeichnis C:/Users/noyse/OneDrive/Bilder/_screens/2026/10/08/.

## Umsetzungsplan

### 1. Verlässliche Laufhistorie als Grundlage

Bestand: jobs speichert status, attempts, available_at, updated_at und error.
Der Worker aktualisiert updated_at alle 30 Sekunden als Lebenszeichen. Es gibt
keine getrennten Start-/Endzeiten oder allgemeine Fortschrittsmessung. Wiederkehrende
Scans verwenden dieselbe Jobzeile erneut; pending kann auch einen zukünftigen Termin
bezeichnen. Die Adminseite fasst derzeit nach kind/status zusammen und zeigt bei
Fehlern das bereits abgefragte updated_at nicht an.

- Separate Ausführungen je Job/Versuch speichern, damit Wiederholungen und tägliche
  Scans frühere Ergebnisse nicht überschreiben. Job bleibt die Warteschlangenaufgabe.
- Einreihung, geplante Ausführung, Start, Ende, Lebenszeichen, letzten fachlichen
  Fortschritt, Phase und gegebenenfalls erledigte/Gesamtanzahl getrennt erfassen.
- Ergebniszahlen und betroffene Titel je Ausführung speichern; technische Logs
  ergänzen diese Daten, ihre bisherige Löschung nach 14 Tagen darf die aktuelle
  Problemliste nicht unbemerkt leeren. Aufbewahrung und Pagination begrenzen Datenmengen.
- Fortschrittsmeldungen gedrosselt und außerhalb der langen Scantransaktion schreiben,
  damit sie während des Scans sichtbar sind. Ergebnisse erst nach erfolgreichem Commit
  als übernommen kennzeichnen; Rollback darf keine angeblichen Änderungen hinterlassen.
- Wiederholungen nicht doppelt als Zuwachs zählen. Abgebrochene Ausführungen und
  Wiederaufnahme eindeutig kennzeichnen; Updates der konkreten Ausführung zuordnen.
- Alte Daten nicht mit erfundenen Startzeiten oder Ergebnissen auffüllen. Historische
  Angaben als eingeschränkt verfügbar kennzeichnen.

### 2. Verständliche Liveanzeige in der Verarbeitung

- Aktive/geplante Arbeit zuerst, danach letzte Ergebnisse und offene Fehler.
- Zustände: geplant für Datum/Uhrzeit; wartet seit Datum/Uhrzeit; läuft seit;
  erneuter Versuch geplant; abgeschlossen; fehlgeschlagen.
- Kleine animierte Aktivitätsleiste nur für laufende Arbeit mit frischem Lebenszeichen.
  Bei bekannter Gesamtzahl stattdessen echten Fortschritt mit Zähler zeigen.
  Bei mehreren Scanphasen Phase benennen, keine erfundene Gesamtprozentzahl.
- Lebenszeichen bedeutet Erreichbarkeit des Workers, nicht fachlichen Fortschritt.
  Deshalb zusätzlich „letzter Fortschritt vor …“; bei ausbleibendem Lebenszeichen
  „Status prüfen: seit … keine Rückmeldung“, ohne vorschnell einen Fehler zu behaupten.
- Neben roten Fehlern „vor 1 Minute“ / „vor 3 Tagen“; exakter Zeitpunkt in Europe/Berlin
  zugänglich anzeigen. Fehlerzeitpunkt nicht vom nächsten geplanten Start ableiten.
- Während sichtbarer aktiver Arbeit Status etwa alle 5 Sekunden abrufen; bei inaktivem
  Browser pausieren und ohne aktive Arbeit seltener aktualisieren. Letzte erfolgreiche
  Aktualisierung und Abrufprobleme sichtbar machen. Reduzierte Bewegung respektieren.

### 3. Anklickbare Ergebnisse und tatsächliche Zuwächse

- Jede Jobgruppe führt zu gefilterten Ausführungen, jede Ausführung zu ihrer Ergebnisliste.
- Listen nach neu, aktualisiert, unverändert, übersprungen und fehlgeschlagen filtern;
  Titel verlinken und verständlichen Ergebnisgrund nennen.
- Review-/Metadatenänderungen tatsächlich beim Speichern feststellen. Erfolgreich
  geprüft ohne Änderung zählt nicht als neu. Entfernte Reviews separat ausweisen.
- Standard: letzter abgeschlossener Lauf bzw. klar ausgewiesener Zeitraum „heute“;
  bisherige Gesamtzahlen ergänzend. Laufende Zähler als vorläufig kennzeichnen.
- Beispiel: „Reviews heute: 8 neu · 12 aktualisiert · 240 unverändert · 2 fehlgeschlagen“.

### 4. Fehler erklären und gezielt beheben

- Job, Webhook, betroffene Titel und Folgeereignisse durchgehend verknüpfen.
- Bekannte Fehlerarten in Ursache, Auswirkung und nächsten Schritt übersetzen.
  Unbekannte Fehler ehrlich benennen; technische Details bleiben verfügbar.
- Provider-Konflikte vergleichbar darstellen und bestehende Titel-/ID-Bearbeitung
  verlinken. Wiederholen erst als eigene bewusste Aktion, keine automatischen Merges.
- Importfälle aus dem aktuellen Datenbestand abfragen, historische Berichte getrennt
  lassen. Ungeklärte Sichtungen direkt bearbeiten; Konflikte nach Korrektur neu prüfen.

### 5. Bibliotheksscan-Ergebnisse vervollständigen (Teil von 3–4)

- Bestehende Bucketlisten-Darstellung beibehalten; keine zusätzliche Diagnoseansicht
  pro Titel. Die Erklärung gehört in die anklickbare Ergebnisliste des Scans.
- Nach Abschluss beispielsweise „Bibliotheksscan abgeschlossen · 34 neue Einträge“
  anzeigen (Beispielzahl, tatsächliche Zahl aus übernommenen Änderungen).
- Darunter bzw. per Klick die Titel mit ihrem tatsächlichen Ziel, etwa Bucketliste,
  anzeigen. Bereits vorhandene/aktualisierte Titel getrennt von neuen ausweisen.
- Nicht verarbeitete oder übersprungene Titel einschließlich noch nicht in Geza
  angelegter Plex-Titel mit verständlichem Grund aufführen. Passende manuelle
  Korrektur bzw. Zuordnung direkt ermöglichen oder verlinken und danach erneut prüfen.
- Laufende oder fehlgeschlagene Scans klar kennzeichnen; vorläufige Ergebnisse nicht
  als abgeschlossene Übernahme darstellen.
- „Dick und Jane“ (2005) nach abgeschlossenem Scan erneut prüfen. Ein laufender oder
  noch ausstehender Scan ist eine plausible, bislang unbestätigte Erklärung für das
  Fehlen. Keine Bucketlisten-Korrektur ohne Prüfung der tatsächlichen Zuordnung.

### Prüfung und Lieferreihenfolge

Zuerst 1–2 liefern: verlässliche Zeiten, Zustände, Laufleiste und Fehleralter.
Danach 3–4 einschließlich der in 5 konkretisierten Scan-Ergebnisliste: Ergebnislisten,
Zuwächse und bearbeitbare Probleme, mit „Dick und Jane“ als Prüffall.
Kein Teil darf Zähler oder Fortschritt nur simulieren.

Gezielt prüfen: zukünftiger Scan gegenüber wartendem/laufendem Scan; Retry und
Worker-Neustart; ausbleibendes Lebenszeichen; Rollback nach Teilverarbeitung;
wiederholter unveränderter Reviewabruf; fehlende Altdaten; Datumswechsel/Sommerzeit;
Adminzugriff auf Listen und Korrekturaktionen. Oberfläche bei laufender Arbeit,
Fehlern, leeren Listen und reduzierter Bewegung visuell kontrollieren.

Abnahme: Ein laufender Scan ist ohne Neuladen erkennbar, ein Fehler zeigt sein Alter,
jede Ergebniszahl führt zu nachvollziehbaren Fällen. Das Ergebnis eines abgeschlossenen
Scans zeigt neue Titel und ihr Ziel sowie nicht verarbeitete Fälle mit Grund und einer
passenden Korrekturmöglichkeit.

## Verifikation am 08.10.2026

- Typprüfung und Produktionsbuild erfolgreich.
- 44 bestehende Unit-Tests erfolgreich.
- `test:jobs`: Migrationen, atomare Scanergebnisse/Rollback, Wiederholung ohne falschen
  Reviewzuwachs, erhaltene Laufhistorie, veraltete Lebenszeichen und echter Worker geprüft.
- `test:classification`, `test:transfer`, `test:demo:safety` erfolgreich.
- Browserprüfung mit isolierten Testdaten: Ergebnisliste samt Ziel, Konfliktvergleich,
  Speichern einer ID-Korrektur und Fortschrittsanzeige.
- HTTP-Prüfung der Adminansichten, Ablehnung ohne Anmeldung/falscher Herkunft,
  Ablehnung veralteter ID-Korrekturen und Einplanung eines neuen Scans erfolgreich.
- Keine Änderungen an der laufenden Geza-/Plex-Installation. Neue Detailhistorie
  entsteht erst nach Bereitstellung von Migration 028 und des aktualisierten Workers.
