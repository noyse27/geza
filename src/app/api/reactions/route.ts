import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validOrigin } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  browserHash,
  browserToken,
  commentSettings,
  networkHash,
  reactionKinds,
} from '@/lib/review-comments';

const schema = z.object({
  reviewId: z.string().regex(/^\d+$/),
  reaction: z.enum(reactionKinds),
});

export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 403 });
  try {
    const settings = await commentSettings();
    if (!settings.enabled || !settings.reactions) throw Error('Reaktionen sind derzeit deaktiviert.');
    const input = schema.parse(await request.json());
    const current = request.headers.get('cookie')?.match(/(?:^|;\s*)geza_commenter=([^;]+)/)?.[1];
    const token = browserToken(current ? decodeURIComponent(current) : undefined);
    const browser = browserHash(token);
    const network = networkHash(request);
    const [review] = await query('SELECT 1 FROM reviews WHERE id=$1 AND is_public=true', [input.reviewId]);
    if (!review) throw Error('Das Review wurde nicht gefunden.');
    const [existing] = await query<{ reaction: string; updated_at: string }>(
      'SELECT reaction,updated_at::text FROM review_reactions WHERE review_id=$1 AND browser_hash=$2',
      [input.reviewId, browser],
    );
    if (existing && Date.now() - new Date(existing.updated_at).getTime() < 750)
      throw Error('Bitte warte kurz vor der nächsten Reaktion.');
    if (!existing) {
      const [rate] = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_reactions
         WHERE network_hash=$1 AND updated_at>now()-interval '15 minutes'`,
        [network],
      );
      if (Number(rate?.count || 0) >= 30) throw Error('Zu viele Reaktionen in kurzer Zeit.');
      await query(
        'INSERT INTO review_reactions(review_id,browser_hash,reaction,network_hash) VALUES($1,$2,$3,$4)',
        [input.reviewId, browser, input.reaction, network],
      );
    } else if (existing.reaction === input.reaction) {
      await query('DELETE FROM review_reactions WHERE review_id=$1 AND browser_hash=$2', [input.reviewId, browser]);
    } else {
      await query(
        'UPDATE review_reactions SET reaction=$3,network_hash=$4,updated_at=now() WHERE review_id=$1 AND browser_hash=$2',
        [input.reviewId, browser, input.reaction, network],
      );
    }
    const counts = await query<{ reaction: string; count: string }>(
      'SELECT reaction,count(*)::text AS count FROM review_reactions WHERE review_id=$1 GROUP BY reaction',
      [input.reviewId],
    );
    const response = NextResponse.json({
      selected: existing?.reaction === input.reaction ? null : input.reaction,
      counts: Object.fromEntries(counts.map((row) => [row.reaction, Number(row.count)])),
    });
    response.cookies.set('geza_commenter', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.PUBLIC_URL?.startsWith('https://') ?? false,
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const message = error instanceof z.ZodError
      ? 'Ungültige Reaktion.'
      : error && typeof error === 'object' && 'code' in error
        ? 'Reaktion konnte nicht gespeichert werden.'
        : (error as Error).message;
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
