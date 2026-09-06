import { query } from './db';
import type { Media, SearchResult } from './types';
export const publicColumns=`m.id,m.kind,m.title,m.original_title,m.year,m.parent_id,m.season,m.episode,m.ids,m.summary,m.countries,m.genres,m.directors,m.actors,m.certification,m.runtime,m.poster,m.updated_at,p.title AS parent_title,p.year AS parent_year`;
export async function searchCatalog(params: URLSearchParams, admin=false): Promise<SearchResult> {
 const start=performance.now(), values:unknown[]=[];
 const add=(v:unknown)=>{values.push(v);return `$${values.length}`;};
 const q=(params.get('q')||'').trim().slice(0,160), type=params.get('type')||'all';
 const filters:string[]=[]; let rank='m.title ASC,m.id ASC';
 if(type==='movie') filters.push("m.kind='movie'"); else if(type==='show') filters.push("m.kind IN ('show','season','episode')");
 if(q) {
  const term=add(q.toLowerCase()), pattern=add('%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%');
  filters.push(`(m.search_text LIKE ${pattern} OR m.search_vector @@ websearch_to_tsquery('simple',${term}) OR EXISTS(SELECT 1 FROM reviews rv WHERE rv.media_id=m.id ${admin?'':'AND rv.is_public'} AND to_tsvector('simple',rv.body) @@ websearch_to_tsquery('simple',${term})))`);
  rank=`(lower(m.title)=${term}) DESC,(m.ids->>'imdb'=${term}) DESC,(m.kind IN ('movie','show')) DESC,similarity(lower(m.title),${term}) DESC,m.title,m.id`;
 } else filters.push("m.kind IN ('movie','show')");
 for(const [param,op,col] of [['yearFrom','>=','m.year'],['yearTo','<=','m.year'],...(admin?[['ratingFrom','>=','r.rating'],['ratingTo','<=','r.rating']]:[])] as string[][]) {
  const raw=params.get(param); if(raw && /^\d{1,4}$/.test(raw)) filters.push(`${col}${op}${add(Number(raw))}`);
 }
 if(admin && params.get('unrated')==='1') filters.push('r.rating IS NULL');
 if(admin && (params.get('watchedFrom')||params.get('watchedTo'))) {
  const sub=['w.media_id=m.id'];
  for(const [param,op] of [['watchedFrom','>='],['watchedTo','<']]) {const raw=params.get(param);if(raw&&/^\d{4}$/.test(raw)) sub.push(`w.watched_at ${op} ${add(`${Number(raw)+(op==='<'?1:0)}-01-01`)}::timestamptz`);}
  filters.push(`EXISTS(SELECT 1 FROM watches w WHERE ${sub.join(' AND ')})`);
 }
 const page=Math.max(0,Math.min(10000,Number(params.get('page'))||0)), limit=params.get('live')==='1'?10:30;
 const rows=await query<Media>(`SELECT ${publicColumns}${admin?',r.rating':''} FROM media m LEFT JOIN media p ON p.id=m.parent_id ${admin?'LEFT JOIN ratings r ON r.media_id=m.id':''} WHERE ${filters.length?filters.join(' AND '):'true'} ORDER BY ${rank} LIMIT ${add(limit+1)} OFFSET ${add(page*limit)}`,values);
 return {items:rows.slice(0,limit),hasMore:rows.length>limit,elapsed:Math.round((performance.now()-start)*10)/10};
}
export async function getMedia(id:string) { if(!/^\d+$/.test(id)) return null; return (await query<Media>(`SELECT ${publicColumns},m.locked_fields FROM media m LEFT JOIN media p ON p.id=m.parent_id WHERE m.id=$1`,[id]))[0]||null; }
export async function history(params:URLSearchParams,limit=50) {
 const values:unknown[]=[]; const add=(v:unknown)=>{values.push(v);return `$${values.length}`;};
 const filters=['w.watched_at IS NOT NULL'];
 if(params.get('type')==='movie') filters.push("m.kind='movie'");
 if(params.get('type')==='show') filters.push("m.kind='episode'");
 const month=params.get('month'); if(month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) filters.push(`w.watched_at < ((${add(month+'-01')}::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Berlin')`);
 const cursor=params.get('cursor'); if(cursor) {try {const [at,id]=JSON.parse(Buffer.from(cursor,'base64url').toString()); if(typeof at==='string'&&/^\d+$/.test(String(id))) filters.push(`(w.watched_at,w.id)<(${add(at)}::timestamptz,${add(id)}::bigint)`);}catch{ /* malformed cursor starts at top */ }}
 const rows=await query<Media>(`SELECT ${publicColumns},r.rating,w.watched_at,w.id AS watch_id FROM watches w JOIN media m ON m.id=w.media_id LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings r ON r.media_id=m.id WHERE ${filters.join(' AND ')} ORDER BY w.watched_at DESC,w.id DESC LIMIT ${add(limit+1)}`,values);
 const items=rows.slice(0,limit), last=items.at(-1);
 return {items,cursor:rows.length>limit&&last?Buffer.from(JSON.stringify([last.watched_at,last.watch_id])).toString('base64url'):null};
}
export async function months(type:string) { return query(`SELECT to_char(w.watched_at AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS month,count(*)::integer AS count FROM watches w JOIN media m ON m.id=w.media_id WHERE w.watched_at IS NOT NULL ${type==='movie'?"AND m.kind='movie'":type==='show'?"AND m.kind='episode'":''} GROUP BY 1 ORDER BY 1 DESC`); }
