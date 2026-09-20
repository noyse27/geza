import { readFile } from 'node:fs/promises';
import { pool } from '../src/lib/db';
import { decodeArchive } from '../src/lib/transfer-format';
import { inspectInstallation, restoreInstallation } from '../src/lib/transfer';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const keyIndex = args.indexOf('--key');
const key = keyIndex >= 0 ? args[keyIndex + 1] : '';
const withoutKey = args.includes('--without-key');
const noApiKeys = args.includes('--no-api-keys');
const noModules = args.includes('--no-modules');
if (!file || (!withoutKey && !key)) {
  console.error(
    'Usage: node --import tsx scripts/restore.ts <datei.geza> --key WIEDERHERSTELLUNGSSCHLUESSEL [--no-api-keys] [--no-modules]\n' +
      '   or: node --import tsx scripts/restore.ts <datei.geza> --without-key [--no-modules]',
  );
  process.exit(1);
}
try {
  console.log(`Lese ${file} …`);
  const bytes = await readFile(file);
  console.log(`${(bytes.length / 1048576).toFixed(1)} MiB gelesen. Entschlüssele und prüfe Archiv …`);
  const archive = decodeArchive(bytes);
  const preview = await inspectInstallation(archive);
  console.log(`Export vom ${new Date(preview.exportedAt).toLocaleString('de-DE')}:`);
  for (const [table, count] of Object.entries(preview.counts)) console.log(`  ${table}: ${count}`);
  console.log('Spiele Datensätze ein …');
  const result = await restoreInstallation(
    archive,
    { key, accounts: !withoutKey, apiKeys: !withoutKey && !noApiKeys, modules: !noModules, withoutKey },
    'cli-restore',
  );
  console.log(
    result.needsAdmin
      ? 'Wiederherstellung abgeschlossen, aber ohne Admin-Konto. Neuen Admin mit scripts/finish-restore.ts anlegen.'
      : 'Wiederherstellung abgeschlossen. Anmeldung mit dem bisherigen Admin-Benutzernamen und -Passwort ist jetzt möglich.',
  );
} finally {
  await pool.end();
}
