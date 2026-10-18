'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CircleHelp,
  Hand,
  Heart,
  Laugh,
  MessageSquareText,
  SmilePlus,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { PublicComment, ReactionKind, ReactionSummary } from '@/lib/review-comments';

const reactions: { id: ReactionKind; label: string; Icon: typeof ThumbsUp }[] = [
  { id: 'like', label: 'Gefällt mir', Icon: ThumbsUp },
  { id: 'dislike', label: 'Nicht meins', Icon: ThumbsDown },
  { id: 'love', label: 'Liebe ich', Icon: Heart },
  { id: 'laugh', label: 'Lustig', Icon: Laugh },
  { id: 'applause', label: 'Applaus', Icon: Hand },
  { id: 'confused', label: 'Verwirrt', Icon: CircleHelp },
];

export function ReviewDiscussion({
  reviewId,
  comments,
  initialReactions,
  commentsEnabled,
  reactionsEnabled,
}: {
  reviewId: string;
  comments: PublicComment[];
  initialReactions: ReactionSummary[];
  commentsEnabled: boolean;
  reactionsEnabled: boolean;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>(
    Object.fromEntries(initialReactions.map((item) => [item.reaction, item.count])),
  );
  const [selected, setSelected] = useState<ReactionKind | null>(
    initialReactions.find((item) => item.selected)?.reaction || null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [openedAt] = useState(() => Date.now());
  const router = useRouter();
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  async function react(reaction: ReactionKind) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, reaction }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Reaktion fehlgeschlagen.');
      setCounts(data.counts);
      setSelected(data.selected);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="review-discussion" aria-label="Reaktionen und Kommentare">
      <div className="review-discussion-actions">
        {reactionsEnabled && (
          <button
            type="button"
            className={`review-action${selected ? ' selected' : ''}`}
            aria-expanded={reactionOpen}
            onClick={() => setReactionOpen((value) => !value)}
          >
            <SmilePlus size={18} /> Reagieren{total ? ` · ${total}` : ''}
          </button>
        )}
        {commentsEnabled && (
          <button
            type="button"
            className="review-action"
            aria-expanded={commentOpen}
            onClick={() => setCommentOpen((value) => !value)}
          >
            <MessageSquareText size={18} /> Kommentieren{comments.length ? ` · ${comments.length}` : ''}
          </button>
        )}
      </div>
      {reactionOpen && reactionsEnabled && (
        <div className="reaction-picker" aria-label="Reaktion auswählen">
          {reactions.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              className={selected === id ? 'selected' : ''}
              aria-pressed={selected === id}
              title={label}
              onClick={() => void react(id)}
            >
              <Icon size={22} />
              <span>{counts[id] || 0}</span>
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>
      )}
      {!!comments.length && (
        <div className="public-comments">
          {comments.map((comment) => (
            <article key={comment.id} className="public-comment">
              <header>
                {comment.website ? (
                  <a href={comment.website} target="_blank" rel="ugc nofollow noreferrer">
                    {comment.name}
                  </a>
                ) : (
                  <strong>{comment.name}</strong>
                )}
                <time dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}
                </time>
              </header>
              <p>{comment.body}</p>
            </article>
          ))}
        </div>
      )}
      {commentOpen && commentsEnabled && (
        <form
          className="comment-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            const form = event.currentTarget;
            const values = new FormData(form);
            try {
              const response = await fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  reviewId,
                  name: values.get('name'),
                  email: values.get('email'),
                  website: values.get('website'),
                  body: values.get('body'),
                  company: values.get('company'),
                  openedAt,
                }),
              });
              const data = await response.json();
              if (!response.ok) throw Error(data.error || 'Kommentar konnte nicht gespeichert werden.');
              setMessage(data.message);
              form.reset();
              if (data.status === 'published') router.refresh();
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="comment-form-grid">
            <label>
              Name <span aria-hidden="true">*</span>
              <input name="name" required minLength={2} maxLength={100} autoComplete="name" />
            </label>
            <label>
              E-Mail <span aria-hidden="true">*</span>
              <input name="email" required type="email" maxLength={254} autoComplete="email" />
            </label>
            <label>
              Website <span className="muted">(optional)</span>
              <input name="website" type="url" maxLength={500} autoComplete="url" placeholder="https://" />
            </label>
          </div>
          <label>
            Kommentar <span aria-hidden="true">*</span>
            <textarea name="body" required minLength={2} maxLength={5000} rows={5} />
          </label>
          <label className="comment-honeypot" aria-hidden="true">
            Firma
            <input name="company" tabIndex={-1} autoComplete="off" />
          </label>
          <p className="muted small">Deine E-Mail-Adresse wird nicht veröffentlicht.</p>
          <button className="button primary" disabled={busy}>
            {busy ? 'Wird gesendet …' : 'Kommentar absenden'}
          </button>
        </form>
      )}
      {message && <p className="success small" role="status">{message}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
    </section>
  );
}
