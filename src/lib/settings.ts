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
] as const;
export async function getSetting(key: string) {
  const rows = await query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows.length ? decrypt(rows[0].value) : process.env[key] || '';
}
export async function setSetting(key: string, value: string) {
  await query(
    'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, encrypt(value)],
  );
}
