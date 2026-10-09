# Geza bedienen – Anleitung für v1.6.0

Die [README](../README.md) erklärt Installation, Sicherung und Verbindungen. Diese Anleitung führt durch die Bedienung und die Kontrolle des Plex-Abgleichs. Die beschriebenen Adminfunktionen stehen nach der Anmeldung zur Verfügung.

## Katalog, Tagebuch und Reviews

Über die Suche einen Film oder eine Serie öffnen. Auf der Detailseite lassen sich Bewertungen, Reviews und Anschauereignisse verwalten. Öffentliche Besucher sehen veröffentlichte Inhalte; das vollständige Anschautagebuch bleibt privat.

- [Reviews schreiben und Filme oder Personen verlinken](reviews.md)
- [Sammlungen und Filmreihen](sammlungen.md)
- [Ungeklärte Anschauereignisse nachpflegen](scrobbles.md)
- [Externe Reviewquellen](review-modules.md)
- [Demo ausprobieren und betreiben](demo.md)

## Läuft der Bibliotheks-Scan noch?

Unter **Admin → Verarbeitung** den Bibliotheks-Scan öffnen. **Geplant** bezeichnet einen zukünftigen Termin, **Wartet** einen eingeplanten Auftrag, der noch nicht läuft. Erst **Läuft** bedeutet, dass ein Worker den Auftrag übernommen hat.

Startzeit und letzte Aktivität helfen bei der Einschätzung. Ein Laufbalken zeigt Aktivität; eine Zahl wie „420 / 629“ erscheint nur, wenn die Gesamtmenge bekannt ist. Ohne Gesamtmenge ist der Balken keine Prozentangabe. Bei ausbleibender Rückmeldung erscheint ein entsprechender Hinweis: Ein alter Status allein belegt nicht, dass noch gearbeitet wird.

Die Übersicht aktualisiert sich automatisch. Datum und Uhrzeit werden in Berliner Zeit angezeigt, zusätzlich gibt es relative Angaben wie „vor 3 Minuten“.

## Ergebnisse eines Auftrags kontrollieren

1. **Alle Aufträge und Ergebnisse** öffnen oder einen Lauf direkt anklicken.
2. Den passenden Bibliotheks-Scan anhand der Startzeit auswählen. Für einen vollständigen Abgleich seinen Abschluss abwarten.
3. Die Ergebniszahlen anklicken, etwa **Neu**, **Aktualisiert**, **Übersprungen** oder **Nicht verarbeitet**.
4. In der Titelliste Ziel und Begründung lesen und bei Bedarf die verlinkte Detailseite öffnen.

**Ergebnisse heute** zählt Ergebnisse abgeschlossener Ausführungen seit Mitternacht in Berlin. Bei Reviews und Metadaten wird der Zustand vor und nach dem Abruf verglichen. Ein erfolgreicher Abruf kann daher **Unverändert** ergeben. Mehrere Änderungen desselben Titels in verschiedenen Läufen zählen mehrfach; die Zahlen sind keine Anzahl einzigartiger Filme.

Für Läufe vor dem Update existieren keine nachträglich berechneten Einzelergebnisse. Alte Gesamtzähler und historische Fehler sind entsprechend gekennzeichnet. Die Diagnosehistorie wird grundsätzlich 90 Tage aufbewahrt; relevante ungelöste Fehler bleiben erhalten. Das Ereignisprotokoll bewahrt Einträge 14 Tage auf.

## Ein Film fehlt in der Bucketliste

Beispiel: „Dick und Jane“ steht in Plex, fehlt aber in Geza auf der Bucketliste. Zuerst prüfen, ob der aktuelle Scan bereits abgeschlossen ist. Ein noch wartender oder laufender Scan ist noch kein Nachweis für eine falsche Einordnung.

Im abgeschlossenen Lauf nach dem Titel suchen, gegebenenfalls über die Ergebnisfilter und weitere Listenseiten. Das Ergebnis nennt das Ziel und den Grund der Einordnung. Bei **Übersprungen** oder **Nicht verarbeitet** die Begründung prüfen. Ein ID-Konflikt braucht eine Korrektur; ein bewusst ausgeschlossener Titel kann über die manuelle Aufnahme in die Bucketliste wieder aufgenommen werden. Fehlende Einzelergebnisse aus der Zeit vor diesem Update erfordern einen neuen Scan.

