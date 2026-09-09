import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Run in Docker with DATABASE_URL. Only temporary databases are modified.
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const existing of [false, true]) {
    const name = `geza_review_migration_${Date.now()}_${existing ? 'upgrade' : 'fresh'}`;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = '/' + name;
    let target: pg.Client | undefined;
    try {
      await source.query(`CREATE DATABASE ${name}`);
      // Await the connection's actual end before dropping its database. Pool.end()
      // can finish while an idle socket is still closing, racing DROP ... FORCE.
      target = new pg.Client({ connectionString: url.toString() });
      await target.connect();
      await target.query(
        'CREATE TABLE migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
      );
      for (const file of (await readdir('migrations'))
        .filter((f) => f.endsWith('.sql') && f < '009')
        .sort()) {
        await target.query(await readFile('migrations/' + file, 'utf8'));
        await target.query('INSERT INTO migrations(name) VALUES($1)', [file]);
      }
      if (existing) {
        const {
          rows: [media],
        } = await target.query("INSERT INTO media(kind,title) VALUES('movie','Migration test') RETURNING id");
        await target.query(
          `INSERT INTO friend_reviews(media_id,provider,name,url,rating,scale,manual)
          VALUES($1,'filmdienst','Filmdienst.de','https://www.filmdienst.de/film/details/123/test',3.5,5,true),
                ($1,'wortvogel','wortvogel.de','https://wortvogel.de/test',NULL,5,true),
                ($1,'custom-test','Meine Quelle','https://example.org/review',8,10,true)`,
          [media.id],
        );
      }
      const before = (await target.query('SELECT * FROM friend_reviews ORDER BY provider')).rows;
      const migrate = () => {
        const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
          env: { ...process.env, DATABASE_URL: url.toString() },
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
      };
      migrate();
      assert.deepEqual(
        (await target.query('SELECT provider FROM review_boxes ORDER BY provider')).rows.map(
          (r) => r.provider,
        ),
        existing ? ['custom-test', 'filmdienst', 'wortvogel'] : [],
      );
      assert.deepEqual((await target.query('SELECT * FROM friend_reviews ORDER BY provider')).rows, before);
      await target.query(
        "INSERT INTO review_boxes(provider,name,scale) VALUES('custom-later','Später hinzugefügt',10)",
      );
      await target.query("DELETE FROM review_boxes WHERE provider='wortvogel'");
      const configured = (await target.query('SELECT * FROM review_boxes ORDER BY provider')).rows;
      migrate();
      assert.deepEqual((await target.query('SELECT * FROM review_boxes ORDER BY provider')).rows, configured);
      assert.deepEqual((await target.query('SELECT * FROM friend_reviews ORDER BY provider')).rows, before);
      console.log(
        `PASS: ${existing ? 'upgrade preserves providers, links and ratings' : 'fresh installation has no boxes'}; repeated migration preserves admin changes.`,
      );
    } finally {
      await target?.end();
      await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }
} finally {
  await source.end();
}
