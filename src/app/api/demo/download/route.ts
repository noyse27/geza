import { readFile } from 'node:fs/promises';
import { isDemo } from '@/lib/demo-mode';
export async function GET() {
  if (!isDemo()) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(await readFile('demo.geza')), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="demo.geza"',
    },
  });
}
