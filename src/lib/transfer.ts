import { isDemo } from './demo-mode';
import { randomBytes } from 'node:crypto';
import { pool } from './db';
import { decrypt, digest, encrypt } from './security';
import { settingKeys } from './settings';
import { SETUP_LOCK } from './setup';
import { reviewModules } from './review-modules';
import {
  dataTables,
  encodeArchive,
  sealCredentials,
  openCredentials,
  type Archive,
  type Credentials,
} from './transfer-format';
import type { PoolClient } from 'pg';

export async function exportInstallation(key: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL statement_timeout=120000');
    const tables = {} as Archive['tables'];
    for (const table of dataTables) {
      // PostgreSQL JSON retains exact bigint IDs and bytea, unlike JS number conversion.
      const columns = (
        await client.query(
          `SELECT column_name,data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
          [table],
        )
      ).rows;
      const select = columns
        .map((c) => `"${c.column_name}"${c.data_type === 'bigint' ? '::text' : ''} AS "${c.column_name}"`)
        .join(',');
      tables[table] = (
        await client.query(`SELECT row_to_json(t) AS data FROM (SELECT ${select} FROM "${table}") t`)
      ).rows.map((r) => r.data);
    }
    // Job payloads are user data (including unresolved scrobbles). Preserve them, but never replay old work.
    const settings: Record<string, string> = {};
    const stored = (await client.query('SELECT key,value FROM settings')).rows;
    for (const key of settingKeys) {
      if (key === 'PLEX_WEBHOOK_SECRET') continue;
      const value = stored.find((r) => r.key === key);
      settings[key] = value ? decrypt(value.value) : process.env[key] || '';
    }
    const accounts = (await client.query('SELECT * FROM admin_account')).rows as Credentials['accounts'];
    const migrations = (await client.query('SELECT name FROM migrations ORDER BY name')).rows.map(
      (r) => r.name as string,
    );
    await client.query('COMMIT');
    return encodeArchive({
      format: 'geza-transfer',
      version: 1,
      exportedAt: new Date().toISOString(),
      migrations,
      tables,
      credentials: sealCredentials({ accounts, settings }, key),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function validateTarget(client: PoolClient, archive: Archive) {
  const migrations = (await client.query('SELECT name FROM migrations ORDER BY name')).rows.map(
    (r) => r.name,
  );
  if (JSON.stringify(migrations) !== JSON.stringify(archive.migrations))
    throw Error(
      'Die Datenbankversionen unterscheiden sich. Bitte beide Installationen vor dem Umzug auf dieselbe Geza-Version aktualisieren.',
    );
  for (const table of dataTables) {
    const columns = (
      await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [table],
      )
    ).rows.map((r) => r.column_name as string);
    for (const row of archive.tables[table]) {
      if (Object.keys(row).length !== columns.length || columns.some((column) => !(column in row)))
        throw Error(`Unvollständige oder unbekannte Datenfelder in ${table}.`);
    }
  }
}

export async function inspectInstallation(archive: Archive) {
  const client = await pool.connect();
  try {
    await validateTarget(client, archive);
    return {
      exportedAt: archive.exportedAt,
      counts: Object.fromEntries(dataTables.map((t) => [t, archive.tables[t].length])),
      modules: archive.tables.review_boxes
        .filter((r) => r.automatic_enabled && reviewModules.some((m) => m.id === r.provider && m.discover))
        .map((r) => r.name),
    };
  } finally {
    client.release();
  }
}

export type RestoreOptions = {
  accounts: boolean;
  apiKeys: boolean;
  modules: boolean;
  withoutKey: boolean;
  key: string;
};
export async function restoreInstallation(archive: Archive, options: RestoreOptions, owner: string) {
  if (isDemo()) throw Error('Wiederherstellung im Demomodus deaktiviert.');
  if (!owner) throw Error('Einrichtungssitzung fehlt. Bitte die Seite neu laden.');
  let credentials: Credentials | undefined;
  if (options.accounts || options.apiKeys) credentials = openCredentials(archive, options.key);
  else if (!options.withoutKey)
    throw Error('Bitte den Import ohne Konten und Zugangsdaten ausdrücklich auswählen.');
  if (options.accounts && !credentials?.accounts.length)
    throw Error('Der Export enthält kein Admin-Konto. Bitte ohne Konten fortfahren.');
  if (
    credentials &&
    Object.keys(credentials.settings).some(
      (k) => !settingKeys.includes(k as (typeof settingKeys)[number]) || k === 'PLEX_WEBHOOK_SECRET',
    )
  )
    throw Error('Unbekannte Verbindungseinstellungen im Export.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=120000');
    await client.query('SET LOCAL lock_timeout=5000');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
    await client.query(
      `LOCK TABLE admin_account, settings, setup_restore, ${dataTables.join(',')} IN EXCLUSIVE MODE`,
    );
    if (
      (await client.query('SELECT 1 FROM admin_account UNION ALL SELECT 1 FROM setup_restore LIMIT 1'))
        .rowCount
    )
      throw Error('Die Installation wurde bereits eingerichtet oder wiederhergestellt.');
    for (const table of [...dataTables, 'settings']) {
      if ((await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount)
        throw Error(
          'Eine Wiederherstellung ist nur in einer leeren Installation möglich. Zusammenführen wird nicht unterstützt.',
        );
    }
    await validateTarget(client, archive);
    // Die Rumpelkammer-Zuordnung wird nach dem Einspielen einmal neu berechnet statt pro Zeile.
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    await client.query('DELETE FROM sessions');
    await client.query('DELETE FROM login_attempts');
    for (const table of dataTables) {
      const rows = archive.tables[table];
      if (!rows.length) continue;
      // A single INSERT per table permits forward parent references in series/season/episode trees.
      await client.query(
        `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}",$1::json)`,
        [JSON.stringify(rows)],
      );
    }
    await client.query('SELECT rumpel_refresh(NULL)');
    const providers = reviewModules.filter((m) => m.discover).map((m) => m.id);
    await client.query(
      `UPDATE review_boxes SET automatic_enabled=false WHERE NOT $1 OR NOT(provider=ANY($2::text[]))`,
      [options.modules, providers],
    );
    await client.query(`UPDATE jobs SET status='failed',attempts=GREATEST(attempts,3),
      error='Beim Umzug pausiert; bei Bedarf im Adminbereich neu starten.' WHERE status IN ('pending','running')`);
    // Populate every key, including empty values, so destination environment fallbacks cannot leak in.
    for (const key of settingKeys) {
      const value =
        key === 'PLEX_WEBHOOK_SECRET'
          ? randomBytes(32).toString('hex')
          : options.apiKeys
            ? credentials!.settings[key] || ''
            : '';
      await client.query('INSERT INTO settings(key,value) VALUES($1,$2)', [key, encrypt(value)]);
    }
    if (options.accounts) {
      const account = credentials!.accounts[0];
      await client.query('INSERT INTO admin_account(id,username,password_hash) VALUES(1,$1,$2)', [
        account.username,
        account.password_hash,
      ]);
    } else await client.query('INSERT INTO setup_restore(id,owner_hash) VALUES(1,$1)', [digest(owner)]);
    // ALTER SEQUENCE is transactional, unlike setval: failed restores also roll back counters.
    for (const table of ['media', 'watches', 'reviews', 'film_series', 'jobs', 'import_runs', 'rumpel_deleted']) {
      const next = (await client.query(`SELECT (COALESCE(MAX(id),0)+1)::text AS next FROM "${table}"`))
        .rows[0].next;
      if (!/^\d+$/.test(next)) throw Error('Ungültiger Zähler.');
      await client.query(`ALTER SEQUENCE "${table}_id_seq" RESTART WITH ${next}`);
    }
    await client.query('COMMIT');
    return { needsAdmin: !options.accounts, apiKeysImported: options.apiKeys };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
