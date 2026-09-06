import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { query } from './db';
import { digest } from './security';
import { redirect } from 'next/navigation';
export async function isAdmin() { const token=(await cookies()).get('geza_session')?.value; if(!token) return false; return (await query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).length>0; }
export async function requireAdmin() { if(!await isAdmin()) redirect('/login'); }
export async function createSession() { const token=randomBytes(32).toString('base64url'); await query('INSERT INTO sessions(token_hash,expires_at) VALUES($1,now()+interval \'7 days\')',[digest(token)]); (await cookies()).set('geza_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.PUBLIC_URL?.startsWith('https://') ?? false,path:'/',maxAge:604800}); }
export function validOrigin(request: Request) {
 const origin=request.headers.get('origin');
 const host=request.headers.get('host');
 const local=host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? `http://${host}` : null;
 const allowed=process.env.PUBLIC_URL || local;
 return !!origin && !!allowed && origin===new URL(allowed).origin;
}
