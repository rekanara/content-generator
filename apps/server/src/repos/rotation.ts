// Rotation state repository (per group) + commitSent transaction.
import { sql } from '../db/pool.ts';
import type { RotationState, Slot } from '../state.ts';

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

// Raw row for dashboard display (includes updated_at).
export async function getRotationRow(groupId: string) {
  const rows = await sql`select last_platform, last_ig_format, last_li_format,
    last_pillar_id, updated_at from rotation_state where group_id = ${groupId}`;
  return rows[0] ?? {
    last_platform: 'linkedin', last_ig_format: null, last_li_format: null,
    last_pillar_id: null, updated_at: null,
  };
}
