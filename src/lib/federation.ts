import { randomBytes } from 'node:crypto';
import { isDemo } from './demo-mode';
import { query } from './db';
import { getSetting } from './settings';
import { constantEqual, decrypt, encrypt } from './security';
import { parsePeerUrl, safeFetchJson } from './safe-fetch';
export type Friend = {
  id: string;
  url: string;
  nickname: string;
  status: 'outgoing' | 'incoming' | 'accepted';
  nonce: string | null;
  secret_enc: string | null;
  created_at: Date;
};
const maxOpenRequests = 20;
const tokenPattern = /^[A-Za-z0-9_-]{32,64}$/;
/** This instance's public origin; federation needs it because peers must be able to link back. */
export function instanceUrl() {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}
export const federationEnabled = () => !isDemo() && !!instanceUrl();
export function cleanNickname(value: unknown, fallback = '') {
  const text =
    typeof value === 'string'
      ? value
          .replace(/[\p{C}\s]+/gu, ' ')
          .trim()
          .slice(0, 60)
      : '';
  return text || fallback;
}
export async function instanceNickname() {
  const base = instanceUrl();
  return cleanNickname(await getSetting('INSTANCE_NICKNAME'), base ? new URL(base).host : 'Geza');
}
export function normalizePeerUrl(value: string) {
  const url = parsePeerUrl(value);
  if (url.origin === instanceUrl()) throw Error('Das ist diese Instanz.');
  return url.origin;
}
const secretToken = () => randomBytes(32).toString('base64url');
async function peer<T>(url: string, path: string, options: Parameters<typeof safeFetchJson>[1] = {}) {
  const result = await safeFetchJson<T>(url + path, options);
  if (result.status < 200 || result.status >= 300)
    throw Error(`Die andere Instanz antwortete mit ${result.status}.`);
  return result.data as T;
}
export async function listFriends() {
  return query<Friend>(
    "SELECT id,url,nickname,status,nonce,secret_enc,created_at FROM friend_instances ORDER BY CASE status WHEN 'incoming' THEN 0 WHEN 'outgoing' THEN 1 ELSE 2 END,nickname",
  );
}
export async function pendingFriendCount() {
  return Number((await query("SELECT count(*) FROM friend_instances WHERE status='incoming'"))[0].count);
}
/** Admin action: ask another instance for friendship. */
export async function requestFriendship(input: string) {
  const base = instanceUrl();
  if (!federationEnabled() || !base) throw Error('Friends of Geza benötigt eine gesetzte PUBLIC_URL.');
  const url = normalizePeerUrl(input);
  const [existing] = await query<{ status: string }>('SELECT status FROM friend_instances WHERE url=$1', [
    url,
  ]);
  if (existing?.status === 'accepted') throw Error('Ihr seid bereits befreundet.');
  const nonce = secretToken();
  // The peer calls back to verify the nonce while it handles the request, so it must be stored first.
  await query(
    `INSERT INTO friend_instances(url,nickname,status,nonce) VALUES($1,$2,'outgoing',$3)
     ON CONFLICT(url) DO UPDATE SET status='outgoing',nonce=excluded.nonce`,
    [url, new URL(url).host, nonce],
  );
  try {
    await peer(url, '/api/federation/request', {
      method: 'POST',
      body: { url: base, nickname: await instanceNickname(), nonce },
    });
  } catch (error) {
    await query("DELETE FROM friend_instances WHERE url=$1 AND status='outgoing' AND nonce=$2", [url, nonce]);
    throw error;
  }
}
/** Public endpoint: a peer asks us. It must prove control of its URL by answering our callback. */
export async function receiveRequest(input: { url: string; nickname: unknown; nonce: string }) {
  if (!federationEnabled()) throw Error('Nicht verfügbar.');
  const url = normalizePeerUrl(input.url);
  if (!tokenPattern.test(input.nonce)) throw Error('Ungültige Anfrage.');
  const [existing] = await query<{ status: string }>('SELECT status FROM friend_instances WHERE url=$1', [
    url,
  ]);
  if (existing?.status === 'accepted') throw Error('Bereits befreundet.');
  if (!existing && (await pendingFriendCount()) >= maxOpenRequests) throw Error('Zu viele offene Anfragen.');
  const proof = await peer<{ ok?: boolean }>(
    url,
    `/api/federation/verify?nonce=${encodeURIComponent(input.nonce)}`,
  );
  if (!proof?.ok) throw Error('Die Anfrage konnte nicht bestätigt werden.');
  await query(
    `INSERT INTO friend_instances(url,nickname,status,nonce) VALUES($1,$2,'incoming',$3)
     ON CONFLICT(url) DO UPDATE SET status='incoming',nickname=excluded.nickname,nonce=excluded.nonce`,
    [url, cleanNickname(input.nickname, new URL(url).host), input.nonce],
  );
}
/** Public endpoint: a peer checks that a pending outgoing request with this nonce exists here. */
export async function verifyNonce(nonce: string) {
  if (!federationEnabled() || !tokenPattern.test(nonce)) return false;
  return (
    (await query("SELECT 1 FROM friend_instances WHERE status='outgoing' AND nonce=$1", [nonce])).length > 0
  );
}
/** Admin action: accept an incoming request and hand the shared secret to the requester. */
export async function acceptFriendship(id: string) {
  const base = instanceUrl();
  const [friend] = await query<Friend>("SELECT * FROM friend_instances WHERE id=$1 AND status='incoming'", [
    id,
  ]);
  if (!federationEnabled() || !base || !friend?.nonce) throw Error('Anfrage nicht gefunden.');
  const secret = secretToken();
  await peer(friend.url, '/api/federation/accept', {
    method: 'POST',
    body: { url: base, nickname: await instanceNickname(), nonce: friend.nonce, secret },
  });
  await query(
    "UPDATE friend_instances SET status='accepted',secret_enc=$2,nonce=NULL,accepted_at=now() WHERE id=$1",
    [id, encrypt(secret)],
  );
}
/** Public endpoint: the peer accepted our request and sends the shared secret and its nickname. */
export async function receiveAcceptance(input: {
  url: string;
  nickname: unknown;
  nonce: string;
  secret: string;
}) {
  if (!federationEnabled()) throw Error('Nicht verfügbar.');
  const url = normalizePeerUrl(input.url);
  if (!tokenPattern.test(input.secret) || !tokenPattern.test(input.nonce)) throw Error('Ungültige Anfrage.');
  const [friend] = await query<Friend>("SELECT * FROM friend_instances WHERE url=$1 AND status='outgoing'", [
    url,
  ]);
  if (!friend?.nonce || !constantEqual(friend.nonce, input.nonce)) throw Error('Unbekannte Anfrage.');
  await query(
    "UPDATE friend_instances SET status='accepted',secret_enc=$2,nonce=NULL,nickname=$3,accepted_at=now() WHERE id=$1",
    [friend.id, encrypt(input.secret), cleanNickname(input.nickname, friend.nickname)],
  );
}
/** Admin action: reject, cancel or end a friendship. Accepted peers are told so they drop it as well. */
export async function removeFriend(id: string) {
  const [friend] = await query<Friend>('DELETE FROM friend_instances WHERE id=$1 RETURNING *', [id]);
  if (friend?.status === 'accepted' && friend.secret_enc && federationEnabled())
    await peer(friend.url, '/api/federation/remove', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + decrypt(friend.secret_enc) },
    }).catch(() => undefined);
}
/** Authenticates a peer's Bearer secret against all accepted friends. */
export async function friendForRequest(req: Request) {
  if (!federationEnabled()) return null;
  const token = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) return null;
  for (const friend of await query<Friend>("SELECT * FROM friend_instances WHERE status='accepted'"))
    try {
      if (friend.secret_enc && constantEqual(decrypt(friend.secret_enc), token)) return friend;
    } catch {
      // A secret that no longer decrypts (changed SESSION_SECRET) never matches.
    }
  return null;
}
export type FriendRating = { nickname: string; url: string; rating: number | null; hasReview: boolean };
type Lookup = { found?: boolean; rating?: number | null; hasReview?: boolean; url?: string };
type Cached = {
  found: boolean;
  rating: number | null;
  has_review: boolean;
  url: string | null;
  fresh: boolean;
};
/** Answer for a peer's lookup: only the rating and whether a public review exists, never review text. */
export async function localLookup(kind: string, tmdb: string, imdb: string) {
  const base = instanceUrl();
  if (!base || !['movie', 'show'].includes(kind) || (!tmdb && !imdb)) return { found: false };
  const [media] = await query<{ id: string; rating: number | null; has_review: boolean }>(
    `SELECT m.id,r.rating,EXISTS(SELECT 1 FROM reviews v WHERE v.media_id=m.id AND v.is_public AND v.parent_source_id IS NULL) AS has_review
     FROM media m LEFT JOIN ratings r ON r.media_id=m.id
     WHERE m.kind=$1 AND NOT m.rumpel AND NOT m.bucketlist AND (($2<>'' AND m.ids->>'tmdb'=$2) OR ($3<>'' AND m.ids->>'imdb'=$3))
     ORDER BY m.id LIMIT 1`,
    [kind, tmdb, imdb],
  );
  if (!media || (media.rating === null && !media.has_review)) return { found: false };
  return { found: true, rating: media.rating, hasReview: media.has_review, url: `${base}/title/${media.id}` };
}
async function lookupFriend(
  friend: Friend,
  media: { id: string; kind: string; ids: Record<string, string | number> },
) {
  const [cached] = await query<Cached>(
    `SELECT found,rating,has_review,url,fetched_at>now()-CASE WHEN error THEN interval '15 minutes' ELSE interval '6 hours' END AS fresh
     FROM friend_instance_cache WHERE friend_id=$1 AND media_id=$2`,
    [friend.id, media.id],
  );
  if (cached?.fresh) return cached;
  try {
    const params = new URLSearchParams({
      kind: media.kind,
      tmdb: String(media.ids.tmdb || ''),
      imdb: String(media.ids.imdb || ''),
    });
    const answer = await peer<Lookup>(friend.url, '/api/federation/lookup?' + params, {
      headers: { Authorization: 'Bearer ' + decrypt(friend.secret_enc!) },
      timeoutMs: 2000,
    });
    const rating =
      Number.isInteger(answer?.rating) && answer.rating! >= 1 && answer.rating! <= 10 ? answer.rating! : null;
    const found = !!answer?.found && (rating !== null || !!answer.hasReview);
    const row: Cached = {
      found,
      rating: found ? rating : null,
      has_review: found && !!answer.hasReview,
      url: found && typeof answer.url === 'string' ? answer.url : null,
      fresh: true,
    };
    await query(
      `INSERT INTO friend_instance_cache(friend_id,media_id,found,rating,has_review,url,error,fetched_at) VALUES($1,$2,$3,$4,$5,$6,false,now())
       ON CONFLICT(friend_id,media_id) DO UPDATE SET found=excluded.found,rating=excluded.rating,has_review=excluded.has_review,url=excluded.url,error=false,fetched_at=now()`,
      [friend.id, media.id, row.found, row.rating, row.has_review, row.url],
    );
    return row;
  } catch {
    // Keep any earlier answer and retry after the error interval.
    await query(
      `INSERT INTO friend_instance_cache(friend_id,media_id,error,fetched_at) VALUES($1,$2,true,now())
       ON CONFLICT(friend_id,media_id) DO UPDATE SET error=true,fetched_at=now()`,
      [friend.id, media.id],
    ).catch(() => undefined);
    return cached;
  }
}
/** Friends' ratings for a title, from cache or a short-timeout request; a slow friend never blocks the page. */
export async function friendRatings(media: {
  id: string;
  kind: string;
  ids: Record<string, string | number>;
}): Promise<FriendRating[]> {
  if (!federationEnabled() || !['movie', 'show'].includes(media.kind) || !(media.ids.tmdb || media.ids.imdb))
    return [];
  const friends = await query<Friend>(
    "SELECT * FROM friend_instances WHERE status='accepted' ORDER BY nickname",
  );
  const rows = await Promise.all(
    friends.map(async (friend) => {
      const row = await lookupFriend(friend, media);
      if (!row?.found) return null;
      // The peer's link must stay on the peer's own origin.
      let link = friend.url;
      try {
        if (row.url && new URL(row.url).origin === friend.url) link = row.url;
      } catch {
        // fall back to the instance root
      }
      return { nickname: friend.nickname, url: link, rating: row.rating, hasReview: row.has_review };
    }),
  );
  return rows.filter((row): row is FriendRating => row !== null);
}
const globalWindows = globalThis as unknown as { gezaFederationWindows?: Map<string, number[]> };
const windows = (globalWindows.gezaFederationWindows ??= new Map<string, number[]>());
/** Small in-memory limit for public endpoints that trigger outbound requests. */
export function rateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const hits = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return true;
  windows.set(key, [...hits, now]);
  return false;
}
