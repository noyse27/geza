ALTER TABLE media ADD COLUMN season_completed_at timestamptz;
ALTER TABLE media ADD COLUMN season_completion_source text;
ALTER TABLE media ADD COLUMN season_completion_derived boolean NOT NULL DEFAULT false;

ALTER TABLE job_runs ADD COLUMN viewed_at timestamptz;
CREATE INDEX job_runs_retention ON job_runs(status,finished_at,id);

-- A completion is derived only when every currently released episode has a dated
-- viewing. Plex presence without a date remains useful evidence, but must not
-- invent a timestamp.
CREATE OR REPLACE FUNCTION refresh_season_completions(show_ids bigint[] DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
WITH episode_first_views AS (
  SELECT CASE WHEN p.kind='season' THEN p.parent_id ELSE e.parent_id END AS show_id,e.season,e.id,
    min(w.watched_at) FILTER (WHERE w.watched_at IS NOT NULL) AS first_viewed_at,
    bool_or(w.source LIKE 'plex%') FILTER (WHERE w.watched_at IS NOT NULL) AS has_plex_date
  FROM media e JOIN media p ON p.id=e.parent_id LEFT JOIN watches w ON w.media_id=e.id
  WHERE e.kind='episode' AND e.season IS NOT NULL
    AND (e.air_date IS NULL OR e.air_date<=CURRENT_DATE)
    AND (show_ids IS NULL OR CASE WHEN p.kind='season' THEN p.parent_id ELSE e.parent_id END=ANY(show_ids))
  GROUP BY CASE WHEN p.kind='season' THEN p.parent_id ELSE e.parent_id END,e.season,e.id
), completed AS (
  SELECT show_id,season,max(first_viewed_at) AS completed_at,
    bool_or(COALESCE(has_plex_date,false)) AS has_plex_date
  FROM episode_first_views
  GROUP BY show_id,season
  HAVING count(*)>0 AND count(first_viewed_at)=count(*)
)
UPDATE media s SET
  season_completed_at=c.completed_at,
  season_completion_source=CASE WHEN c.has_plex_date THEN 'plex' ELSE 'derived' END,
  season_completion_derived=true
FROM completed c
WHERE s.kind='season' AND s.parent_id=c.show_id AND s.season=c.season
  AND (s.season_completed_at IS DISTINCT FROM c.completed_at
    OR s.season_completion_source IS DISTINCT FROM CASE WHEN c.has_plex_date THEN 'plex' ELSE 'derived' END
    OR NOT s.season_completion_derived);

UPDATE media s SET season_completed_at=NULL,season_completion_source=NULL,season_completion_derived=false
WHERE s.kind='season' AND (show_ids IS NULL OR s.parent_id=ANY(show_ids))
  AND s.season_completion_derived
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT CASE WHEN p.kind='season' THEN p.parent_id ELSE e.parent_id END AS parent_id,e.season
      FROM media e JOIN media p ON p.id=e.parent_id LEFT JOIN watches w ON w.media_id=e.id AND w.watched_at IS NOT NULL
      WHERE e.kind='episode' AND e.season IS NOT NULL
        AND (e.air_date IS NULL OR e.air_date<=CURRENT_DATE)
      GROUP BY CASE WHEN p.kind='season' THEN p.parent_id ELSE e.parent_id END,e.season
      HAVING count(*)>0 AND count(DISTINCT w.media_id)=count(DISTINCT e.id)
    ) c WHERE c.parent_id=s.parent_id AND c.season=s.season
  );
$$;

SELECT refresh_season_completions();

-- Repair the old webhook bug only where the orphan has no dependent content
-- except a personal rating and exactly one canonical season can be identified.
CREATE TEMP TABLE repairable_orphan_seasons(old_id bigint PRIMARY KEY,new_id bigint NOT NULL,plex_id text NOT NULL) ON COMMIT DROP;
INSERT INTO repairable_orphan_seasons
SELECT orphan.id,min(season.id),orphan.ids->>'plex'
FROM media orphan
JOIN media show ON show.kind='show' AND (
  (orphan.ids ? 'imdb' AND show.ids->>'imdb'=orphan.ids->>'imdb') OR
  (orphan.ids ? 'tmdb' AND show.ids->>'tmdb'=orphan.ids->>'tmdb') OR
  (orphan.ids ? 'tvdb' AND show.ids->>'tvdb'=orphan.ids->>'tvdb'))
