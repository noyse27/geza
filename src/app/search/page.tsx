import { searchCatalog } from '@/lib/catalog';
import { isAdmin } from '@/lib/auth';
import { CatalogBrowser } from '@/components/catalog';
export const metadata={title:'Suche',robots:{index:false,follow:true}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}) {const p=new URLSearchParams(await searchParams);const result=await searchCatalog(p,await isAdmin());return <div className="page"><div className="page-heading"><span className="eyebrow accent">FINDE DEINE GESCHICHTE</span><h1>Suche<span className="accent">.</span></h1></div><CatalogBrowser result={JSON.parse(JSON.stringify(result))}/></div>;}
