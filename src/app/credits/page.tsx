export const metadata = { title: 'Daten & Quellen' };
export default function Page() {
  return (
    <div className="page prose">
      <span className="eyebrow accent">HINTER DEN KULISSEN</span>
      <h1>
        Daten & Quellen<span className="accent">.</span>
      </h1>
      <h2>Metadaten</h2>
      <p>
        Geza ergänzt Titelinformationen aus Plex sowie bei eingerichteter Verbindung aus TMDB und TheTVDB.
        Angaben können unvollständig sein.
      </p>
      <a href="https://www.themoviedb.org/" rel="noreferrer">
        <img className="tmdb-logo" src="/tmdb.svg" alt="TMDB" />
      </a>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <p>
        Serienmetadaten: <a href="https://thetvdb.com/">TheTVDB.com</a>.
      </p>
      <h2>Dein Tagebuch bleibt privat</h2>
      <p>
        Bewertungen und veröffentlichte Reviews sind öffentlich. Anschauereignisse, Watched-Status,
        Zeitpunkte, Wiederholungen und persönliche Statistiken bleiben hinter dem Login. Bewusst als
        Entwurf gespeicherte Reviews sind nur für den Administrator sichtbar.
      </p>
      <h2>Schrift</h2>
      <p>Syne wird lokal ausgeliefert. Für die Schrift werden keine Verbindungen zu Google aufgebaut.</p>
    </div>
  );
}
