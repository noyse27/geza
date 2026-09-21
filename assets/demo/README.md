# Demo-Katalog und Cover

Diese kleine Auswahl enthält öffentliche Katalogfelder von acht Filmen und einer Serie sowie passende TMDB-Cover. `catalog.json` dokumentiert die Quellseite und die ursprüngliche Cover-URL für jeden Titel. Die Filmreihe „One Mile“ bleibt als Beispiel für Sammlungen erhalten.

Aus der lokalen Sicherung wurden ausschließlich Titel, Originaltitel, Jahr, Länder, Genres, Regie, Besetzung, Altersfreigabe und Laufzeit ausgewählt. Keine privaten Anschauereignisse, Reviews, Bewertungen, Plex-/Trakt-IDs oder Zugangsdaten wurden übernommen. Staffel und Episoden sind generische Demo-Einträge der Beispielserie.

Die JPG-Dateien werden durch `scripts/generate-demo.ts` in die `posters`-Tabelle von `demo.geza` eingebettet. Staffel und Episoden verwenden das Seriencover. Import, Anzeige und Reset benötigen keine externe Bildanfrage oder API-Schlüssel. Zum erneuten Erzeugen `node --import tsx scripts/generate-demo.ts` ausführen; die private Sicherung wird dafür nicht benötigt.

Cover sind Original-Film-/Seriengrafiken ihrer jeweiligen Rechteinhaber, bereitgestellt über TMDB; sie sind keine selbst erzeugten Illustrationen. Der bestehende TMDB-Quellenhinweis unter „Daten & Quellen“ gilt auch für die Demo.
