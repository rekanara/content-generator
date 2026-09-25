// Migration runner: applies db/migrations/*.sql in order, tracked in schema_migrations.
// Run: tsx src/db/migrate.ts (or npm run migrate -w apps/server)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sql } from './pool.ts';

export async function migrate(): Promise<void> {
  await sql`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now()
  )`;
  const dir = join(import.meta.dirname, '..', '..', 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await sql`select name from schema_migrations`).map((r: any) => r.name),
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log(`[migrate] applied ${f}`);
  }
  await seedAdmin();
}

// Seeder: no users → create admin + claim orphan groups.
// Dynamic import of auth (auth imports sql from pool — avoids a static circular dep).
async function seedAdmin(): Promise<void> {
  const seed = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  if ((seed[0]?.n ?? 0) > 0) return;
  const { hashPassword } = await import('../auth/password.ts');
  const pass = process.env.CG_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const hash = await hashPassword(pass);
  const [admin] = await sql`insert into users (username, password_hash, role) values ('admin', ${hash}, 'admin') returning id`;
  const claimed = await sql`update groups set user_id = ${admin!.id} where user_id is null returning slug`;
  console.log(`[seed] admin user created — password: ${pass}`);
  if (claimed.length > 0) console.log(`[seed] ${claimed.length} groups assigned to admin: ${claimed.map((g) => g.slug).join(', ')}`);
}

if (process.argv[1]!.endsWith('migrate.ts')) {
  migrate()
    .then(() => { console.log('[migrate] done'); return sql.end(); })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
