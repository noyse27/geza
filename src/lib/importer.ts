import { readdir, readFile } from 'node:fs/promises';
import { pool } from './db';
import { watchedTime } from './security';
type Raw = Record<string, any>; // Trakt export has heterogeneous resource envelopes; only whitelisted fields are persisted.
export async function importTrakt(directory: string) {
 const files=(await readdir(directory)).filter(f=>/^(watched-history-|watched-movies-|watched-shows-|ratings-|comments-|collection-).*\.json$/.test(f));
 const media=new Map<string,Raw>(), history:Raw[]=[], ratings:Raw[]=[], reviews:Raw[]=[];
 function add(kind:string, raw:Raw, parent?:string): string|undefined {
  if(!raw?.ids?.trakt) return;
  const key=`${kind}:${raw.ids.trakt}`;
  const ids={...raw.ids}; delete ids.slug; if(typeof ids.plex==='object') ids.plex=ids.plex?.guid; Object.keys(ids).forEach(k=>{if(ids[k]==null) delete ids[k];});
  media.set(key,{kind,trakt_id:raw.ids.trakt,title:raw.title || (kind==='season'?`Staffel ${raw.number}`:`Episode ${raw.number}`),year:raw.year||null,ids,parent:parent||null,season:kind==='season'?raw.number:raw.season??null,episode:kind==='episode'?raw.number:null});
  return key;
 }
 for(const file of files) {
  const rows=JSON.parse((await readFile(`${directory}/${file}`,'utf8')).replace(/^\uFEFF/,''));
  if(!Array.isArray(rows)) throw new Error(`Unerwartetes Exportformat: ${file}`);
  for(const r of rows) {
   const show=r.show?add('show',r.show):undefined;
   const kind=r.type || (r.movie?'movie':r.episode?'episode':r.season?'season':r.show?'show':null);
   const key=kind==='show'?show:kind?add(kind,r[kind],show):undefined;
   if(!key) continue;
   if(file.startsWith('watched-history-')) history.push({key,source_id:String(r.id),watched_at:watchedTime(r.watched_at),original_watched_at:r.watched_at});
   if(file.startsWith('ratings-')) ratings.push({key,rating:r.rating,rated_at:r.rated_at});
   if(file.startsWith('comments-') && r.comment) reviews.push({key,source_id:String(r.comment.id),body:r.comment.comment,spoiler:!!r.comment.spoiler,parent_source_id:r.comment.parent_id?String(r.comment.parent_id):null,created_at:r.comment.created_at,updated_at:r.comment.updated_at});
  }
 }
 const client=await pool.connect();
 try {
  await client.query('BEGIN'); await client.query('SET LOCAL statement_timeout=0'); await client.query('SELECT pg_advisory_xact_lock(729383)');
  const run=(await client.query('INSERT INTO import_runs DEFAULT VALUES RETURNING id')).rows[0].id;
  const entries=[...media.values()];
  for(let i=0;i<entries.length;i+=1000) await client.query(`INSERT INTO media(kind,trakt_id,title,year,ids,season,episode)
   SELECT kind,trakt_id,title,year,ids,season,episode FROM jsonb_to_recordset($1::jsonb) AS x(kind text,trakt_id bigint,title text,year integer,ids jsonb,season integer,episode integer)
   ON CONFLICT(kind,trakt_id) DO UPDATE SET ids=media.ids || excluded.ids`,[JSON.stringify(entries.slice(i,i+1000))]);
  const idMap=new Map((await client.query('SELECT id,kind,trakt_id FROM media')).rows.map(r=>[`${r.kind}:${r.trakt_id}`,r.id]));
  const parents=entries.filter(r=>r.parent).map(r=>({id:idMap.get(`${r.kind}:${r.trakt_id}`),parent_id:idMap.get(r.parent)}));
  await client.query(`UPDATE media m SET parent_id=x.parent_id FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,parent_id bigint) WHERE m.id=x.id AND m.parent_id IS DISTINCT FROM x.parent_id`,[JSON.stringify(parents)]);
  for(let i=0;i<history.length;i+=1000) await client.query(`INSERT INTO watches(media_id,source,source_id,watched_at,original_watched_at)
   SELECT media_id,'trakt',source_id,watched_at,original_watched_at FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,source_id text,watched_at timestamptz,original_watched_at text)
   ON CONFLICT(source,source_id) DO NOTHING`,[JSON.stringify(history.slice(i,i+1000).map(r=>({...r,media_id:idMap.get(r.key)})))]);
  await client.query(`INSERT INTO ratings(media_id,rating,rated_at,source) SELECT media_id,rating,rated_at,'trakt' FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,rating integer,rated_at timestamptz)
   ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=excluded.rated_at,source='trakt' WHERE ratings.rated_at<excluded.rated_at`,[JSON.stringify(ratings.map(r=>({...r,media_id:idMap.get(r.key)})))]);
  await client.query(`INSERT INTO reviews(media_id,source,source_id,body,spoiler,parent_source_id,created_at,updated_at)
   SELECT media_id,'trakt',source_id,body,spoiler,parent_source_id,created_at,updated_at FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,source_id text,body text,spoiler boolean,parent_source_id text,created_at timestamptz,updated_at timestamptz)
   ON CONFLICT(source,source_id) DO NOTHING`,[JSON.stringify(reviews.map(r=>({...r,media_id:idMap.get(r.key)})))]);
  const collisions=(await client.query("SELECT kind,ids->>'plex' AS plex,count(*)::int AS count FROM media WHERE ids ? 'plex' GROUP BY kind,ids->>'plex' HAVING count(*)>1")).rows;
  const report={files:files.length,media:media.size,watches:history.length,unknownDates:history.filter(r=>!r.watched_at).length,ratings:ratings.length,reviews:reviews.length,providerCollisions:collisions};
  await client.query('UPDATE import_runs SET finished_at=now(),report=$1 WHERE id=$2',[JSON.stringify(report),run]);
  await client.query('COMMIT'); await client.query('ANALYZE media'); await client.query('ANALYZE watches');
  return report;
 } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
