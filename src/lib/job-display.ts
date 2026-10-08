export const jobNames: Record<string, string> = {
  plex: 'Plex-Ereignisse',
  enrich: 'Metadaten',
  'plex-review-sync': 'Plex-Reviews',
  'plex-scan': 'Bibliotheks-Scan',
  'plex-presence': 'Plex-Abgleich',
  'plex-watch-restore': 'Gesehen-Status',
  'series-catalog': 'Serienkatalog',
  'facet-recovery': 'Länder und Genres',
};
export const outcomeNames: Record<string, string> = {
  new: 'Neu',
  updated: 'Aktualisiert',
  unchanged: 'Unverändert',
  skipped: 'Übersprungen',
  failed: 'Nicht verarbeitet',
  removed: 'Entfernt',
  checked: 'Verarbeitet',
};
export function relativeTime(value: string | Date, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat('de', { numeric: 'always' });
  if (Math.abs(seconds) < 60) return format.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}
export function exactTime(value: string | Date) {
  return new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
}
export function jobState(
  job: { status?: string; available_at?: string | Date; heartbeat_at?: string | Date },
  now = Date.now(),
) {
  if (job.status === 'pending')
    return job.available_at && new Date(job.available_at).getTime() > now ? 'Geplant' : 'Wartet';
  if (job.status === 'running')
    return !job.heartbeat_at || now - new Date(job.heartbeat_at).getTime() > 90000
      ? 'Keine aktuelle Rückmeldung'
      : 'Läuft';
  return (
    (
      { done: 'Abgeschlossen', failed: 'Fehlgeschlagen', interrupted: 'Unterbrochen' } as Record<
        string,
        string
      >
    )[job.status || ''] ||
    job.status ||
    'Unbekannt'
  );
}
export function errorHelp(error: string) {
  if (/Provider.ID|Medienzuordnung|widersprüchlich/i.test(error))
    return 'Die Anbieter-IDs passen nicht eindeutig zusammen. Vergleiche die Kandidaten und korrigiere die falsche ID unter „Details bearbeiten“. Danach erneut prüfen.';
  if (/401|403/.test(error))
    return 'Der Anbieter hat den Zugriff abgelehnt. Prüfe die Verbindung und Zugangsdaten in den Admin-Einstellungen.';
  if (/429/.test(error))
    return 'Der Anbieter begrenzt die Abfragen. Warte etwas und starte anschließend einen neuen Versuch.';
  if (/404|nicht gefunden/.test(error))
    return 'Unter dieser ID wurde kein Eintrag gefunden. Prüfe die Anbieter-ID des Titels.';
  if (/Episode|Staffel|TMDB.Zuordnung|Episodenkatalog/.test(error))
    return 'Prüfe beim betroffenen Titel die TMDB-ID und bei Folgen die Serien-, Staffel- und Episodenzuordnung.';
  if (/timeout|fetch|Verbindung/i.test(error))
    return 'Der Anbieter war nicht zuverlässig erreichbar. Prüfe die Verbindung und wiederhole den Auftrag.';
  return 'Öffne den betroffenen Titel und den Ereignisverlauf, um die Ursache zu prüfen. Nach der Korrektur kannst du den Auftrag wiederholen.';
}
