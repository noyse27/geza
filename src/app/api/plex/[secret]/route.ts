import { getSetting } from '@/lib/settings';
import { constantEqual,digest } from '@/lib/security';
import { query,pool } from '@/lib/db';
export async function POST(req:Request,{params}:{params:Promise<{secret:string}>}) {
 const expected=await getSetting('PLEX_WEBHOOK_SECRET'),account=await getSetting('PLEX_ACCOUNT_ID'),server=await getSetting('PLEX_SERVER_ID');
 if(!expected || !constantEqual((await params).secret,expected))return new Response(null,{status:401});
 if(!account||!server)return Response.json({error:'Plex account and server must be configured'},{status:503});
 try {
  const reader=req.body?.getReader();if(!reader)return new Response(null,{status:400});let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
  const buffer=Buffer.concat(chunks);let raw;
  if(req.headers.get('content-type')?.includes('multipart/form-data')) {const f=await new Response(buffer,{headers:{'Content-Type':req.headers.get('content-type')!}}).formData();raw=JSON.parse(String(f.get('payload')));} else raw=JSON.parse(buffer.toString());
  if(String(raw.Account?.id)!==account||String(raw.Server?.uuid)!==server)return new Response(null,{status:403});
  if(!['media.scrobble','media.rate'].includes(raw.event))return Response.json({ignored:true});
  if(!raw.Metadata||!['movie','show','season','episode'].includes(raw.Metadata.type))return new Response(null,{status:400});
  const m=raw.Metadata,metadata:Record<string,unknown>={};for(const key of ['type','title','year','guid','Guid','ratingKey','grandparentRatingKey','grandparentTitle','parentIndex','index','summary','originalTitle','contentRating','duration','Director','Role','Genre','Country','userRating','lastViewedAt'])if(m[key]!==undefined)metadata[key]=m[key];
  const fingerprint=digest(JSON.stringify({event:raw.event,metadata,session:raw.Player?.uuid}));
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[fingerprint]);
  const recent=await client.query("SELECT 1 FROM jobs WHERE kind='plex' AND payload->>'fingerprint'=$1 AND updated_at>now()-interval '2 minutes'",[fingerprint]);
  if(!recent.rowCount){const eventId=crypto.randomUUID();await client.query("INSERT INTO jobs(kind,payload) VALUES('plex',$1)",[JSON.stringify({event:raw.event,metadata,receivedAt:new Date().toISOString(),eventId,fingerprint})]);}
  await client.query('COMMIT');return Response.json({accepted:true},{status:202});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 } catch {return Response.json({error:'Invalid payload or temporarily unavailable'},{status:400});}
}
