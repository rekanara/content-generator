// llm_runs repository — LLM invocations outside a post (planner, news scoring/autofill,
// promo writing, override polish). Post runs carry their cost in posts.llm_usage.
import { sql } from '../db/pool.ts';
import { stepUsage } from '../llm-costs.ts';

export type LlmRunKind = 'planner' | 'news_score' | 'news_autofill' | 'promo' | 'polish' | 'failed_run' | 'pillars' | 'styles' | 'tutorial';

export async function recordLlmRun(
  groupId: string | null,
  kind: LlmRunKind,
  model: string,
  prompt: number,
  completion: number,
): Promise<void> {
  const { cost } = stepUsage(model, prompt, completion);
  await sql`insert into llm_runs (group_id, kind, model, prompt_tokens, completion_tokens, cost)
    values (${groupId}, ${kind}, ${model}, ${prompt}, ${completion}, ${cost})`;
}

// USD spent today (Asia/Jakarta day) by a group: post snapshots + llm_runs.
// In-flight run tokens are not counted until the post row is written.
export async function spentToday(groupId: string): Promise<number> {
  const [r] = await sql<{ c: number }[]>`
    with day as (select date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta' as start)
    select (
      coalesce((select sum((llm_usage->>'totalCost')::numeric) from posts, day
        where group_id = ${groupId} and created_at >= day.start), 0)
      + coalesce((select sum(cost) from llm_runs, day
        where group_id = ${groupId} and created_at >= day.start), 0)
    )::float as c`;
  return r?.c ?? 0;
}

export type LlmRunRow = {
  id: string; group_id: string | null; kind: string; model: string;
  prompt_tokens: number; completion_tokens: number; cost: string | number; created_at: Date;
};
