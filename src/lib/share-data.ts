import { query } from './db';

export async function getShareData(id: string) {
  const [rating] = await query<{ rating: number }>('SELECT rating FROM ratings WHERE media_id=$1', [id]);
  const [review] = await query<{ body: string; spoiler: boolean }>(
    'SELECT body,spoiler FROM reviews WHERE media_id=$1 AND is_public AND parent_source_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1',
    [id],
  );
  return { rating: rating?.rating, review };
}
