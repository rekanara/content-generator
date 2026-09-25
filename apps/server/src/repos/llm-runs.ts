// llm_runs repository — LLM invocations outside a post (planner today).
import { sql } from '../db/pool.ts';
import { stepUsage } from '../llm-costs.ts';

export async function recordLlmRun(
  groupId: string | null,
  kind: 'planner',
  model: string,
  prompt: number,
  completion: number,
): Promise<void> {
  const { cost } = stepUsage(model, prompt, completion);
  await sql`insert into llm_runs (group_id, kind, model, prompt_tokens, completion_tokens, cost)
    values (${groupId}, ${kind}, ${model}, ${prompt}, ${completion}, ${cost})`;
}

export type LlmRunRow = {
  id: string; group_id: string | null; kind: string; model: string;
  prompt_tokens: number; completion_tokens: number; cost: string | number; created_at: Date;
};
