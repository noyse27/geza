import { z } from 'zod';
import { pool } from './db';

export async function deleteMedia(input: unknown) {
  const { id, title } = z
    .object({
      id: z.string().regex(/^[1-9]\d{0,17}$/),
      title: z.string().min(1).max(500),
    })
    .parse(input);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const media = (await client.query('SELECT title FROM media WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!media) return { error: 'Datensatz nicht gefunden.' };
    if (media.title !== title) return { error: 'Bitte den aktuellen Titel zur Bestätigung eingeben.' };
    if ((await client.query('SELECT 1 FROM media WHERE parent_id=$1 LIMIT 1', [id])).rowCount)
      return {
        error:
          'Dieser Serie sind noch Staffeln oder Episoden zugeordnet. Bitte zuerst deren Zuordnung korrigieren oder die einzelnen Datensätze löschen.',
      };
    for (const table of ['watches', 'ratings', 'reviews', 'posters'])
      await client.query(`DELETE FROM ${table} WHERE media_id=$1`, [id]);
    await client.query("DELETE FROM jobs WHERE payload->>'mediaId'=$1", [id]);
    await client.query('DELETE FROM media WHERE id=$1', [id]);
    await client.query('COMMIT');
    committed = true;
    return { ok: true };
  } finally {
    try {
      if (!committed) await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
