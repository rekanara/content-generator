// postgres.js pool + migrasi runner + helper state/pillars.
// Jalankan migrasi: tsx src/db.ts migrate (atau pnpm migrate)
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
}

export async function getRotation(): Promise<RotationState> {
  const rows = await sql`select last_platform, last_ig_format, last_li_format, last_pillar_id
    from rotation_state where id`;
  const r = rows[0] as any;
  if (!r) throw new Error('rotation_state kosong — jalankan migrasi+seed');
  return {
    last_platform: r.last_platform,
    last_ig_format: r.last_ig_format,
    last_li_format: r.last_li_format,
    last_pillar_id: r.last_pillar_id,
  };
}

export async function setRotation(next: RotationState): Promise<void> {
  await sql`update rotation_state set
    last_platform = ${next.last_platform},
    last_ig_format = ${next.last_ig_format},
    last_li_format = ${next.last_li_format},
    last_pillar_id = ${next.last_pillar_id},
    updated_at = now() where id`;
}

export async function getActivePillars(): Promise<{ id: number; is_news: boolean }[]> {
  return sql`select id, is_news from pillars where active order by id`;
}

// Simpan slot sebagai post + update rotasi dalam satu transaksi — hanya dipanggil
// setelah post benar-benar terkirim (spec #11).
export async function commitSent(postId: number, slot: Slot, next: RotationState): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update posts set status = 'sent' where id = ${postId}`;
    await tx`update rotation_state set
      last_platform = ${next.last_platform},
      last_ig_format = ${next.last_ig_format},
      last_li_format = ${next.last_li_format},
      last_pillar_id = ${next.last_pillar_id},
      updated_at = now() where id`;
  });
}

if (process.argv[1]!.endsWith('db.ts') && process.argv[2] === 'migrate') {
  migrate()
    .then(() => { console.log('[migrate] done'); return sql.end(); })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
