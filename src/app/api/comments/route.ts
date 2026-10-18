import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validOrigin } from '@/lib/auth';
import { browserHash, browserToken, createReviewComment, networkHash } from '@/lib/review-comments';

const schema = z.object({
  reviewId: z.string().regex(/^\d+$/),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  website: z.string().trim().max(500).default(''),
  body: z.string().trim().min(2).max(5000),
  company: z.string().max(0),
  openedAt: z.number().int().positive(),
});

export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const current = request.headers.get('cookie')?.match(/(?:^|;\s*)geza_commenter=([^;]+)/)?.[1];
    const token = browserToken(current ? decodeURIComponent(current) : undefined);
    const result = await createReviewComment({
      ...input,
      browser: browserHash(token),
      network: networkHash(request),
    });
    const response = NextResponse.json({
      ...result,
      message: result.status === 'published'
        ? 'Dein Kommentar wurde veröffentlicht.'
        : result.status === 'pending'
          ? 'Danke! Dein Kommentar wartet auf Freigabe.'
          : 'Danke. Dein Beitrag wird geprüft.',
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
      ? 'Bitte prüfe deine Eingaben.'
      : error && typeof error === 'object' && 'code' in error
        ? 'Kommentar konnte nicht gespeichert werden.'
        : (error as Error).message;
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
