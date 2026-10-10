// Orchestrates one run: slot → ideation → writer → critic → (render/send called from outside).
// All queries group-scoped; LLM uses GroupCfg (group ?? env).
import { recordLlmRun } from './repos/llm-runs.ts';
import { sql } from './db/pool.ts';
import { getRotation, getActivePillars, commitSent } from './repos/rotation.ts';
import { claimIdea, markIdeaUsed } from './repos/ideas.ts';
import { claimValidNewsItem, markNewsItemUsed, getNewsItemTopic, listNewsItemSources, type ExtraSource } from './repos/news.ts';
import { ingestNewsGroup } from './usecases/news.ts';
import { stage as runStage, postRef } from './progress.ts';
import { nextSlot, forcedSlot, plannedSlot, nextState, type Slot, type Platform, type Format } from './state.ts';
import { chatJson, writerModel, criticModel } from './llm.ts';
import { isIdeationOut, writerGuard, writerGuardName, assembleCaption, toCaptionOut, criticScore, stripCriticMeta, criticFeedback, withNewsSource, resolveCaptionParts, isNewsResearchOut, type CaptionOut, type NewsResearchOut } from './schema.ts';
import { stepUsage, postUsage, type StepUsage } from './llm-costs.ts';
import { ideationPrompt, writerPrompt, criticPrompt, newsResearchPrompt, type ContentBrief, type ExtraArticle } from './prompts.ts';
import { fetchArticleWithImages, fetchArticleText, downloadImage } from './article.ts';
import { uploadPostArtifactBuffer } from './storage.ts';
import type { StyleSample, PillarFull } from './prompts.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import type { GroupCfg } from './groups.ts';

export type Draft = CarouselOut | ReelsOut | TextOut;
export type RunResult = { postId: string; slot: Slot; topic: string; draft: Draft };

// Critic quality gate: a scored revision below this triggers ONE writer retry
// (with the critique as feedback). 7 = "solid publish" per the critic contract.
const CRITIC_THRESHOLD = 7;

// Per-step usage with the model + snapshot cost (llm-costs catalog) — stored in posts.llm_usage.
type UsageAcc = Record<string, StepUsage>;
const addUsage = (acc: UsageAcc, step: string, model: string, u: { prompt: number; completion: number }) => {
  const prev = acc[step];
  const prompt = (prev?.prompt ?? 0) + u.prompt;
  const completion = (prev?.completion ?? 0) + u.completion;
  acc[step] = stepUsage(model, prompt, completion);
};

async function getStyleSamples(platform: Platform, groupId: string): Promise<StyleSample[]> {
  return sql`select title, body, platform from style_samples
    where group_id = ${groupId} and (platform is null or platform = ${platform})
    order by created_at desc limit 8`;
}

async function getHistory(pillarId: string): Promise<string[]> {
  const rows = await sql`select topic from posts
    where pillar_id = ${pillarId} and status in ('sent','rendered','draft')
    order by created_at desc limit 30`;
  return rows.map((r: any) => r.topic);
}

// Recent topics across ALL pillars (same audience sees everything) — fed to ideation
// so "git bisect" (Tips) doesn't land right after "git blame" (Drama) as a repeat.
async function getRecentTopics(groupId: string): Promise<string[]> {
  const rows = await sql`select topic from posts
    where group_id = ${groupId} and status in ('sent','rendered','draft','awaiting_approval')
      and created_at > now() - interval '7 days'
    order by created_at desc limit 20`;
  return rows.map((r: any) => r.topic);
}

async function getPillar(id: string): Promise<PillarFull> {
  const r = (await sql`select id, name, description, is_news from pillars where id = ${id}`)[0] as any;
  if (!r) throw new Error(`pillar ${id} not found`);
  return r;
}

// Legacy RSS context helper, still exported for scripts.
export { getNewsContext } from './rss.ts';

export async function resolveSlot(
  groupId: string,
  forced?: { platform: Platform; format?: Format },
): Promise<Slot> {
  const [state, pillars] = await Promise.all([getRotation(groupId), getActivePillars(groupId)]);
  if (forced) return forcedSlot(state, pillars, true, forced.platform, forced.format);
  return nextSlot(state, pillars, true);
}

