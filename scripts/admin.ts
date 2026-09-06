import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { query, pool } from '../src/lib/db';
import { hashPassword } from '../src/lib/security';
if((await query('SELECT 1 FROM admin_account')).length) { console.log('Admin exists. No changes made.'); } else {
 const password=randomBytes(18).toString('base64url');
 await query('INSERT INTO admin_account(id,username,password_hash) VALUES(1,$1,$2)',['admin',hashPassword(password)]);
 await mkdir('data',{recursive:true}); await writeFile('data/admin-access.txt',`Geza lokal: http://localhost:3080\nBenutzername: admin\nPasswort: ${password}\n`,{mode:0o600});
 console.log('Admin created. Credentials saved to data/admin-access.txt (excluded from Git).');
}
await pool.end();
