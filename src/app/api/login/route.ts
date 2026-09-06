import { query } from '@/lib/db';
import { createSession, validOrigin } from '@/lib/auth';
import { hashPassword, verifyPassword, safeNext } from '@/lib/security';
const dummy=hashPassword('not-a-real-password');
export async function POST(req:Request) {
 if(!validOrigin(req)) return Response.json({error:'Ungültige Anfrage'},{status:403});
 const body=await req.json(); const username=String(body.username||'').slice(0,100), password=String(body.password||'').slice(0,512);
 const attempt=(await query(`INSERT INTO login_attempts(key,attempts,expires_at) VALUES('admin',1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.expires_at<now() THEN 1 ELSE login_attempts.attempts+1 END,expires_at=CASE WHEN login_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.expires_at END RETURNING attempts`))[0];
 if(attempt.attempts>20) return Response.json({error:'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.'},{status:429});
 const account=(await query('SELECT * FROM admin_account WHERE id=1'))[0];
 const valid=verifyPassword(password,account?.password_hash||dummy);
 if(!account || !valid || username!==account.username) return Response.json({error:'Benutzername oder Passwort stimmt nicht.'},{status:401});
 await query("DELETE FROM login_attempts WHERE key='admin'"); await createSession();
 return Response.json({next:safeNext(body.next)});
}
