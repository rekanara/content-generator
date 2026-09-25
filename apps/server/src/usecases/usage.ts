// Usage rollup: tokens + costs per group and globally.
// Sources: posts.llm_usage (snapshot jsonb — pipeline steps + cover) and llm_runs
// (planner etc). Post rows: cost counted per post regardless of status (the tokens
// were burned even for rejected/failed posts — that's the point of cost tracking).
// NOTE: this postgres.js build returns jsonb columns as JSON strings — parseJson
// normalizes (old-format rows: raw {step:{prompt,completion}} without steps/totalCost
// → counted with the group's CURRENT writer model price, best-effort).
import { sql } from '../db/pool.ts';
import type { PostUsage, StepUsage } from '../llm-costs.ts';
import { stepUsage } from '../llm-costs.ts';
import { getGroupCfg } from '../groups.ts';

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

// Old-format usage (pre-cost rows) → steps with the group's models (best-effort estimate).
function normalizeUsage(raw: unknown, writerModel: string, criticModel: string): PostUsage {
  const u = parseJson<Record<string, unknown>>(raw);
  if (!u || typeof u !== 'object') return { steps: {}, totalCost: 0 };
  if (u.steps) return u as unknown as PostUsage; // new format
  const steps: Record<string, StepUsage> = {};
  for (const [name, v] of Object.entries(u)) {
    const s = v as { prompt?: number; completion?: number } | null;
    if (s && typeof s.prompt === 'number') {
      const model = name === 'critic' ? criticModel : writerModel;
      steps[name] = stepUsage(model, s.prompt, s.completion ?? 0);
    }
  }
  const total = Object.values(steps).reduce((a, s) => a + s.cost, 0);
  return { steps, totalCost: Math.round(total * 10000) / 10000 };
}

export type UsageStepAgg = { model: string; prompt: number; completion: number; cost: number; runs: number };
export type GroupUsage = {
  group: { id: string; slug: string; name: string };
  posts: number;                 // posts that consumed LLM tokens
  plannerRuns: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;                  // USD, sum of snapshots
  byModel: UsageStepAgg[];       // aggregated across steps + planner runs
};

export async function getGroupUsage(groupId: string, sinceDays = 30): Promise<GroupUsage> {
  const [group] = await sql<{ id: string; slug: string; name: string }[]>`select id, slug, name from groups where id = ${groupId}`;
  return rollup(group!, sinceDays);
}

export async function getAllGroupsUsage(sinceDays = 30): Promise<GroupUsage[]> {
  const groups = await sql<{ id: string; slug: string; name: string }[]>`select id, slug, name from groups order by id`;
  return Promise.all(groups.map((g) => rollup(g, sinceDays)));
}

async function rollup(group: { id: string; slug: string; name: string }, sinceDays: number): Promise<GroupUsage> {
  const [posts, runs, cfg] = await Promise.all([
    sql<{ llm_usage: unknown }[]>`select llm_usage from posts
      where group_id = ${group.id} and llm_usage is not null and created_at >= now() - (${sinceDays} || ' days')::interval`,
    sql<{ model: string; prompt_tokens: number; completion_tokens: number; cost: string | number }[]>`
      select model, prompt_tokens, completion_tokens, cost from llm_runs
      where group_id = ${group.id} and created_at >= now() - (${sinceDays} || ' days')::interval`,
    getGroupCfg(group.slug).catch(() => null),
  ]);
  const writerM = cfg?.llm.model ?? '';
  const criticM = cfg?.llm.criticModel ?? '';

  const byModel = new Map<string, UsageStepAgg>();
  const bump = (model: string, prompt: number, completion: number, cost: number) => {
    const m = byModel.get(model) ?? { model, prompt: 0, completion: 0, cost: 0, runs: 0 };
    m.prompt += prompt; m.completion += completion; m.cost += Number(cost); m.runs += 1;
    byModel.set(model, m);
  };

  for (const p of posts) {
    const u = normalizeUsage(p.llm_usage, writerM, criticM);
    for (const s of Object.values(u.steps ?? {})) {
      bump(s.model, s.prompt, s.completion, s.cost);
    }
    const cover = parseJson<{ model: string; images: number; cost: number } | undefined>(u.cover as unknown);
    if (cover?.model && cover.cost > 0) {
      const m = byModel.get(cover.model) ?? { model: cover.model, prompt: 0, completion: 0, cost: 0, runs: 0 };
      m.cost += cover.cost; m.runs += 1;
      byModel.set(cover.model, m);
    }
  }
  for (const r of runs) {
    bump(r.model, r.prompt_tokens, r.completion_tokens, Number(r.cost));
  }

  const arr = [...byModel.values()].map((m) => ({ ...m, cost: round4(m.cost) }))
    .sort((a, b) => b.cost - a.cost);
  return {
    group,
    posts: posts.length,
    plannerRuns: runs.length,
    promptTokens: arr.reduce((a, m) => a + m.prompt, 0),
    completionTokens: arr.reduce((a, m) => a + m.completion, 0),
    cost: round4(arr.reduce((a, m) => a + m.cost, 0)),
    byModel: arr,
  };
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