// Slot from a plans slot_override row — every spec field falls back to natural
// rotation when null (pinned pillar must still be active, else natural pillar).
export async function resolvePlannedSlot(
  groupId: string,
  spec: { platform?: Platform | null; format?: Format | null; pillar_id?: string | null },
): Promise<Slot> {
  const [state, pillars] = await Promise.all([getRotation(groupId), getActivePillars(groupId)]);
  return plannedSlot(state, pillars, spec);
}

// Research step (news only): fetch the article → LLM extracts concrete facts.
// Fail-safe: article fetch or research failure → falls back to title + RSS summary.
async function researchNews(cfg: GroupCfg, n: NonNullable<Awaited<ReturnType<typeof claimValidNewsItem>>>, usage: UsageAcc, audience: string, wantPhotos: boolean, extraSources: ExtraSource[] = []): Promise<{ research: NewsResearchOut | null; photos: Buffer[] }> {
  runStage('ideation', `research: ${n.domain}`);
  const { text, images } = await fetchArticleWithImages(n.url);
  console.log(`[research] article ${text ? `${text.length} chars` : 'unavailable — RSS summary only'} (${n.domain})`);
  // extra sources (multi-link "Fetch article(s)"): sequential + capped, a dead link just drops out (fail-safe)
  const extra: ExtraArticle[] = [];
  for (const e of extraSources) {
    const t = (await fetchArticleText(e.url)).slice(0, 8000);
    if (t) extra.push({ url: e.url, title: e.title, text: t });
    console.log(`[research] extra source ${e.domain}: ${t ? `${t.length} chars` : 'unavailable'}`);
  }
  // photos: sequential, first 5 candidates; any failure just drops that photo (fail-safe)
  const photos: Buffer[] = [];
  if (wantPhotos) {
    for (const u of images) {
      const b = await downloadImage(u);
      if (b) photos.push(b);
      if (photos.length >= 5) break;
    }
    console.log(`[research] source photos ${photos.length}/${images.length} usable`);
  }
  try {
    const r = await chatJson(cfg, writerModel(cfg), newsResearchPrompt(n, text, audience, extra), isNewsResearchOut, 4000);
    addUsage(usage, 'research', writerModel(cfg), r.usage);
    console.log(`[research] ${r.data.facts.length} facts, ${r.data.open_questions.length} open questions`);
    return { research: r.data, photos };
  } catch (e) {
    console.warn(`[research] failed: ${(e as Error).message.slice(0, 160)}`);
    return { research: null, photos };
  }
}

function makeContentBrief(kind: ContentBrief['kind'], topic: string, angle: string, pillarName: string, newsItem?: Awaited<ReturnType<typeof claimValidNewsItem>>, research?: NewsResearchOut | null, audience?: string, accountBrief = '', pillarDescription = ''): ContentBrief {
  if (kind === 'news' && newsItem) return {
    kind,
    audience,
    premise: topic,
    audience_moment: research?.reader_scenario || `Someone following this topic reads the ${newsItem.domain} report and needs to know what it changes for them.`,
    narrative_arc: 'hook scenario → what happened → how it works / what changed → who is affected → what it means in practice → what you can do → what is still unclear',
    source_facts: research?.facts.length
      ? research.facts
      : [`title: ${newsItem.title}`, `summary: ${newsItem.summary || newsItem.reason || '(none — rely on the title only)'}`],
    must_include: [
      'deliver the news itself on the slide right after the hook',
      ...(research?.open_questions.length ? [`what is still unclear: ${research.open_questions.join('; ')}`] : []),
    ],
    must_not_do: ['generic productivity tips', 'invented numbers, prices, quotes, dates, or release details', 'slides unrelated to the news event', 'a slide that only says "read the source"'],
  };
  if (kind === 'brief') return {
    kind,
    premise: topic,
    audience_moment: 'Reader is following a human-provided story or announcement and needs it structured clearly.',
    narrative_arc: 'hook → original story/facts → why it matters → takeaway → CTA',
    source_facts: [angle],
    must_include: ['preserve user facts and intent'],
    must_not_do: ['replace the user story with generic advice', 'invent details'],
  };
  return {
    kind: 'pillar',
    premise: topic,
    audience_moment: accountBrief || pillarDescription || `A person following ${pillarName.toLowerCase()} runs into this topic in daily life or work.`,
    narrative_arc: 'human moment → tension → insight → practical move → reflection/CTA',
    source_facts: angle ? [angle] : [],
    must_include: ['one concrete real-world scene from the account audience', 'one practical move the reader can try'],
    must_not_do: ['encyclopedia explanation', 'unconnected listicle tips', 'corporate tone'],
  };
}

