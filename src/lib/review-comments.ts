import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { query, pool } from './db';
import { decrypt, digest, encrypt } from './security';
import { getSetting } from './settings';

export const reactionKinds = ['like', 'dislike', 'love', 'laugh', 'applause', 'confused'] as const;
export type ReactionKind = (typeof reactionKinds)[number];
export type CommentStatus = 'pending' | 'published' | 'spam' | 'rejected';

export async function commentSettings() {
  const [enabled, comments, reactions, threshold] = await Promise.all([
    getSetting('COMMENTS_ENABLED'),
    getSetting('COMMENTS_TEXT_ENABLED'),
    getSetting('COMMENTS_REACTIONS_ENABLED'),
    getSetting('COMMENTS_TRUST_THRESHOLD'),
  ]);
  const parsedThreshold = Number(threshold || '5');
  return {
    enabled: enabled === '1',
    comments: comments !== '0',
    reactions: reactions !== '0',
    threshold: Number.isInteger(parsedThreshold) && parsedThreshold >= 0 && parsedThreshold <= 50
      ? parsedThreshold
      : 5,
  };
}

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

export function browserToken(value?: string) {
  return value && /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : randomBytes(32).toString('base64url');
}

export function browserHash(token: string) {
  return digest(`comment-browser:${token}`);
}

export function networkHash(request: Request) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
  const secret = process.env.SESSION_SECRET || 'geza-development-only';
  const day = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', secret).update(`${day}:${address}`).digest('hex');
}

export function normalizeWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Die Website muss mit http:// oder https:// beginnen.');
  url.username = '';
  url.password = '';
  return url.toString().slice(0, 500);
}

function spamReason(body: string, name: string, website: string | null) {
  const links = body.match(/https?:\/\/|www\./gi)?.length || 0;
  if (links > 2) return 'Zu viele Links';
  if (/(.)\1{14,}/u.test(body)) return 'Auffällige Zeichenfolge';
  if (/\b(?:viagra|casino|crypto giveaway|seo service)\b/i.test(`${name} ${body} ${website || ''}`))
    return 'Typisches Spam-Muster';
  return null;
}

