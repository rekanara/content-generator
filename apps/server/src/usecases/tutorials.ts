// Tutorial generation: fetch official sources → write → editor → accuracy checks (+1 retry with
// the violations as feedback) → persist as a draft post. Rotation is never touched (on-demand content).
import { sql } from '../db/pool.ts';
import { chatJson, writerModel, criticModel } from '../llm.ts';
import { stage as runStage } from '../progress.ts';
import { fetchDocSource } from '../article.ts';
import { recordLlmRun } from '../repos/llm-runs.ts';
import { saveTutorialSnapshot, type TutorialSource } from '../repos/tutorials.ts';
import { stepUsage, postUsage, type StepUsage } from '../llm-costs.ts';
import { assembleCaption, resolveCaptionParts, toCaptionOut, criticScore, stripCriticMeta } from '../schema.ts';
import { tutorialWriterPrompt, tutorialCriticPrompt } from '../prompts.ts';
import { tutorialGuard, validateTutorial, withTutorialSources, type TutorialDraft, type TutorialFormat } from '../tutorial.ts';
import type { GroupCfg } from '../groups.ts';
import type { Tutorial } from '@workspace/shared';

type Usage = Record<string, StepUsage>;
const add = (acc: Usage, step: string, model: string, u: { prompt: number; completion: number }) => {
  const p = acc[step];
  acc[step] = stepUsage(model, (p?.prompt ?? 0) + u.prompt, (p?.completion ?? 0) + u.completion);
};

export type TutorialRun = { postId: string; topic: string; draft: TutorialDraft };

// A tutorial with no readable source must fail loudly: writing from memory is exactly the risk.
export async function fetchTutorialSources(urls: string[]): Promise<TutorialSource[]> {
  const got = await Promise.all(urls.map(async (u) => ({ u, r: await fetchDocSource(u) })));
  const failed = got.filter((g) => !g.r || g.r.text.trim().length < 200).map((g) => g.u);
  if (failed.length === got.length) throw new Error(`could not read any source URL (${failed.join(', ')})`);
  if (failed.length) console.warn(`[tutorial] ${failed.length} source(s) unreadable, continuing: ${failed.join(', ')}`);
  const at = new Date().toISOString();
  return got.filter((g) => g.r && g.r.text.trim().length >= 200).map((g) => ({ url: g.r!.url, title: g.r!.title, text: g.r!.text, fetched_at: at }));
}

export async function generateTutorialDraft(cfg: GroupCfg, t: Tutorial, format: TutorialFormat, source = 'web'): Promise<TutorialRun> {
  const usage: Usage = {};
  try {
    return await run(cfg, t, format, source, usage);
  } catch (e) {
    for (const s of Object.values(usage)) await recordLlmRun(cfg.id, 'failed_run', s.model, s.prompt, s.completion).catch(() => {});
    throw e;
  }
}

async function run(cfg: GroupCfg, t: Tutorial, format: TutorialFormat, source: string, usage: Usage): Promise<TutorialRun> {
  runStage('ideation', `reading ${t.source_urls.length} source(s)`);
  const sources = await fetchTutorialSources(t.source_urls);
  await saveTutorialSnapshot(t.id, sources);
  const sourceText = sources.map((s) => s.text).join('\n');
  const guard = tutorialGuard(format) as (x: unknown) => x is TutorialDraft;
  const base = { topic: t.topic, level: t.level, language: t.language, format, sources };

  runStage('writer', t.topic.slice(0, 60));
  const w = await chatJson(cfg, writerModel(cfg), tutorialWriterPrompt(base), guard, 8000);
  add(usage, 'writer', writerModel(cfg), w.usage);

  runStage('critic');
  const c = await chatJson(cfg, criticModel(cfg), tutorialCriticPrompt(format, w.data), guard, 8000);
  add(usage, 'critic', criticModel(cfg), c.usage);
  console.log(`[tutorial] editor score=${criticScore(c.data) ?? 'n/a'}`);
  // the editor may only polish: never trust it to keep commands accurate — validate its output
  let draft = stripCriticMeta(c.data) as TutorialDraft;
  let issues = validateTutorial(draft, format, sourceText);
  if (issues.length) {
    console.log(`[tutorial] ${issues.length} check failure(s) — one retry`);
    const w2 = await chatJson(cfg, writerModel(cfg), tutorialWriterPrompt({ ...base, feedback: issues.map((i) => `- ${i}`).join('\n') }), guard, 8000);
    add(usage, 'writer', writerModel(cfg), w2.usage);
    draft = w2.data;
    issues = validateTutorial(draft, format, sourceText);
  }
  if (issues.length) throw new Error(`tutorial failed accuracy checks: ${issues.slice(0, 5).join('; ')}`);

  draft.caption = toCaptionOut(draft.caption);
  draft = withTutorialSources(draft, sources.map((s) => s.url), new Date().toISOString().slice(0, 10), t.language);
  const parts = resolveCaptionParts(null, cfg);

  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source, llm_usage, tutorial_id, template_id)
    values (${cfg.id}, 'instagram', ${format}, null, ${t.topic},
      ${assembleCaption(draft.caption, parts.footer, parts.cta)}, ${JSON.stringify(draft)}, 'draft', ${source},
      ${sql.json(postUsage(usage) as never)}, ${t.id}, ${(format === 'reels' ? t.template_reel_id : t.template_id) ?? null})
    returning id`;
  if (!post) throw new Error('insert post failed');
  console.log(`[tutorial] post #${post.id} draft saved (${cfg.slug}, ${format})`);
  return { postId: post.id as string, topic: t.topic, draft };
}
