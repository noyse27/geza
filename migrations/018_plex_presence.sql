-- Ergebnis des Plex-Abgleichs: in welchen Plex-Bibliotheken ein Titel tatsächlich liegt.
-- plex_checked_at NULL = noch nie abgeglichen; gesetzt und plex_libraries leer = geprüft, in keiner Bibliothek.
ALTER TABLE media ADD COLUMN IF NOT EXISTS plex_libraries text[] NOT NULL DEFAULT '{}';
ALTER TABLE media ADD COLUMN IF NOT EXISTS plex_checked_at timestamptz;

-- Die Trigger der Rumpelkammer (Migration 017) rufen diese Funktionen pro Zeile auf. Postgres schätzt die rekursiven
-- Abfragen als teuer ein und kompiliert sie per JIT; das kostete rund 60 ms je Aufruf (53 Inserts: 3,3 s statt 0,15 s).
ALTER FUNCTION rumpel_root(bigint) SET jit = off;
ALTER FUNCTION rumpel_refresh(bigint[]) SET jit = off;
