'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function ReviewBoxAdmin({
  boxes,
  modules,
}: {
  boxes: { provider: string; name: string; scale: number }[];
  modules: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(action: string, data: object) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
      });
      if (!response.ok) throw Error('Bitte Eingaben prüfen.');
      setOpen(false);
      setSelected('');
      setEditing('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Reviewanbieter</h2>
      <p>
        Diese Reviewboxen erscheinen auf allen Filmseiten. Automatische Anbieter suchen beim Aufruf eines
        Films im Hintergrund nach dem passenden Review.
      </p>
      <button className="button" disabled={busy} onClick={() => setOpen(!open)}>
        ＋ Neu
      </button>
      {open && (
        <form
          className="review-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void save('review-box-add', {
              provider: selected === 'custom' ? 'custom-' + crypto.randomUUID() : selected,
              name: data.get('name'),
              scale: Number(data.get('scale') || 5),
            });
          }}
        >
          <label>
            Reviewanbieter
            <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Anbieter auswählen …</option>
              {modules
                .filter((module) => !boxes.some((box) => box.provider === module.id))
                .map((module) => (
                  <option value={module.id} key={module.id}>
                    {module.name}
                  </option>
                ))}
              <option value="custom">Eigener Anbieter (manuell)</option>
            </select>
          </label>
          {selected === 'custom' && (
            <>
              <label>
                Name der Quelle
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Maximale Sterne / Punkte
                <input name="scale" type="number" required min="1" max="100" defaultValue="5" />
              </label>
            </>
          )}
          <button className="button primary" disabled={busy || !selected}>
            Reviewbox erstellen
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!boxes.length && <p className="muted">Keine Reviewanbieter konfiguriert.</p>}
      <div className="friend-grid">
        {boxes.map((box) => {
          const isModule = modules.some((module) => module.id === box.provider);
          return (
            <article className="panel" key={box.provider}>
              <h3>{box.name}</h3>
              <p className="muted">
                {isModule ? 'Automatische Reviews' : 'Manuelle Reviews'} · {box.scale} Punkte
              </p>
              {editing === box.provider ? (
                <form
                  className="review-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void save('review-box-edit', {
                      provider: box.provider,
                      name: data.get('name'),
                      scale: Number(data.get('scale') || 5),
                    });
                  }}
                >
                  <label>
                    Name der Quelle
                    <input name="name" required maxLength={100} defaultValue={box.name} />
                  </label>
                  <label>
                    Maximale Sterne / Punkte
                    <input name="scale" type="number" required min="1" max="100" defaultValue={box.scale} />
                  </label>
                  <button className="button primary" disabled={busy}>
                    Speichern
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => setEditing('')}
                  >
                    Abbrechen
                  </button>
                </form>
              ) : (
                <div className="button-row">
                  {!isModule && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        setEditing(box.provider);
                      }}
                    >
                      Bearbeiten
                    </button>
                  )}
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => void save('review-box-delete', { provider: box.provider })}
                  >
                    Reviewanbieter löschen
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
