import { getBucketlist } from '@/lib/catalog';
import { requireAdmin } from '@/lib/auth';
import { BucketlistTabs } from '@/components/bucketlist';
export const metadata = { title: 'Bucketliste', robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  const { movies, shows } = await getBucketlist();
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">NOCH UNGESEHEN</span>
        <h1>
          Bucketliste<span className="accent">.</span>
        </h1>
        <p>Als Nächstes auf der Liste.</p>
      </div>
      <BucketlistTabs movies={JSON.parse(JSON.stringify(movies))} shows={JSON.parse(JSON.stringify(shows))} />
    </div>
  );
}
