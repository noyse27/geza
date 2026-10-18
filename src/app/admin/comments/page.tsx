import { requireAdmin } from '@/lib/auth';
import { commentSettings, moderationComments, type CommentStatus } from '@/lib/review-comments';
import { CommentModeration, CommentSettings } from '@/components/comment-moderation';

export const metadata = { title: 'Kommentare', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const requested = (await searchParams).status;
  const status: CommentStatus = ['published', 'spam', 'rejected'].includes(requested || '')
    ? requested as CommentStatus
    : 'pending';
  const [settings, comments] = await Promise.all([commentSettings(), moderationComments(status)]);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">IM GESPRÄCH</span>
        <h1>Kommentare<span className="accent">.</span></h1>
        <p>Beiträge prüfen, Absender verwalten und Reaktionen steuern.</p>
      </div>
      <CommentSettings initial={settings} />
      <CommentModeration rows={JSON.parse(JSON.stringify(comments))} status={status} />
    </div>
  );
}
