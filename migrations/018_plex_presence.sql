-- Ergebnis des Plex-Abgleichs: in welchen Plex-Bibliotheken ein Titel tatsächlich liegt.
-- plex_checked_at NULL = noch nie abgeglichen; gesetzt und plex_libraries leer = geprüft, in keiner Bibliothek.
ALTER TABLE media ADD COLUMN IF NOT EXISTS plex_libraries text[] NOT NULL DEFAULT '{}';
ALTER TABLE media ADD COLUMN IF NOT EXISTS plex_checked_at timestamptz;
