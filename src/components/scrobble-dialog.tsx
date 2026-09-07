'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';

type Item = { id: string; title: string; kind: string; year?: number; season?: number; episode?: number };
type Pending = {
  id: string;
  title: string;
  kind: string;
  show_title?: string;
  season?: string;
  episode?: string;
  error: string;
  request_id?: string;
  viewed_at?: string;
  received_at: string;
};
function berlin(at: Date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .split(' ');
  return { date: parts[0], time: parts[1] };
}
export function ScrobbleDialog({ initialCount }: { initialCount: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<'new' | 'inbox'>('new');
  const [count, setCount] = useState(initialCount),
    [pending, setPending] = useState<Pending[]>([]);
  const [job, setJob] = useState<Pending | null>(null),
    [term, setTerm] = useState('');
  const [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<Item | null>(null);
  const [episodes, setEpisodes] = useState<Item[]>([]),
    [season, setSeason] = useState(''),
    [episode, setEpisode] = useState('');
  const [date, setDate] = useState(''),
    [time, setTime] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const eventId = useRef('');
  async function read(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Laden fehlgeschlagen.');
    return data.items;
  }
  function reset(nextJob: Pending | null = null) {
    setJob(nextJob);
    setSelected(null);
    setEpisodes([]);
    setSeason('');
    setEpisode('');
    setTerm(nextJob?.show_title || nextJob?.title || '');
    setItems([]);
    setError('');
    setSuccess(false);
    const at =
      nextJob?.viewed_at && Number.isFinite(Number(nextJob.viewed_at))
        ? new Date(Number(nextJob.viewed_at) * 1000)
        : nextJob
          ? new Date(nextJob.received_at)
          : new Date();
    const local = berlin(Number.isFinite(at.getTime()) ? at : new Date());
    setDate(local.date);
    setTime(nextJob?.viewed_at ? local.time : '');
    eventId.current = crypto.randomUUID();
  }
  function show() {
    reset();
    setMode('new');
    setOpen(true);
    dialog.current?.showModal();
  }
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    read('/api/admin/scrobbles?mode=inbox', controller.signal)
      .then((rows) => {
        setPending(rows);
        setCount(rows.length);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    if (!open || (mode === 'inbox' && !job)) return;
    const controller = new AbortController();
    setItems([]);
    if (term.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      read('/api/admin/scrobbles?q=' + encodeURIComponent(term), controller.signal)
        .then(setItems)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, open, mode, job]);
  useEffect(() => {
    setEpisodes([]);
    setSeason('');
    setEpisode('');
    if (selected?.kind !== 'show') return;
    const controller = new AbortController();
    read('/api/admin/scrobbles?parent=' + selected.id, controller.signal)
      .then(setEpisodes)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/scrobbles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: selected?.kind === 'show' ? episode : selected?.id,
          date,
          time: time || undefined,
          eventId: eventId.current,
          jobId: job?.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Speichern fehlgeschlagen.');
      try {
        sessionStorage.setItem('history:invalidated', String(Date.now()));
      } catch {
        /* optional cache */
      }
      if (job) {
        setPending((rows) => rows.filter((row) => row.id !== job.id));
        setCount((n) => Math.max(0, n - 1));
      }
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    dialog.current?.close();
  }
  const target = selected?.kind === 'show' ? episodes.find((e) => e.id === episode) : selected;
  return (
    <>
      <button
        className="scrobble-add"
        aria-label={`Scrobble anlegen${count ? `, ${count} offene Scrobbles` : ''}`}
        onClick={show}
        title="Scrobble anlegen oder zuordnen"
      >
        <Plus size={24} aria-hidden="true" />
        {count > 0 && <span className="scrobble-badge">{count}</span>}
      </button>
      <dialog
        ref={dialog}
        className="scrobble-dialog"
        aria-labelledby="scrobble-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => {
          setOpen(false);
          if (success) window.location.assign('/history');
        }}
      >
        <div className="scrobble-heading">
          <div>
            <span className="eyebrow accent">DEIN FILMTAGEBUCH</span>
            <h2 id="scrobble-title">
              Scrobbles<span className="accent">.</span>
            </h2>
          </div>
          <button className="icon-button" aria-label="Schließen" onClick={close} disabled={busy}>
            <X />
          </button>
        </div>
        <div className="segmented">
          <button
            className={mode === 'new' ? 'active' : ''}
            disabled={busy || success}
            onClick={() => {
              reset();
              setMode('new');
            }}
          >
            Neu anlegen
          </button>
          <button
            className={mode === 'inbox' ? 'active' : ''}
            disabled={busy || success}
            onClick={() => {
              reset();
              setMode('inbox');
            }}
          >
            Offene Scrobbles ({count})
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {success ? (
          <div className="scrobble-success" role="status">
            <Check size={32} />
            <h3>In deiner History gespeichert.</h3>
            <button className="button primary" onClick={close}>
              History anzeigen
            </button>
          </div>
        ) : mode === 'inbox' && !job ? (
          <div className="scrobble-inbox">
            <p className="muted">
              Diese Plex-Ereignisse konnten nicht abgeschlossen werden. Wähle den passenden Film oder die
              Episode, um sie in deiner History zu speichern.
            </p>
            {!pending.length && <p>Keine offenen Scrobbles.</p>}
            {pending.map((row) => (
              <section className="panel" key={row.id}>
                <strong>
                  {row.show_title ? row.show_title + ' · ' : ''}
                  {row.title}
                </strong>
                <p className="muted">
                  {row.season != null
                    ? `Staffel ${row.season} · Episode ${row.episode ?? '?'}`
                    : row.kind === 'movie'
                      ? 'Film'
                      : 'Episode'}
                </p>
                <p className="error">{row.error}</p>
                <button className="button" onClick={() => reset(row)}>
                  Zuordnen
                </button>{' '}
                {row.request_id && (
                  <a
                    href={'/admin/logs?requestId=' + encodeURIComponent(row.request_id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Anfrageverlauf ↗
                  </a>
                )}
              </section>
            ))}
          </div>
        ) : (
          <form onSubmit={save}>
            {job && (
              <div className="panel">
                <strong>
                  Empfangen: {job.show_title ? job.show_title + ' · ' : ''}
                  {job.title}
                </strong>
                <p>Ordne dieses Ereignis einem Titel zu. Die Provider-IDs im Katalog bleiben erhalten.</p>
              </div>
            )}
            <label className="scrobble-field">
              <span>
                <Search size={16} /> Film oder Serie suchen
              </span>
              <input
                value={term}
                disabled={busy}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setSelected(null);
                }}
                placeholder="Titel im Geza-Katalog …"
              />
            </label>
            {!selected && (
              <div className="scrobble-results" aria-live="polite">
                {loading ? (
                  <p>Suche …</p>
                ) : (
                  items
                    .filter(
                      (item) =>
                        !job || (job.kind === 'episode' ? item.kind === 'show' : item.kind === 'movie'),
                    )
                    .map((item) => (
                      <button type="button" key={item.id} onClick={() => setSelected(item)}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.year || 'Jahr unbekannt'} · {item.kind === 'show' ? 'Serie' : 'Film'} · #
                          {item.id}
                        </span>
                      </button>
                    ))
                )}
                {!loading && term.length >= 2 && !items.length && (
                  <p>Kein Treffer im vorhandenen Katalog. Versuche auch den Originaltitel.</p>
                )}
              </div>
            )}
            {selected && (
              <p className="accent">
                Ausgewählt: {selected.title} {selected.year ? `(${selected.year})` : ''}
              </p>
            )}
            {selected?.kind === 'show' && (
              <div className="form-grid">
                <label>
                  Staffel
                  <select
                    required
                    value={season}
                    disabled={busy}
                    onChange={(e) => {
                      setSeason(e.target.value);
                      setEpisode('');
                    }}
                  >
                    <option value="">Bitte wählen</option>
                    {[...new Set(episodes.map((e) => e.season).filter((s) => s != null))].map((s) => (
                      <option key={s} value={s}>
                        {s === 0 ? 'Extras / Staffel 0' : `Staffel ${s}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Episode
                  <select
                    required
                    value={episode}
                    disabled={busy || season === ''}
                    onChange={(e) => setEpisode(e.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {episodes
                      .filter((e) => String(e.season) === season)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.episode} · {e.title} (#{e.id})
                        </option>
                      ))}
                  </select>
                </label>
                {!episodes.length && (
                  <p className="muted">Für diese Serie sind noch keine Episoden im Katalog verfügbar.</p>
                )}
              </div>
            )}
            <div className="form-grid">
              <label>
                Gesehen am
                <input
                  required
                  type="date"
                  value={date}
                  disabled={busy}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Uhrzeit (optional)
                <input
                  type="time"
                  step="1"
                  value={time}
                  disabled={busy}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              Zeitzone: Berlin. Ohne Uhrzeit wird der Zeitpunkt als geschätzt gespeichert.
            </p>
            {target && (
              <p>
                {target.title} · {date}
                {time ? ` um ${time}` : ''}
              </p>
            )}
            <button className="button primary" disabled={busy || !target}>
              {busy ? 'Wird gespeichert …' : job ? 'Zuordnen und Scrobble speichern' : 'Scrobble speichern'}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
