import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query,pool } from '../src/lib/db';
import { searchCatalog,history } from '../src/lib/catalog';
test('public search cannot reveal private review terms or personal fields; keyset pages preserve tied events',async()=>{
 const suffix=crypto.randomUUID().replaceAll('-','');const term='privateterm'+suffix,publicTerm='publicterm'+suffix;let id:string|undefined;
 try{
 id=(await query("INSERT INTO media(kind,title,year,ids) VALUES('movie',$1,2020,$2) RETURNING id",['Test '+suffix,JSON.stringify({imdb:'tt'+suffix})]))[0].id;
 await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,8,now(),'test')",[id]);
 const review=(await query("INSERT INTO reviews(media_id,source,source_id,body) VALUES($1,'test',$2,$3) RETURNING id",[id,suffix,term])).at(0)!;
 const p=new URLSearchParams({q:term});assert.equal((await searchCatalog(p,false)).items.length,0);
 const privateResult=await searchCatalog(p,true);assert.equal(privateResult.items[0].id,id);assert.equal(privateResult.items[0].rating,8);
 await query('UPDATE reviews SET is_public=true,body=$1 WHERE id=$2',[publicTerm,review.id]);
 const pub=await searchCatalog(new URLSearchParams({q:publicTerm}),false);assert.equal(pub.items[0].id,id);for(const forbidden of ['rating','watched_at','watch_count','last_watched_at'])assert.equal(forbidden in pub.items[0],false);
 await query('UPDATE reviews SET is_public=false WHERE id=$1',[review.id]);assert.equal((await searchCatalog(new URLSearchParams({q:publicTerm}),false)).items.length,0);
 for(let i=0;i<3;i++)await query("INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'test',$2,'2199-01-01T12:00:00Z')",[id,suffix+i]);
 const first=await history(new URLSearchParams(),2);assert.equal(first.items.length,2);assert.ok(first.cursor);const second=await history(new URLSearchParams({cursor:first.cursor!}),2);assert.ok(!second.items.some(x=>first.items.some(y=>y.watch_id===x.watch_id)));
 }finally{if(id){await query('DELETE FROM reviews WHERE media_id=$1',[id]);await query('DELETE FROM ratings WHERE media_id=$1',[id]);await query('DELETE FROM watches WHERE media_id=$1',[id]);await query('DELETE FROM media WHERE id=$1',[id]);}await pool.end();}
});
