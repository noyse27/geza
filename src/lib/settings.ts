import { isDemo } from './demo-mode';
import { query } from './db';
import { encrypt, decrypt } from './security';
export const settingKeys = [
  'TMDB_TOKEN',
  'TVDB_API_KEY',
  'TVDB_PIN',
  'PLEX_URL',
  'PLEX_TOKEN',
  'PLEX_ACCOUNT_ID',
  'PLEX_SERVER_ID',
  'PLEX_WEBHOOK_SECRET',
  'PLEX_SCAN_WATCHED_ONLY',
  'PLEX_SCAN_ENABLED',
  'PLEX_SCAN_SECTIONS',
  'PLEX_SCAN_HOUR',
  'FEED_GRACE_MINUTES',
  'INSTANCE_NICKNAME',
] as const;
export async function getSetting(key: string) {
  if (isDemo())
    return key === 'PLEX_URL' ? 'https://plex.example.invalid' : `demo-fantasie-${key.toLowerCase()}`;
  const rows = await query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows.length ? decrypt(rows[0].value) : process.env[key] || '';
}
export async function setSetting(key: string, value: string) {
  if (isDemo()) throw Error('Verbindungen sind in der Demo schreibgeschützt.');
  await query(
    'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, encrypt(value)],
  );
}
