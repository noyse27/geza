import { isAdmin, validOrigin } from '@/lib/auth';
import { exportInstallation } from '@/lib/transfer';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(req: Request) {
  if (!validOrigin(req) || !(await isAdmin()))
    return Response.json({ error: 'Anmeldung erforderlich.' }, { status: 403 });
  try {
    const { key } = await req.json();
    if (typeof key !== 'string' || !/^[a-f0-9-]{64,80}$/.test(key))
      throw Error('Ungültiger Wiederherstellungsschlüssel.');
    const bytes = await exportInstallation(key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="geza-${new Date().toISOString().slice(0, 10)}.geza"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      {
        error:
          'Export fehlgeschlagen. Bitte Datenbankzugang, Installationsschlüssel und Dateigröße prüfen (maximal 512 MiB unkomprimierte Daten).',
      },
      { status: 400 },
    );
  }
}
