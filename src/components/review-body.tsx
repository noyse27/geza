import { Globe, LockKeyhole } from 'lucide-react';
import { renderReviewBody } from '@/lib/review-links';
import type { Review } from './editor';
export async function ReviewBody({ review, admin = false }: { review: Review; admin?: boolean }) {
  const content = await renderReviewBody(review.body);
  return (
    <article className="review">
      <div className="review-meta">
        <span>Persönliche Perspektive</span>
        {admin && (
          <span>
            {review.is_public ? (
              <>
                <Globe size={13} /> Öffentlich
              </>
            ) : (
              <>
                <LockKeyhole size={13} /> Privat
              </>
            )}
          </span>
        )}
        {review.parent_source_id && <span>Antwort auf einen Kommentar</span>}
      </div>
      {review.spoiler ? (
        <details>
          <summary>Spoiler anzeigen</summary>
          <p className="review-text">{content}</p>
        </details>
      ) : (
        <p className="review-text">{content}</p>
      )}
    </article>
  );
}