## Widersprüchliche Anbieter-IDs korrigieren

1. Den fehlgeschlagenen Lauf öffnen. Die Konfliktansicht vergleicht die eingegangenen IDs mit den möglichen Geza-Titeln.
2. Titel, Jahr und Anbieter-IDs prüfen. Die Konflikttabelle zeigt den damaligen Stand; die Korrekturformulare laden die aktuellen IDs.
3. Nur die belegbar falschen IDs korrigieren oder entfernen und speichern. Eine ID nicht allein deshalb löschen, weil sie einen Konflikt verursacht.
4. **Nach Korrektur erneut prüfen** wählen und den neuen Lauf kontrollieren. Speichern allein wiederholt den Auftrag noch nicht.

Wurde der Datensatz inzwischen geändert, die Seite neu laden und die aktuellen Werte erneut prüfen. Zusammengehörige IDs müssen denselben Film bzw. dieselbe Serie beschreiben; ein automatisches Zusammenführen widersprüchlicher Titel erfolgt nicht.

Unter **Offene Importfälle prüfen** sind außerdem ungeklärte Anschauzeitpunkte und mehrfach zugeordnete Plex-IDs erreichbar. Der alte Importbericht bleibt eine historische Zusammenfassung und wird durch spätere Korrekturen nicht neu geschrieben.

## Webhooks und Fehler verstehen

**Admin → Ereignisprotokoll** zeigt Zeitpunkt, Alter, Bereich und eine verständliche Beschreibung. Verlinkte Titel und Ausführungen führen zum betroffenen Datensatz bzw. zum Ergebnis. Die technischen Rohdaten unter **Details** helfen bei einer weitergehenden Diagnose; für die Korrektur zuerst die Erklärung und die Verknüpfungen nutzen. Ein alter Fehler kann zu einem inzwischen erfolgreich wiederholten Lauf gehören.

## Fehlende Gesehen-Markierungen in Plex wiederherstellen

Unter **Admin → Verbindungen** die Option **Gesehen-Status aus Geza in Plex wiederherstellen** aktivieren und **Verbindungen speichern** wählen. Sie ist standardmäßig ausgeschaltet. Plex-URL, Token, Server-UUID und Account-ID müssen eingerichtet sein; der Token muss zum gewünschten Plex-Benutzer gehören.

Bei neuen Bibliothekseinträgen und beim Scan werden Filme und einzelne Episoden mit einem Anschauereignis in Geza in Plex als gesehen markiert, sofern die Zuordnung eindeutig ist. Eine Scan-Vorschau zeigt die geplante Anzahl, schreibt aber noch nichts nach Plex. Erst die Übernahme erzeugt Aufträge, die der Worker verarbeitet. Deren Status lässt sich unter **Gesehen-Status** kontrollieren.

Dies stellt die Gesehen-Markierung wieder her, nicht die ursprünglichen Anschauzeitpunkte in Plex. Gezas Anschauhistorie bleibt erhalten. Die Funktion entfernt keine Gesehen-Markierungen und bleibt im Demomodus gesperrt. Bei einem Serverwechsel oder geänderten IDs erneut scannen, statt alte Aufträge ungeprüft zu wiederholen.

## Länder und Genres ordnen

Im Adminbereich **Länder und Genres** öffnen. Schreibweisen können einem gemeinsamen Ziel zugeordnet und Zuordnungen später wieder gelöst werden. Dafür bewahrt Geza die Originalwerte auf. Nach dem Update kann einmalig eine Quellenprüfung laufen; fehlende Originale werden als offen angezeigt. Erst deren Klärung ermöglicht betroffene Änderungen. [Details zur Wiederherstellung und reversiblen Zuordnung](reversible-facets.md).

## Aktualisieren und sichern

Vor dem Update eine Sicherung erstellen und die [Updateanleitung](../README.md#sicherung-und-updates) befolgen. App und Worker gemeinsam aktualisieren. Migrationen laufen beim Start automatisch. [Releasehinweise zu v1.6.0](releases/v1.6.0.md) beschreiben den Umfang und die Datenbankänderungen.
