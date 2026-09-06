import { query } from './db';
import { getSetting } from './settings';
import { findPlex } from './plex';
type Raw=Record<string,any>;
const fields=['title','original_title','year','summary','countries','genres','directors','actors','certification','runtime','poster'] as const;
const tags=(items:Raw[]|undefined)=>items?.map(x=>String(x.tag||x.name||'')).filter(Boolean)||[];
export function fromPlex(m:Raw):Raw {return {title:m.title,original_title:m.originalTitle,year:m.year,summary:m.summary,countries:tags(m.Country),genres:tags(m.Genre),directors:tags(m.Director),actors:tags(m.Role).slice(0,10),certification:m.contentRating?.startsWith('de/')?m.contentRating.slice(3):undefined,runtime:m.duration?Math.round(m.duration/60000):undefined};}
export async function mergeMetadata(id:string,data:Raw,source='plex') {
 const current=(await query('SELECT * FROM media WHERE id=$1',[id]))[0];if(!current)return;
 const priority:Record<string,number>={plex:3,tvdb:2,tmdb:1};
 const keys=fields.filter(k=>!current.locked_fields.includes(k)&&data[k]!=null&&data[k]!==''&&(!Array.isArray(data[k])||data[k].length)&&(!current[k]||Array.isArray(current[k])&&!current[k].length||(priority[source]||0)>(priority[current.field_sources?.[k]]||0)));
 if(keys.length)await query(`UPDATE media SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},field_sources=field_sources||$${keys.length+1}::jsonb,updated_at=now() WHERE id=$${keys.length+2}`,[...keys.map(k=>data[k]),JSON.stringify(Object.fromEntries(keys.map(k=>[k,source]))),id]);
}
async function json(url:string,headers:Record<string,string>={},body?:unknown) {const r=await fetch(url,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`Metadatenanbieter HTTP ${r.status}`);return r.json();}
async function tmdb(m:Raw):Promise<Raw|null> {const token=await getSetting('TMDB_TOKEN');if(!token)return null;const headers={Authorization:`Bearer ${token}`};let id=m.ids.tmdb;
 if(!id&&m.ids.imdb){const found=await json(`https://api.themoviedb.org/3/find/${encodeURIComponent(m.ids.imdb)}?external_source=imdb_id`,headers);id=(m.kind==='movie'?found.movie_results:found.tv_results)?.[0]?.id;}
 let path=m.kind==='movie'?`movie/${id}`:`tv/${id}`;
 if(m.kind==='episode'){const parent=(await query('SELECT ids FROM media WHERE id=$1',[m.parent_id]))[0];if(!parent?.ids.tmdb)return null;path=`tv/${parent.ids.tmdb}/season/${m.season}/episode/${m.episode}`;}else if(!id)return null;
 const d=await json(`https://api.themoviedb.org/3/${path}?language=de-DE&append_to_response=credits,release_dates,content_ratings,external_ids`,headers);
 let overview=d.overview;if(!overview){const en=await json(`https://api.themoviedb.org/3/${path}?language=en-US`,headers);overview=en.overview;}
 const de=d.release_dates?.results?.find((x:Raw)=>x.iso_3166_1==='DE')?.release_dates?.find((x:Raw)=>x.certification)?.certification||d.content_ratings?.results?.find((x:Raw)=>x.iso_3166_1==='DE')?.rating;
 return {title:d.title||d.name,original_title:d.original_title||d.original_name,year:Number((d.release_date||d.first_air_date||d.air_date||'').slice(0,4))||undefined,summary:overview,countries:d.production_countries?.map((x:Raw)=>x.iso_3166_1)||d.origin_country,genres:tags(d.genres),directors:d.credits?.crew?.filter((x:Raw)=>x.job==='Director').map((x:Raw)=>x.name),actors:d.credits?.cast?.slice(0,10).map((x:Raw)=>x.name),certification:de?`FSK ${de}`:undefined,runtime:d.runtime||d.episode_run_time?.[0],poster:d.poster_path?`https://image.tmdb.org/t/p/w342${d.poster_path}`:d.still_path?`https://image.tmdb.org/t/p/w342${d.still_path}`:undefined};
}
let tvdbSession:{key:string;token:string;expires:number}|null=null;
async function tvdb(m:Raw):Promise<Raw|null>{const key=await getSetting('TVDB_API_KEY');if(!key||!m.ids.tvdb)return null;const pin=await getSetting('TVDB_PIN');if(!tvdbSession||tvdbSession.key!==key+pin||tvdbSession.expires<Date.now()){const auth=await json('https://api4.thetvdb.com/v4/login',{}, {apikey:key,...(pin?{pin}:{})});tvdbSession={key:key+pin,token:auth.data.token,expires:Date.now()+86400000};}
 const headers={Authorization:`Bearer ${tvdbSession.token}`},resource=m.kind==='episode'?'episodes':'series';const {data:d}=await json(`https://api4.thetvdb.com/v4/${resource}/${m.ids.tvdb}/extended`,headers);
 let translation:Raw={};try{translation=(await json(`https://api4.thetvdb.com/v4/${resource}/${m.ids.tvdb}/translations/deu`,headers)).data||{};}catch{/* Original language is a valid fallback. */}
 return {title:translation.name||d.name,original_title:d.name,year:Number((d.firstAired||d.aired||'').slice(0,4))||undefined,summary:translation.overview||d.overview,countries:d.originalCountry?[d.originalCountry]:undefined,genres:tags(d.genres),actors:d.characters?.filter((x:Raw)=>x.peopleType==='Actor').sort((a:Raw,b:Raw)=>(a.sort||0)-(b.sort||0)).slice(0,10).map((x:Raw)=>x.personName),directors:d.characters?.filter((x:Raw)=>x.peopleType==='Director').map((x:Raw)=>x.personName),runtime:d.runtime||d.averageRuntime,certification:d.contentRatings?.find((x:Raw)=>x.country==='deu'||x.country==='de')?.name,poster:d.image};
}
export async function enrichMedia(id:string) {
 const m=(await query('SELECT * FROM media WHERE id=$1',[id]))[0];if(!m)return;
 let available=false;const errors:string[]=[];
 if(await getSetting('PLEX_URL'))try{const p=await findPlex(m.ids,m.kind);if(p){await mergeMetadata(id,fromPlex(p));available=true;}}catch(e){errors.push((e as Error).message);}
 if(m.kind!=='movie'&&await getSetting('TVDB_API_KEY'))try{const d=await tvdb(m);if(d){await mergeMetadata(id,d,'tvdb');available=true;}}catch(e){errors.push((e as Error).message);}
 if(await getSetting('TMDB_TOKEN'))try{const d=await tmdb(m);if(d){await mergeMetadata(id,d,'tmdb');available=true;}}catch(e){errors.push((e as Error).message);}
 if(!available)throw Error(errors[0]||'Kein Metadatenanbieter eingerichtet oder keine passende Provider-ID.');
 await query('UPDATE media SET enriched_at=now() WHERE id=$1',[id]);
}