JOIN media season ON season.kind='season' AND season.parent_id=show.id AND season.season=orphan.season
WHERE orphan.kind='season' AND orphan.parent_id IS NULL AND orphan.ids ? 'plex'
  AND NOT EXISTS(SELECT 1 FROM friend_reviews WHERE media_id=orphan.id)
GROUP BY orphan.id
HAVING count(DISTINCT season.id)=1;

UPDATE watches w SET media_id=fix.new_id FROM repairable_orphan_seasons fix WHERE w.media_id=fix.old_id;
UPDATE reviews r SET media_id=fix.new_id FROM repairable_orphan_seasons fix WHERE r.media_id=fix.old_id;
UPDATE job_results r SET media_id=fix.new_id FROM repairable_orphan_seasons fix WHERE r.media_id=fix.old_id;
UPDATE feed_entries r SET media_id=fix.new_id FROM repairable_orphan_seasons fix WHERE r.media_id=fix.old_id;
UPDATE plex_match_decisions r SET media_id=fix.new_id FROM repairable_orphan_seasons fix WHERE r.media_id=fix.old_id;
UPDATE media child SET parent_id=fix.new_id FROM repairable_orphan_seasons fix WHERE child.parent_id=fix.old_id;
INSERT INTO posters(media_id,content_type,data)
SELECT fix.new_id,p.content_type,p.data FROM repairable_orphan_seasons fix JOIN posters p ON p.media_id=fix.old_id
ON CONFLICT(media_id) DO NOTHING;
DELETE FROM posters WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO film_series_members(series_id,media_id,position)
SELECT f.series_id,fix.new_id,f.position FROM repairable_orphan_seasons fix JOIN film_series_members f ON f.media_id=fix.old_id
ON CONFLICT DO NOTHING;
DELETE FROM film_series_members WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO friend_instance_cache(friend_id,media_id,found,rating,has_review,url,error,fetched_at)
SELECT c.friend_id,fix.new_id,c.found,c.rating,c.has_review,c.url,c.error,c.fetched_at
FROM repairable_orphan_seasons fix JOIN friend_instance_cache c ON c.media_id=fix.old_id
ON CONFLICT(friend_id,media_id) DO UPDATE SET
  found=excluded.found,rating=excluded.rating,has_review=excluded.has_review,url=excluded.url,
  error=excluded.error,fetched_at=excluded.fetched_at
WHERE friend_instance_cache.fetched_at<excluded.fetched_at;
DELETE FROM friend_instance_cache WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO media_view_totals(media_id,views,last_viewed_at)
SELECT fix.new_id,v.views,v.last_viewed_at FROM repairable_orphan_seasons fix JOIN media_view_totals v ON v.media_id=fix.old_id
ON CONFLICT(media_id) DO UPDATE SET
  views=media_view_totals.views+excluded.views,
  last_viewed_at=greatest(media_view_totals.last_viewed_at,excluded.last_viewed_at);
DELETE FROM media_view_totals WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO media_view_dedup(media_id,viewed_on,visitor_hash,created_at)
SELECT fix.new_id,v.viewed_on,v.visitor_hash,v.created_at
FROM repairable_orphan_seasons fix JOIN media_view_dedup v ON v.media_id=fix.old_id
ON CONFLICT(media_id,viewed_on,visitor_hash) DO NOTHING;
DELETE FROM media_view_dedup WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO provider_ratings(media_id,provider,rating,url,votes,updated_at)
SELECT fix.new_id,r.provider,r.rating,r.url,r.votes,r.updated_at
FROM repairable_orphan_seasons fix JOIN provider_ratings r ON r.media_id=fix.old_id
ON CONFLICT(media_id,provider) DO UPDATE SET
  rating=excluded.rating,url=excluded.url,votes=excluded.votes,updated_at=excluded.updated_at
WHERE provider_ratings.updated_at<excluded.updated_at;
DELETE FROM provider_ratings WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
INSERT INTO ratings(media_id,rating,rated_at,source)
SELECT fix.new_id,r.rating,r.rated_at,r.source FROM repairable_orphan_seasons fix JOIN ratings r ON r.media_id=fix.old_id
ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=excluded.rated_at,source=excluded.source
WHERE ratings.rated_at<excluded.rated_at;
DELETE FROM ratings WHERE media_id IN (SELECT old_id FROM repairable_orphan_seasons);
DELETE FROM media WHERE id IN (SELECT old_id FROM repairable_orphan_seasons);
UPDATE media target SET ids=target.ids||jsonb_build_object('plex',fix.plex_id)
FROM repairable_orphan_seasons fix WHERE target.id=fix.new_id;
