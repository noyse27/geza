# Reviewanbieter

Unter Admin → Reviewanbieter → Neu werden Anbieter global konfiguriert. Erstinstallationen starten ohne Reviewboxen. Migration 009 übernimmt bei vorhandenen Reviewdaten die bisherigen fest eingebauten Anbieter Filmdienst und wortvogel.de sowie eigene Anbieter. Bestehende Links und Bewertungen bleiben unverändert. Die Migration läuft nur einmal; spätere Updates verändern die konfigurierte Anbieterliste nicht. Das Dropdown enthält das mitgelieferte Filmdienst-Plugin und die Möglichkeit, einen eigenen manuellen Anbieter mit Name und Bewertungsskala anzulegen. Pro Plugin ist genau eine Box möglich.

Alle konfigurierten Boxen erscheinen auf Filmseiten. Beim Filmaufruf wird für Filmdienst bei bekanntem Erscheinungsjahr eine Hintergrundsuche vorgemerkt. Links und Bewertungen können angemeldete Administratoren direkt beim Film bearbeiten. Neue Anbieter und deren Löschung werden ausschließlich im Adminbereich verwaltet.

Die globale Konfiguration liegt in review_boxes; Ergebnisse je Film liegen in friend_reviews. Beim Löschen verschwindet ein Anbieter auf allen Filmseiten und seine Hintergrundsuche wird ausgesetzt. Bereits gespeicherte Links bleiben erhalten und werden beim erneuten Konfigurieren wiederverwendet. Alte Ergebnisse aktivieren keine Box automatisch.

Module implementieren src/lib/review-modules/types.ts und werden in src/lib/review-modules/index.ts registriert. Nur Filmdienst ist als Plugin mitgeliefert. Seine komplette HTTP- und Scrape-Logik liegt in filmdienst.ts; Warteschlange und Speicherung liegen in src/lib/friend-reviews.ts.