// Full LLM phase: ideation → writer → critic. No render, no send.
// brief: when provided (Telegram /buat), skips ideation entirely — the user's
// full text becomes the source material. First line = topic (the hook), rest =
// angle (the story). Writer restructures, does NOT rewrite from scratch.
export async function generateDraft(cfg: GroupCfg, slot: Slot, source = 'cli', brief?: string, news?: { topicId?: string; itemId?: string; language?: string }): Promise<RunResult> {
  const usage: UsageAcc = {};
  try {
    return await generateDraftInner(cfg, slot, source, usage, brief, news);
  } catch (e) {
    // tokens burned before the post row exists still count toward the daily budget
    for (const s of Object.values(usage)) {
      await recordLlmRun(cfg.id, 'failed_run', s.model, s.prompt, s.completion).catch(() => {});
    }
    throw e;
  }
}

async function generateDraftInner(cfg: GroupCfg, slot: Slot, source: string, usage: UsageAcc, brief?: string, news?: { topicId?: string; itemId?: string; language?: string }): Promise<RunResult> {
  const groupId = cfg.id;
  const pillar = await getPillar(slot.pillar_id);

  let effPillar = pillar;
  let newsItem: Awaited<ReturnType<typeof claimValidNewsItem>> = null;
  if (news && !pillar.is_news) {
    const newsPillar = (await sql`select id, name, description, is_news from pillars
      where group_id = ${groupId} and active and is_news order by id limit 1`)[0] as any;
    if (!newsPillar) throw new Error('manual news generate requires an active news pillar');
    effPillar = newsPillar;
    slot = { ...slot, pillar_id: newsPillar.id };
  }
  if (effPillar.is_news) {
    newsItem = await claimValidNewsItem(groupId, news);
    if (!newsItem) {
      runStage('ideation', 'fetching news sources');
      const ingest = await ingestNewsGroup(groupId, cfg);
      console.log(`[pipeline] news ingest fetched=${ingest.fetched} saved=${ingest.saved} valid=${ingest.valid}`);
      newsItem = await claimValidNewsItem(groupId, news);
    }
    if (!newsItem) {
      if (news) throw new Error('selected news item is no longer valid');
      const nonNews = (await sql`select id, name, description, is_news from pillars
        where group_id = ${groupId} and active and not is_news order by id limit 1`)[0] as any;
      if (!nonNews) throw new Error('news pillar without valid news items and no non-news pillar available');
      console.log(`[pipeline] news pillar without valid news items → fallback: ${nonNews.name}`);
      effPillar = nonNews;
      slot = { ...slot, pillar_id: nonNews.id };
    }
  }
  const newsCtx: string | null = newsItem ? `- ${newsItem.title}\n  ${newsItem.url}` : null;
  const languageHint = news?.language && news.language !== 'original' ? news.language : undefined;

  // 1. topic source priority: brief (/buat) > idea backlog (FIFO) > ideation LLM.
  runStage('slot', `${slot.platform}/${slot.format} · ${effPillar.name}`);
  let topic: string;
  let angle: string;
  let idea: Awaited<ReturnType<typeof claimIdea>> = null;
  if (brief) {
    // User-provided content: first line = topic (the hook), full text = angle (story).
    // Writer restructures into slides — does NOT rewrite from scratch.
    const lines = brief.trim().split('\n').filter((l) => l.trim());
    topic = lines[0]?.trim().slice(0, 120) ?? brief.trim().slice(0, 120);
    angle = brief.trim();
    runStage('writer', `brief: ${topic.slice(0, 50)}`);
    console.log(`[pipeline] brief provided (${brief.length} chars) — skipping ideation`);
  } else if (newsItem) {
    topic = newsItem.title.trim().slice(0, 120);
    angle = `Source: ${newsItem.url}\nSummary: ${newsItem.summary || newsItem.reason || newsItem.title}\nAngle: explain why this matters to people following this topic. Mention source domain ${newsItem.domain}.`;
    runStage('writer', `news: ${topic.slice(0, 50)}`);
    console.log(`[pipeline] news item #${newsItem.id.slice(0, 8)} claimed: "${topic.slice(0, 60)}"`);
  } else {
    idea = await claimIdea(groupId);
    if (idea) {
      topic = idea.text.trim().slice(0, 400);
      angle = '';
      runStage('writer', `idea backlog: ${topic.slice(0, 50)}`);
      console.log(`[pipeline] idea backlog #${idea.id.slice(0, 8)} claimed: "${topic.slice(0, 60)}"`);
    } else {
      runStage('ideation');
      const [history, recentTopics] = await Promise.all([getHistory(effPillar.id), getRecentTopics(groupId)]);
      const id = await chatJson(
        cfg,
        writerModel(cfg),
        ideationPrompt(effPillar, history, newsCtx, recentTopics, cfg.brief),
        isIdeationOut,
        6000,
      );
      addUsage(usage, 'ideation', writerModel(cfg), id.usage);
      console.log(`[ideation] topic="${id.data.topic}" tokens=${id.usage.completion}`);
      topic = id.data.topic;
      angle = id.data.angle;
      runStage('writer', topic.slice(0, 60));
    }
  }

  const newsTopic = newsItem ? await getNewsItemTopic(newsItem.id) : null;
  // audience = the news topic's own definition (e.g. "Berita Indonesia: pemerintahan, korupsi…"),
  // so a politics item is written for that audience — not bent into a developer angle
  const audience = newsTopic ? `people following "${newsTopic.name}"${newsTopic.description ? ` — ${newsTopic.description}` : ''}` : undefined;
  const extraSources = newsItem ? await listNewsItemSources(newsItem.id) : [];
  const researched = newsItem ? await researchNews(cfg, newsItem, usage, audience ?? (cfg.brief || 'people following this topic'), !!newsTopic?.use_source_images, extraSources) : null;
  const research = researched?.research ?? null;
  const photos = researched?.photos ?? [];
  const contentBrief = makeContentBrief(newsItem ? 'news' : brief ? 'brief' : 'pillar', topic, angle, effPillar.name, newsItem, research, audience, cfg.brief, effPillar.description);

  // 2. writer
  const samples = await getStyleSamples(slot.platform, groupId);
  const w = await chatJson(
    cfg,
    writerModel(cfg),
    writerPrompt(slot.platform, slot.format, topic, angle, effPillar.name, samples, undefined, brief, languageHint, contentBrief),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'writer', writerModel(cfg), w.usage);
  console.log(`[writer] ok format=${slot.format} tokens=${w.usage.completion}`);

  // 3. critic (separate model) — same guard, structure must stay intact.
  //    Quality gate: the critic scores its own revision 0-10; below threshold → ONE
  //    writer retry with the critique as feedback, then critic again. The better-
  //    scoring draft wins. Score absent (old-shape critic output) → gate off, ship.
  runStage('critic');
  const runWriter = async (feedback?: string) =>
    chatJson(cfg, writerModel(cfg), writerPrompt(slot.platform, slot.format, topic, angle, effPillar.name, samples, feedback, brief, languageHint, contentBrief),
      writerGuard(slot.format) as (x: unknown) => x is Draft, 8000);
  const runCritic = async (d: Draft) =>
    chatJson(cfg, criticModel(cfg), criticPrompt(slot.platform, slot.format, d, contentBrief.kind),
      writerGuard(slot.format) as (x: unknown) => x is Draft, 8000);

  const c = await runCritic(w.data);
  addUsage(usage, 'critic', criticModel(cfg), c.usage);
  let final = c.data;
  let finalScore = criticScore(final);
  if (finalScore !== null && finalScore < CRITIC_THRESHOLD) {
    console.log(`[critic] score ${finalScore} < ${CRITIC_THRESHOLD} — one regeneration`);
    const w2 = await runWriter(criticFeedback(final, finalScore));
    addUsage(usage, 'writer', writerModel(cfg), w2.usage);
    const c2 = await runCritic(w2.data);
    addUsage(usage, 'critic', criticModel(cfg), c2.usage);
    const score2 = criticScore(c2.data);
    if (score2 === null || score2 > finalScore) {
      final = c2.data;
      finalScore = score2;
      console.log(`[critic] retry won (score ${score2 ?? 'n/a'})`);
    } else {
      console.log(`[critic] original kept (score ${finalScore} >= retry ${score2})`);
    }
  }
  if (finalScore !== null) console.log(`[critic] ok score=${finalScore} tokens=${c.usage.completion}`);
  else console.log(`[critic] ok (no score) tokens=${c.usage.completion}`);
  if (finalScore !== null) runStage('critic', `score ${finalScore}/10`);
  final = stripCriticMeta(final);
  // tolerant-caption normalization: a string caption (old shape) → structured form
  if ('caption' in (final as Record<string, unknown>)) {
    (final as { caption: CaptionOut }).caption = toCaptionOut((final as { caption: unknown }).caption);
  }
  // news: source attribution enforced in code, never left to the LLM
  if (newsItem) final = withNewsSource(final, { url: newsItem.url, domain: newsItem.domain, extra: extraSources }, languageHint && languageHint !== 'id' ? 'Source' : 'Sumber');

  // news topic may override the group's CTA/footer (blank = group Settings)
  const parts = resolveCaptionParts(newsTopic, cfg);

  // 4. persist post (status draft)
  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source, llm_usage)
    values (${groupId}, ${slot.platform}, ${slot.format}, ${effPillar.id}, ${topic},
      ${captionOf(final, parts.footer, parts.cta)}, ${bodyOf(final)}, 'draft', ${source}, ${sql.json(postUsage(usage) as never)})
    returning id`;
  if (!post) throw new Error('insert post failed');
  if (photos.length && newsItem) await storeSourcePhotos(cfg, post.id as string, photos, newsItem.domain);
  if (idea && !brief) await markIdeaUsed(idea.id); // consumed only once the draft exists
  if (newsItem && !brief) await markNewsItemUsed(newsItem.id, post.id as string);
  console.log(`[pipeline] post #${post.id} draft saved (group ${cfg.slug})`);

  return { postId: post.id, slot, topic, draft: final };
}

