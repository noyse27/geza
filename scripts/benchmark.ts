import { searchCatalog } from '../src/lib/catalog';
import { pool } from '../src/lib/db';
const terms = [
  'dark',
  'arrival',
  'star',
  'alien',
  'the',
  'a',
  'tt11366674',
  'Doppelhaushälfte',
  'sherlock',
  'keinpassendertitel',
];
const samples: number[] = [];
for (let round = 0; round < 10; round++) {
  await Promise.all(
    terms.map(async (q) => {
      const start = performance.now();
      await searchCatalog(new URLSearchParams({ q, live: '1' }), false);
      samples.push(performance.now() - start);
    }),
  );
}
samples.sort((a, b) => a - b);
const p = (n: number) =>
  Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * n))] * 10) / 10;
console.log(
  JSON.stringify(
    {
      mode: 'public search, 10 concurrent requests',
      samples: samples.length,
      p50_ms: p(0.5),
      p95_ms: p(0.95),
      max_ms: p(1),
      target_p95_ms: 150,
    },
    null,
    2,
  ),
);
await pool.end();
if (p(0.95) > 150) process.exitCode = 1;
