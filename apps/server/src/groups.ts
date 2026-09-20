// Group resolver + CRUD. 1 group = 1 account/brand. Null config row → env fallback.
import { sql } from './db.ts';
import { config } from './config.ts';

export type GroupRow = {
  id: string; slug: string; name: string; user_id: string | null;
  cron_expr: string; cron_enabled: boolean; created_at: Date;
  llm_base_url: string | null; llm_api_key: string | null; llm_model: string | null; llm_model_critic: string | null;
  tts_provider: string | null; tts_voice: string | null; tts_base_url: string | null; tts_api_key: string | null; tts_model: string | null;
  telegram_bot_token: string | null; telegram_chat_id: string | null;
};

// Effective config for one run: groups row merged over env.
export type GroupCfg = {
  id: string; slug: string;
  llm: { baseUrl: string; apiKey: string; model: string; criticModel: string };
  tts: { provider: 'edge' | 'openai'; voice: string; baseUrl: string; apiKey: string; model: string };
  telegram: { botToken: string; chatId: string };
};

export function toGroupCfg(row: GroupRow): GroupCfg {
  return {
    id: row.id,
    slug: row.slug,
    llm: {
      baseUrl: row.llm_base_url ?? config.llm.baseUrl,
      apiKey: row.llm_api_key ?? config.llm.apiKey,
      model: row.llm_model ?? config.llm.model,
      criticModel: row.llm_model_critic ?? row.llm_model ?? config.llm.criticModel,
    },
    tts: {
      provider: (row.tts_provider ?? config.tts.provider) as 'edge' | 'openai',
      voice: row.tts_voice ?? config.tts.voice,
      baseUrl: row.tts_base_url ?? config.tts.baseUrl,
      apiKey: row.tts_api_key ?? config.tts.apiKey,
      model: row.tts_model ?? config.tts.model,
    },
    telegram: {
      botToken: row.telegram_bot_token ?? config.telegram.botToken,
      chatId: row.telegram_chat_id ?? config.telegram.chatId,
    },
  };
}

const COLS = sql`select id, slug, name, user_id, cron_expr, cron_enabled, created_at,
  llm_base_url, llm_api_key, llm_model, llm_model_critic,
  tts_provider, tts_voice, tts_base_url, tts_api_key, tts_model,
  telegram_bot_token, telegram_chat_id from groups`;

// returning-list for sql.unsafe (dynamic patch) — identical to COLS.
const RET = 'id, slug, name, user_id, cron_expr, cron_enabled, created_at, llm_base_url, llm_api_key, llm_model, llm_model_critic, tts_provider, tts_voice, tts_base_url, tts_api_key, tts_model, telegram_bot_token, telegram_chat_id';

export async function listGroups(): Promise<GroupRow[]> {
  return sql<GroupRow[]>`${COLS} order by id`;
}

export async function listGroupsForUser(userId: string): Promise<GroupRow[]> {
  return sql<GroupRow[]>`${COLS} where user_id = ${userId} order by id`;
}

export async function getGroupRow(slug: string): Promise<GroupRow | null> {
  const [row] = await sql<GroupRow[]>`${COLS} where slug = ${slug}`;
  return row ?? null;
}

export async function getGroupCfg(slug: string): Promise<GroupCfg> {
  const row = await getGroupRow(slug);
  if (!row) throw new Error(`group "${slug}" not found`);
  return toGroupCfg(row);
}

export async function getGroupCfgById(id: string): Promise<GroupCfg> {
  const [row] = await sql<GroupRow[]>`${COLS} where id = ${id}`;
  if (!row) throw new Error(`group ${id} not found`);
  return toGroupCfg(row);
}

// reserved: conflicts with FE routes /app/users, /login
const RESERVED_SLUGS = new Set(['users', 'login']);

