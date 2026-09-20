// postgres.js pool + migration runner + state/pillars helpers.
// Run migrations: tsx src/db.ts migrate (or npm run migrate -w apps/server)
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.ts';
import type { RotationState, Slot } from './state.ts';

export const sql = postgres({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export async function migrate(): Promise<void> {
  await sql`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now()
  )`;
  const dir = join(import.meta.dirname, '..', 'db', 'migrations');
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
// Dynamic import of auth.ts (auth imports sql from here — avoids a static circular dep).
async function seedAdmin(): Promise<void> {
  const seed = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  if ((seed[0]?.n ?? 0) > 0) return;
  const { hashPassword } = await import('./auth.ts');
  const pass = process.env.CG_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const hash = await hashPassword(pass);
  const [admin] = await sql`insert into users (username, password_hash, role) values ('admin', ${hash}, 'admin') returning id`;
  const claimed = await sql`update groups set user_id = ${admin!.id} where user_id is null returning slug`;
  console.log(`[seed] admin user created — password: ${pass}`);
  if (claimed.length > 0) console.log(`[seed] ${claimed.length} groups assigned to admin: ${claimed.map((g) => g.slug).join(', ')}`);
}

// ---------- rotation (per group) ----------

const ROT_COLS = `last_platform, last_ig_format, last_li_format, last_pillar_id`;

export async function getRotation(groupId: string): Promise<RotationState> {
  const rows = await sql`select ${sql(ROT_COLS)} from rotation_state where group_id = ${groupId}`;
  const r = rows[0] as any;
  if (!r) {
    // new group without state → seed an empty row (migration 005 default)
    const [created] = await sql`insert into rotation_state (group_id) values (${groupId})
      on conflict (group_id) do nothing
      returning ${sql(ROT_COLS)}`;
    if (created) return created as any;
    throw new Error(`rotation_state group ${groupId} is empty`);
  }
  return {
    last_platform: r.last_platform,
    last_ig_format: r.last_ig_format,
    last_li_format: r.last_li_format,
    last_pillar_id: r.last_pillar_id,
  };
}

export async function setRotation(groupId: string, next: RotationState): Promise<void> {
  await sql`update rotation_state set
    last_platform = ${next.last_platform},
    last_ig_format = ${next.last_ig_format},
    last_li_format = ${next.last_li_format},
    last_pillar_id = ${next.last_pillar_id},
    updated_at = now() where group_id = ${groupId}`;
}

export async function getActivePillars(groupId: string): Promise<{ id: string; is_news: boolean }[]> {
  return sql`select id, is_news from pillars where group_id = ${groupId} and active order by id`;
}

// Mark slot as sent + update rotation in one transaction — only called
// after the post is actually delivered (spec #11).
export async function commitSent(groupId: string, postId: string, slot: Slot, next: RotationState): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update posts set status = 'sent' where id = ${postId}`;
    await tx`update rotation_state set
      last_platform = ${next.last_platform},
      last_ig_format = ${next.last_ig_format},
      last_li_format = ${next.last_li_format},
      last_pillar_id = ${next.last_pillar_id},
      updated_at = now() where group_id = ${groupId}`;
  });
}

if (process.argv[1]!.endsWith('db.ts') && process.argv[2] === 'migrate') {
  migrate()
    .then(() => { console.log('[migrate] done'); return sql.end(); })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
