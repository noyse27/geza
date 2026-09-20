import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';

// Explicit allowlist: sessions, login attempts, logs and installation secrets never travel.
export const dataTables = [
  'media',
  'watches',
  'ratings',
  'reviews',
  'posters',
  'friend_reviews',
  'provider_ratings',
  'film_series',
  'film_series_members',
  'review_boxes',
  'jobs',
  'import_runs',
] as const;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_JSON_BYTES = 512 * 1024 * 1024;
const row = z.record(z.string(), z.unknown());
const tablesSchema = z
  .object(
    Object.fromEntries(dataTables.map((t) => [t, z.array(row)])) as Record<
      (typeof dataTables)[number],
      z.ZodArray<typeof row>
    >,
  )
  .strict();
const sealedSchema = z
  .object({
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    iv: z.string().regex(/^[a-f0-9]{24}$/),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    body: z.string().max(2_000_000),
  })
  .strict();
const archiveSchema = z
  .object({
    format: z.literal('geza-transfer'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    migrations: z.array(z.string()).min(1),
    tables: tablesSchema,
    credentials: sealedSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Archive = z.infer<typeof archiveSchema>;
export const credentialsSchema = z
  .object({
    accounts: z
      .array(
        z
          .object({
            id: z.literal(1),
            username: z.string().min(3).max(100),
            password_hash: z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/),
          })
          .strict(),
      )
      .max(1),
    settings: z.record(z.string(), z.string().max(10000)),
  })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;
export const newTransferKey = () => randomBytes(32).toString('hex').match(/.{8}/g)!.join('-');
const keyBytes = (key: string, salt: string) => {
  const normalized = key.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw Error('Wiederherstellungsschlüssel ungültig.');
  return scryptSync(normalized, Buffer.from(salt, 'hex'), 32);
};
export function sealCredentials(credentials: Credentials, key: string) {
  const salt = randomBytes(16).toString('hex'),
    iv = randomBytes(12).toString('hex');
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key, salt), Buffer.from(iv, 'hex'));
  cipher.setAAD(Buffer.from('geza-transfer:1'));
  const body = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]).toString('base64');
  return { salt, iv, tag: cipher.getAuthTag().toString('hex'), body };
}
export function openCredentials(archive: Archive, key: string): Credentials {
  try {
    const sealed = archive.credentials;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyBytes(key, sealed.salt),
      Buffer.from(sealed.iv, 'hex'),
    );
    decipher.setAAD(Buffer.from('geza-transfer:1'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    return credentialsSchema.parse(
      JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(sealed.body, 'base64')), decipher.final()]).toString(
          'utf8',
        ),
      ),
    );
  } catch {
    throw Error('Der Schlüssel passt nicht oder die verschlüsselten Zugangsdaten sind beschädigt.');
  }
}
function checksum(value: Omit<Archive, 'checksum'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function encodeArchive(value: Omit<Archive, 'checksum'>) {
  const json = JSON.stringify({ ...value, checksum: checksum(value) });
  if (Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw Error('Export übersteigt die unterstützten 512 MiB Nutzdaten.');
  const result = gzipSync(json);
  if (result.length > MAX_FILE_BYTES) throw Error('Exportdatei übersteigt 256 MiB.');
  return result;
}
export function decodeArchive(bytes: Buffer): Archive {
  if (bytes.length > MAX_FILE_BYTES) throw Error('Die Datei darf höchstens 256 MiB groß sein.');
  try {
    const value = archiveSchema.parse(
      JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_JSON_BYTES }).toString('utf8')),
    );
    const { checksum: expected, ...content } = value;
    if (checksum(content) !== expected) throw Error('checksum');
    return value;
  } catch {
    throw Error('Keine vollständige, unbeschädigte Geza-Umzugsdatei der unterstützten Version.');
  }
}
