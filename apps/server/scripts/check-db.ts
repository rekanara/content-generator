import { sql } from '../src/db.ts';
const u = await sql`select id, username, role from users`;
console.log('users:', JSON.stringify(u));
const g = await sql`select slug, user_id from groups`;
console.log('groups:', JSON.stringify(g));
const p = await sql`select count(*)::int as n from pillars`;
console.log('pillars:', p[0]?.n);
process.exit(0);
