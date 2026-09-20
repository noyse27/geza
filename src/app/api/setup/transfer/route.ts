import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { validOrigin } from '@/lib/auth';
import { query } from '@/lib/db';
import { digest } from '@/lib/security';
import { installationReady } from '@/lib/setup';
import { decodeArchive, MAX_FILE_BYTES, openCredentials } from '@/lib/transfer-format';
import { inspectInstallation, restoreInstallation } from '@/lib/transfer';
export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  if (await installationReady())
    return Response.json({ error: 'Einrichtung abgeschlossen.' }, { status: 409, headers });
  const jar = await cookies();
  let owner = jar.get('geza_setup')?.value;
  if (!owner || !/^[a-f0-9]{64}$/.test(owner)) {
    owner = randomBytes(32).toString('hex');
    jar.set('geza_setup', owner, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.PUBLIC_URL?.startsWith('https://') ?? false,
      path: '/',
      maxAge: 604800,
    });
  }
  const pending = (await query('SELECT owner_hash FROM setup_restore WHERE id=1'))[0];
  return Response.json(
    { needsAdmin: !!pending, owned: !pending || pending.owner_hash === digest(owner) },
    { headers },
  );
}
const optionsSchema = z
  .object({
    action: z.enum(['inspect', 'restore']),
    key: z.string().max(200),
    accounts: z.boolean(),
    apiKeys: z.boolean(),
    modules: z.boolean(),
    withoutKey: z.boolean(),
  })
  .strict();
export async function POST(req: Request) {
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage.' }, { status: 403, headers });
  if (await installationReady())
    return Response.json({ error: 'Einrichtung abgeschlossen.' }, { status: 409, headers });
  if ((await query('SELECT 1 FROM setup_restore')).length)
    return Response.json(
      { error: 'Import bereits abgeschlossen. Bitte den Admin im ursprünglichen Browser anlegen.' },
      { status: 409, headers },
    );
  const owner = (await cookies()).get('geza_setup')?.value;
  if (!owner || !/^[a-f0-9]{64}$/.test(owner))
    return Response.json({ error: 'Bitte die Einrichtung neu laden.' }, { status: 403, headers });
  try {
    // Bound actual bytes, not just the untrusted Content-Length header.
    const reader = req.body?.getReader();
    if (!reader) throw Error('Datei fehlt.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_BYTES + 65536) {
        await reader.cancel();
        throw Error('Die Datei darf höchstens 256 MiB groß sein.');
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': req.headers.get('content-type') || '' },
    }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw Error('Bitte eine Geza-Umzugsdatei auswählen.');
    const options = optionsSchema.parse(JSON.parse(String(form.get('options'))));
    const archive = decodeArchive(Buffer.from(await file.arrayBuffer()));
    const preview = await inspectInstallation(archive);
    if (options.action === 'inspect') {
      let unlocked = false,
        hasAccount = false;
      if (options.key) {
        try {
          const credentials = openCredentials(archive, options.key);
          unlocked = true;
          hasAccount = !!credentials.accounts.length;
        } catch {
          /* Return the media preview even when credentials cannot be unlocked. */
        }
      }
      return Response.json({ ...preview, unlocked, hasAccount }, { headers });
    }
    const result = await restoreInstallation(archive, options, owner);
    return Response.json({ ...result, ...preview }, { headers });
  } catch (error) {
    const message =
      error instanceof Error && !('code' in error) && !(error instanceof z.ZodError)
        ? error.message
        : 'Import fehlgeschlagen: ungültige oder widersprüchliche Daten. Es wurden keine Daten übernommen.';
    return Response.json({ error: message }, { status: 400, headers });
  }
}
