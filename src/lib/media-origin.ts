export function originLabel(origins: string[] = []) {
  const labels: Record<string, string> = {
    trakt: 'Trakt',
    'trakt-collection': 'Trakt Collection',
    'trakt-watchlist': 'Trakt Watchlist',
    plex: 'Plex-Abgleich',
    manual: 'Manuell hinzugefügt',
    'collection-wish': 'Collection als Wunsch übernommen',
    'legacy-bucket': 'Bestehende Bucketliste',
  };
  return (
    origins.map((origin) => labels[origin] || origin).join(', ') || 'Altbestand; Herkunft nicht dokumentiert'
  );
}
