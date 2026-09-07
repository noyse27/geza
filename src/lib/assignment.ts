import { z } from 'zod';
import { query } from './db';

export const assignmentSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,17}$/),
  parentId: z.string().regex(/^[1-9]\d{0,17}$/),
  season: z.number().int().min(0).max(10000),
  episode: z.number().int().min(1).max(10000).nullable(),
});

export async function correctAssignment(input: unknown) {
  const data = assignmentSchema.parse(input);
  const rows = await query(
    `UPDATE media m SET parent_id=p.id,season=$3,episode=$4,
      locked_fields=ARRAY(SELECT DISTINCT unnest(m.locked_fields || ARRAY['parent_id','season','episode'])),
      updated_at=now()
     FROM media p WHERE m.id=$1 AND p.id=$2 AND p.kind='show'
       AND ((m.kind='episode' AND $4::integer IS NOT NULL) OR (m.kind='season' AND $4::integer IS NULL))
     RETURNING m.id`,
    [data.id, data.parentId, data.season, data.episode],
  );
  return rows.length > 0;
}
