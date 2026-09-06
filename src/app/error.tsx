'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="page empty"><h1>Kurze Unterbrechung.</h1><p>Diese Ansicht konnte gerade nicht geladen werden.</p><button className="button primary" onClick={reset}>Erneut versuchen</button></div>;}
