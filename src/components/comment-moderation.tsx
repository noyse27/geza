'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CommentStatus } from '@/lib/review-comments';

type Row = {
  id: string; review_id: string; body: string; status: CommentStatus; moderation_reason: string | null;
  created_at: string; commenter_id: string; name: string; website: string | null; email: string;
  approved_count: number; blocked: boolean; media_id: string; title: string;
};

export function CommentSettings({ initial }: { initial: { enabled: boolean; comments: boolean; reactions: boolean; threshold: number } }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/admin/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', data: settings }),
    });
    const data = await response.json();
    setMessage(response.ok ? 'Einstellungen gespeichert.' : data.error);
    setBusy(false);
  }
  return (
    <section className="panel comment-settings">
      <h2>Kommentare & Reaktionen</h2>
      <p className="muted">Beim Abschalten bleiben alle vorhandenen Inhalte erhalten.</p>
      <label className="checkbox"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} /> Gesamtsystem aktiv</label>
      <label className="checkbox"><input type="checkbox" checked={settings.comments} onChange={(e) => setSettings({ ...settings, comments: e.target.checked })} /> Textkommentare erlauben</label>
      <label className="checkbox"><input type="checkbox" checked={settings.reactions} onChange={(e) => setSettings({ ...settings, reactions: e.target.checked })} /> Anonyme Reaktionen erlauben</label>
      <label className="threshold-field">Freigaben bis zur automatischen Veröffentlichung<input type="number" min={0} max={50} value={settings.threshold} onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) })} /></label>
      <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? 'Speichert …' : 'Speichern'}</button>
      {message && <p className="small" role="status">{message}</p>}
    </section>
  );
}

export function CommentModeration({ rows, status }: { rows: Row[]; status: CommentStatus }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();
  async function action(payload: object, key: string) {
    setBusy(key); setError('');
    try {
      const response = await fetch('/api/admin/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      router.refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <>
      <nav className="moderation-tabs" aria-label="Kommentarstatus">
        {([['pending', 'Offen'], ['published', 'Veröffentlicht'], ['spam', 'Spam'], ['rejected', 'Abgelehnt']] as const).map(([key, label]) => (
          <Link key={key} href={`/admin/comments?status=${key}`} className={status === key ? 'active' : ''}>{label}</Link>
        ))}
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      {!rows.length ? <div className="empty">In diesem Bereich gibt es keine Kommentare.</div> : rows.map((row) => (
        <article className="panel moderation-card" key={row.id}>
          <header>
            <div><strong>{row.name}</strong> · <a href={`mailto:${row.email}`}>{row.email}</a>{row.website && <> · <a href={row.website} target="_blank" rel="noreferrer">Website ↗</a></>}</div>
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</time>
          </header>
          <p className="muted small"><Link href={`/title/${row.media_id}`}>{row.title}</Link> · {row.approved_count} freigeschaltete Beiträge{row.blocked ? ' · gesperrt' : ''}{row.moderation_reason ? ` · ${row.moderation_reason}` : ''}</p>
          <p className="moderation-body">{row.body}</p>
          <div className="button-row">
            {row.status !== 'published' && <button className="button primary" disabled={!!busy} onClick={() => void action({ action: 'status', id: row.id, status: 'published' }, row.id)}>Freischalten</button>}
            {row.status !== 'rejected' && <button className="button" disabled={!!busy} onClick={() => void action({ action: 'status', id: row.id, status: 'rejected' }, row.id)}>Ablehnen</button>}
            {row.status !== 'spam' && <button className="button" disabled={!!busy} onClick={() => void action({ action: 'status', id: row.id, status: 'spam' }, row.id)}>Spam</button>}
            <button className="button" disabled={!!busy} onClick={() => void action({ action: 'block', commenterId: row.commenter_id, blocked: !row.blocked }, `block-${row.id}`)}>{row.blocked ? 'Entsperren' : 'Absender sperren'}</button>
            <button className="button danger" disabled={!!busy} onClick={() => confirm('Kommentar endgültig löschen?') && void action({ action: 'delete', id: row.id }, `delete-${row.id}`)}>Löschen</button>
          </div>
        </article>
      ))}
    </>
  );
}
