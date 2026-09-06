import { isAdmin, validOrigin } from '@/lib/auth';
import { importTrakt } from '@/lib/importer';
import AdmZip from 'adm-zip';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';

export const runtime = 'nodejs';
export const maxDuration = 300;

const exportFile = /^(watched-history-|watched-movies-|watched-shows-|ratings-|comments-|collection-).*\.json$/;
const maxZipBytes = 200 * 1024 * 1024;
const maxJsonBytes = 500 * 1024 * 1024;

function safePath(root: string, fileName: string) {
  const parts = fileName.replaceAll('\\', '/').split('/');
  if (parts.some((part) => part === '..') || parts[0] === '') return null;
  const name = parts.pop() || '';
  if (!exportFile.test(name)) return null;
  const target = normalize(join(root, name));
  return target === root || !target.startsWith(root + sep) ? null : target;
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data'))
    return Response.json({ error: 'Bitte eine Trakt-ZIP hochladen.' }, { status: 400 });
  const form = await req.formData(),
    file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Keine ZIP-Datei gefunden.' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.zip'))
    return Response.json({ error: 'Bitte den Trakt-Export als ZIP hochladen.' }, { status: 400 });
  if (file.size > maxZipBytes)
    return Response.json({ error: 'Die ZIP-Datei ist zu groß. Limit: 200 MB.' }, { status: 413 });

  const root = join(tmpdir(), 'geza-trakt-imports', crypto.randomUUID());
  try {
    await mkdir(root, { recursive: true });
    const zip = new AdmZip(Buffer.from(await file.arrayBuffer()));
    let total = 0,
      extracted = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const target = safePath(root, entry.entryName);
      if (!target) continue;
      total += entry.header.size;
      if (total > maxJsonBytes)
        return Response.json({ error: 'Die entpackten JSON-Dateien sind zu groß.' }, { status: 413 });
      const data = entry.getData();
      if (data.length !== entry.header.size)
        return Response.json({ error: 'Die entpackten JSON-Dateien sind zu groß.' }, { status: 413 });
      await writeFile(target, data);
      extracted++;
    }
    if (!extracted)
      return Response.json(
        { error: 'In der ZIP wurden keine passenden Trakt-Exportdateien gefunden.' },
        { status: 400 },
      );
    const report = await importTrakt(root);
    return Response.json({ ok: true, extracted, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Trakt-ZIP-Import fehlgeschlagen:', e);
    return Response.json(
      { error: 'Import fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