export async function createGroup(d: {
  slug: string; name: string; cron_expr: string; cron_enabled: boolean; user_id: string | null;
  llm_base_url: string | null; llm_api_key: string | null; llm_model: string | null; llm_model_critic: string | null;
  tts_provider: string | null; tts_voice: string | null; tts_base_url: string | null; tts_api_key: string | null; tts_model: string | null;
  telegram_bot_token: string | null; telegram_chat_id: string | null;
}): Promise<GroupRow> {
  if (RESERVED_SLUGS.has(d.slug)) throw new Error(`slug "${d.slug}" reserved`);
  const [row] = await sql<GroupRow[]>`insert into groups (slug, name, user_id, cron_expr, cron_enabled,
    llm_base_url, llm_api_key, llm_model, llm_model_critic,
    tts_provider, tts_voice, tts_base_url, tts_api_key, tts_model,
    telegram_bot_token, telegram_chat_id)
    values (${d.slug}, ${d.name}, ${d.user_id}, ${d.cron_expr}, ${d.cron_enabled},
      ${d.llm_base_url}, ${d.llm_api_key}, ${d.llm_model}, ${d.llm_model_critic},
      ${d.tts_provider}, ${d.tts_voice}, ${d.tts_base_url}, ${d.tts_api_key}, ${d.tts_model},
      ${d.telegram_bot_token}, ${d.telegram_chat_id})
    returning id, slug, name, user_id, cron_expr, cron_enabled, created_at,
      llm_base_url, llm_api_key, llm_model, llm_model_critic,
      tts_provider, tts_voice, tts_base_url, tts_api_key, tts_model,
      telegram_bot_token, telegram_chat_id`;
  // every group must have a rotation_state (005: PK group_id)
  await sql`insert into rotation_state (group_id, last_platform) values (${row!.id}, 'linkedin')
    on conflict (group_id) do nothing`;
  return row!;
}

// Dynamic patch: field present → update (null = clear override). Field absent → skip.
// Identifiers from the MAP whitelist, values parameterized — injection-safe.
export async function patchGroup(slug: string, d: Record<string, unknown>): Promise<GroupRow | null> {
  const MAP: Record<string, string> = {
    name: 'name', cron_expr: 'cron_expr', cron_enabled: 'cron_enabled',
    llm_base_url: 'llm_base_url', llm_api_key: 'llm_api_key', llm_model: 'llm_model', llm_model_critic: 'llm_model_critic',
    tts_provider: 'tts_provider', tts_voice: 'tts_voice', tts_base_url: 'tts_base_url', tts_api_key: 'tts_api_key', tts_model: 'tts_model',
    telegram_bot_token: 'telegram_bot_token', telegram_chat_id: 'telegram_chat_id',
  };
  const keys = Object.keys(MAP).filter((k) => k in d);
  if (keys.length === 0) return getGroupRow(slug);
  const sets = keys.map((k, i) => `${MAP[k]!} = $${i + 1}`);
  const vals = keys.map((k) => d[k] as never);
  const rows = await sql.unsafe<GroupRow[]>(
    `update groups set ${sets.join(', ')} where slug = $${vals.length + 1} returning ${RET}`,
    [...vals, slug] as never[],
  );
  return rows[0] ?? null;
}

export async function deleteGroup(slug: string): Promise<boolean> {
  const r = await sql`delete from groups where slug = ${slug} returning id`;
  return r.length > 0;
}

// Serialize to the Group schema (@workspace/shared): secrets become *_set flags.
export function groupOut(row: GroupRow) {
  return {
    id: row.id, slug: row.slug, name: row.name,
    cron_expr: row.cron_expr, cron_enabled: row.cron_enabled,
    created_at: row.created_at.toISOString(),
    llm_base_url: row.llm_base_url, llm_model: row.llm_model, llm_model_critic: row.llm_model_critic,
    tts_provider: row.tts_provider, tts_voice: row.tts_voice, tts_base_url: row.tts_base_url, tts_model: row.tts_model,
    telegram_chat_id: row.telegram_chat_id,
    llm_api_key_set: !!row.llm_api_key,
    tts_api_key_set: !!row.tts_api_key,
    telegram_bot_token_set: !!row.telegram_bot_token,
  };
}
