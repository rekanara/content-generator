// Smoke: live RSS fetch → context string (or null).
import { getNewsContext } from '../src/rss.ts';
import { sql } from '../src/db/pool.ts';
const c = await getNewsContext();
console.log(c ? `CONTEXT OK (${c.split('\n').length} lines):\n${c.slice(0, 300)}` : 'NULL — feeds unreachable');
await sql.end();
