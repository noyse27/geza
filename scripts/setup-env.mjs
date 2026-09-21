import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
const demo = process.argv.includes('--demo');
const envFile = demo ? '.env.demo' : '.env';
const mode = demo ? 'demo' : 'production';
const exists = existsSync(envFile);
const original = exists ? readFileSync(envFile, 'utf8') : '';
const values = parseEnv(original);
for (const [key, expected] of [
  ['GEZA_MODE', mode],
  ['GEZA_ENV_FILE', envFile],
]) {
  if (values[key]?.trim() && values[key] !== expected) {
    console.error(
      `${envFile}: ${key} muss für diese Installation ${expected} sein. Bitte die Datei prüfen; nichts wurde geändert.`,
    );
    process.exit(1);
  }
}
const password = values.POSTGRES_PASSWORD?.trim()
  ? values.POSTGRES_PASSWORD
  : randomBytes(20).toString('hex');
const defaults = {
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgres://geza:${encodeURIComponent(password)}@localhost:5439/geza`,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  PUBLIC_URL: '',
  GEZA_PORT: demo ? '3081' : '3080',
  GEZA_ENV_FILE: envFile,
  GEZA_MODE: mode,
  DEMO_RESET_MINUTES: '60',
  PLEX_WEBHOOK_SECRET: randomBytes(24).toString('hex'),
};
const missing = Object.keys(defaults).filter(
  (key) => !(key in values) || (!values[key].trim() && defaults[key]),
);
if (!missing.length) {
  console.log(`${envFile} vollständig; vorhandene Konfiguration bleibt erhalten.`);
} else {
  let content = original;
  for (const key of missing) {
    // Remove empty assignments (including duplicates); append a single generated value.
    content = content.replace(new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=.*(?:\\r?\\n|$)`, 'gm'), '');
  }
  if (content && !content.endsWith('\n')) content += '\n';
  content += missing.map((key) => `${key}=${defaults[key]}\n`).join('');
  writeFileSync(envFile, content, { mode: 0o600 });
  console.log(
    `${envFile}: ${exists ? 'fehlende Einstellungen ergänzt' : 'erstellt'} (${missing.join(', ')}). Vorhandene Werte bleiben erhalten.`,
  );
  if (exists && missing.includes('POSTGRES_PASSWORD'))
    console.log(
      'Neues Datenbankpasswort erzeugt. Falls bereits eine Datenbank besteht, muss stattdessen deren bisheriges Passwort verwendet werden.',
    );
}
