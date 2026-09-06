import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="page empty">
      <h1>Dieser Titel fehlt im Programm.</h1>
      <Link className="button" href="/search">
        Zum Katalog
      </Link>
    </div>
  );
}
