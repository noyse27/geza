import Link from 'next/link';
import { IdCorrection } from './id-correction';
import { query } from '@/lib/db';
export async function JobConflict({ details }: { details: Record<string, any> }) {
  const candidates = Array.isArray(details.matches) ? details.matches : [];
  if (!candidates.length && !details.providerIds) return null;
  const providers = ['imdb', 'tmdb', 'tvdb', 'plex'];
  const ids = candidates.map((m: any) => String(m.id)).filter((id: string) => /^\d+$/.test(id));
  const current = ids.length
    ? await query('SELECT id,title,ids FROM media WHERE id=ANY($1::bigint[])', [ids])
    : [];
  return (
    <div className="job-conflict">
      <p>
        Vergleiche die Anbieter-IDs. Markierte Werte unterscheiden sich von der empfangenen Plex-ID. Gleiche
        Plex-IDs allein beweisen nicht, dass es derselbe Titel ist.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Titel / Quelle</th>
              {providers.map((p) => (
                <th key={p}>{p.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Empfangen aus Plex</th>
              {providers.map((p) => (
                <td key={p}>{details.providerIds?.[p] || '—'}</td>
              ))}
            </tr>
            {candidates.map((m: any, i: number) => (
              <tr key={i}>
                <th>
                  {/^\d+$/.test(String(m.id)) ? (
                    <Link href={`/title/${m.id}?new=1`}>
                      {m.title || `Titel ${m.id}`} {m.year || ''} – bearbeiten
                    </Link>
                  ) : (
                    m.title
                  )}
                </th>
                {providers.map((p) => (
                  <td
                    key={p}
                    className={
                      details.providerIds?.[p] &&
                      m.ids?.[p] &&
                      String(m.ids[p]) !== String(details.providerIds[p])
                        ? 'error'
                        : ''
                    }
                  >
                    {m.ids?.[p] || '—'}
                    {details.providerIds?.[p] &&
                    m.ids?.[p] &&
                    String(m.ids[p]) !== String(details.providerIds[p])
                      ? ' (abweichend)'
                      : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current.length > 0 && (
        <p className="small muted">
          Die Tabelle zeigt den Stand beim Ereignis. Die folgenden Formulare bearbeiten die aktuell
          gespeicherten IDs.
        </p>
      )}
      {current.map((m) => (
        <div key={m.id}>
          <p>{m.title || `Titel ${m.id}`}</p>
          <IdCorrection mediaId={String(m.id)} ids={m.ids} />
        </div>
      ))}
    </div>
  );
}
