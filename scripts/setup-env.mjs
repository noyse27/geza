import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env exists, keeping configuration.');
  process.exit(0);
}
const password = randomBytes(20).toString('hex');
writeFileSync(
  '.env',
  `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://geza:${password}@localhost:5439/geza\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nPUBLIC_URL=\nGEZA_PORT=3080\nPLEX_WEBHOOK_SECRET=${randomBytes(24).toString('hex')}\n`,
  { mode: 0o600 },
);
console.log('Created .env with random credentials.');