export async function createReviewComment(input: {
  reviewId: string;
  name: string;
  email: string;
  website: string;
  body: string;
  browser: string;
  network: string;
  openedAt: number;
}) {
  const settings = await commentSettings();
  if (!settings.enabled || !settings.comments) throw Error('Kommentare sind derzeit deaktiviert.');
  if (Date.now() - input.openedAt < 2500) throw Error('Bitte nimm dir kurz Zeit für deinen Kommentar.');
  const email = normalizeEmail(input.email);
  const emailHash = digest(`comment-email:${email}`);
  const website = normalizeWebsite(input.website);
  const reason = spamReason(input.body, input.name, website);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const review = await client.query(
      'SELECT 1 FROM reviews WHERE id=$1 AND is_public=true',
      [input.reviewId],
    );
    if (!review.rowCount) throw Error('Das Review wurde nicht gefunden.');
    const recent = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM review_comments
       WHERE (browser_hash=$1 OR network_hash=$2) AND created_at>now()-interval '15 minutes'`,
      [input.browser, input.network],
    );
    if (Number(recent.rows[0]?.count || 0) >= 4) throw Error('Zu viele Kommentare in kurzer Zeit. Bitte versuche es später erneut.');
    const commenterResult = await client.query<{
      id: string;
      approved_count: number;
      blocked: boolean;
    }>(
      `INSERT INTO review_commenters(email_hash,email_encrypted,name,website)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(email_hash) DO UPDATE SET name=excluded.name,website=excluded.website,updated_at=now()
       RETURNING id,approved_count,blocked`,
      [emailHash, encrypt(email), input.name, website],
    );
    const commenter = commenterResult.rows[0];
    const duplicate = await client.query(
      `SELECT 1 FROM review_comments
       WHERE commenter_id=$1 AND lower(body)=lower($2) AND created_at>now()-interval '30 days' LIMIT 1`,
      [commenter.id, input.body],
    );
    const knownBrowser = await client.query(
      `SELECT 1 FROM review_comments
       WHERE commenter_id=$1 AND browser_hash=$2 AND status='published' LIMIT 1`,
      [commenter.id, input.browser],
    );
    const moderationReason = commenter.blocked
      ? 'Absender gesperrt'
      : duplicate.rowCount
        ? 'Doppelter Kommentar'
        : reason;
    const trusted = !commenter.blocked
      && commenter.approved_count >= settings.threshold
      && !!knownBrowser.rowCount
      && !moderationReason;
    const status: CommentStatus = trusted ? 'published' : moderationReason ? 'spam' : 'pending';
    await client.query(
      `INSERT INTO review_comments(review_id,commenter_id,body,status,browser_hash,network_hash,moderation_reason,published_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $4='published' THEN now() ELSE NULL END)`,
      [input.reviewId, commenter.id, input.body, status, input.browser, input.network, moderationReason],
    );
    if (trusted)
      await client.query('UPDATE review_commenters SET approved_count=approved_count+1 WHERE id=$1', [commenter.id]);
    await client.query('COMMIT');
    return { status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDiscussions(reviewIds: string[], viewerBrowser?: string) {
  if (!reviewIds.length) return new Map<string, { comments: PublicComment[]; reactions: ReactionSummary[] }>();
  const [comments, reactions] = await Promise.all([
    query<PublicComment>(
      `SELECT c.id::text,c.review_id::text,c.body,c.created_at::text,u.name,u.website
       FROM review_comments c JOIN review_commenters u ON u.id=c.commenter_id
       WHERE c.review_id=ANY($1::bigint[]) AND c.status='published' ORDER BY c.created_at`,
      [reviewIds],
    ),
    query<{ review_id: string; reaction: ReactionKind; count: string; selected: boolean }>(
      `SELECT review_id::text,reaction,count(*)::text,
              bool_or(browser_hash=$2) AS selected
       FROM review_reactions WHERE review_id=ANY($1::bigint[])
       GROUP BY review_id,reaction ORDER BY reaction`,
      [reviewIds, viewerBrowser ? browserHash(viewerBrowser) : ''],
    ),
  ]);
  const result = new Map<string, { comments: PublicComment[]; reactions: ReactionSummary[] }>();
  for (const id of reviewIds) result.set(id, { comments: [], reactions: [] });
  for (const comment of comments) result.get(comment.review_id)?.comments.push(comment);
  for (const reaction of reactions)
    result.get(reaction.review_id)?.reactions.push({
      reaction: reaction.reaction,
      count: Number(reaction.count),
      selected: reaction.selected,
    });
  return result;
}

export type PublicComment = {
  id: string;
  review_id: string;
  body: string;
  created_at: string;
  name: string;
  website: string | null;
};
export type ReactionSummary = { reaction: ReactionKind; count: number; selected: boolean };

export async function pendingCommentCount() {
  return Number((await query<{ count: string }>("SELECT count(*)::text AS count FROM review_comments WHERE status='pending'"))[0]?.count || 0);
}

export async function moderationComments(status: CommentStatus) {
  const rows = await query<{
    id: string; review_id: string; body: string; status: CommentStatus; moderation_reason: string | null;
    created_at: string; commenter_id: string; name: string; website: string | null; email_encrypted: string;
    approved_count: number; blocked: boolean; media_id: string; title: string;
  }>(
    `SELECT c.id::text,c.review_id::text,c.body,c.status,c.moderation_reason,c.created_at::text,
            u.id::text AS commenter_id,u.name,u.website,u.email_encrypted,u.approved_count,u.blocked,
            r.media_id::text,m.title
     FROM review_comments c JOIN review_commenters u ON u.id=c.commenter_id
     JOIN reviews r ON r.id=c.review_id JOIN media m ON m.id=r.media_id
     WHERE c.status=$1 ORDER BY c.created_at DESC LIMIT 200`,
    [status],
  );
  return rows.map(({ email_encrypted, ...row }) => ({ ...row, email: decrypt(email_encrypted) }));
}