async function storeSourcePhotos(cfg: GroupCfg, postId: string, photos: Buffer[], domain: string): Promise<void> {
  try {
    for (let i = 0; i < photos.length; i++) {
      await uploadPostArtifactBuffer(cfg.slug, postId, photos[i]!, `photo-${String(i + 1).padStart(2, '0')}.jpg`);
    }
    // credit on the image (render) AND in the caption (reels background has no badge)
    const credit = `Foto: ${domain}`;
    await sql`update posts set photo_credit = ${credit}, caption = caption || ${`\n\n${credit}`} where id = ${postId}`;
    console.log(`[pipeline] post #${postId}: ${photos.length} source photo(s) stored (credit ${domain})`);
  } catch (e) {
    console.warn(`[pipeline] source photos not stored: ${(e as Error).message}`);
  }
}

// Structured caption + group footer → final string, stored in posts.caption at
// generate time (downstream: telegram sends, approval text, FE, resend — all unchanged).
function captionOf(d: Draft, footer: string, ctaOverride: string): string {
  return 'caption' in d ? assembleCaption(d.caption, footer, ctaOverride) : '';
}
function bodyOf(d: Draft): string {
  return JSON.stringify(d);
}

// Called AFTER the post is sent — status + rotation update atomically (spec #11).
export async function markSent(groupId: string, postId: string, slot: Slot): Promise<void> {
  const next = nextState(await getRotation(groupId), slot);
  await commitSent(groupId, postId, slot, next);
  console.log(`[pipeline] post #${postId} sent — rotation advanced: ${next.last_platform}`);
}

export async function markFailed(postId: string, err: unknown): Promise<void> {
  const msg = String((err as Error)?.message ?? err).slice(0, 2000);
  await sql`update posts set status = 'failed', error = ${msg} where id = ${postId}`;
}

export async function createQueuedPost(groupId: string, slot: Slot, source: string): Promise<string> {
  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source)
    values (${groupId}, ${slot.platform}, ${slot.format}, ${slot.pillar_id}, '', '', null, 'queued', ${source})
    returning id`;
  if (!post) throw new Error('insert post failed');
  return post.id;
}
