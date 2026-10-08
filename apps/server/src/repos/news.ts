import { sql } from '../db/pool.ts';
import type { NewsItem, NewsRule, NewsRuleInput, NewsSource, NewsSourceInput, NewsTopic, NewsTopicDetail } from '@workspace/shared';

function itemOut(r: Record<string, unknown>): NewsItem {
  return {
    id: r.id as string,
    title: r.title as string,
    url: r.url as string,
    domain: r.domain as string,
    summary: r.summary as string,
    published_at: (r.published_at as string | null) ?? null,
    status: r.status as 'pending' | 'valid' | 'rejected' | 'used',
    score: (r.score as number | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    post_id: (r.post_id as string | null) ?? null,
    created_at: r.created_at as string,
  };
}

export async function listNewsTopics(groupId: string): Promise<NewsTopic[]> {
  const rows = await sql`select t.id, t.name, t.description, t.active, t.template_id, t.caption_cta, t.caption_footer, t.created_at, count(s.id)::int as source_count
    from news_topics t
    left join news_sources s on s.topic_id = t.id
    where t.group_id = ${groupId}
    group by t.id
    order by t.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    active: r.active as boolean,
    template_id: (r.template_id as string | null) ?? null,
    caption_cta: (r.caption_cta as string | null) ?? null,
    caption_footer: (r.caption_footer as string | null) ?? null,
    source_count: r.source_count as number,
    created_at: r.created_at as string,
  }));
}

export async function createNewsTopic(groupId: string, d: { name: string; description: string }): Promise<NewsTopic> {
  const [r] = await sql`insert into news_topics (group_id, name, description)
    values (${groupId}, ${d.name}, ${d.description})
    returning id, name, description, active, template_id, caption_cta, caption_footer, created_at`;
  return {
    id: r!.id as string,
    name: r!.name as string,
    description: r!.description as string,
    active: r!.active as boolean,
    template_id: (r!.template_id as string | null) ?? null,
    caption_cta: null,
    caption_footer: null,
    source_count: 0,
    created_at: r!.created_at as string,
  };
}

export async function deleteNewsTopic(groupId: string, id: string): Promise<boolean> {
  const rows = await sql`delete from news_topics where id = ${id} and group_id = ${groupId} returning id`;
  return rows.length > 0;
}

export async function getNewsTopic(groupId: string, id: string): Promise<NewsTopicDetail | null> {
  const [topic] = await sql`select id, name, description, active, template_id, caption_cta, caption_footer, created_at
    from news_topics where id = ${id} and group_id = ${groupId}`;
  if (!topic) return null;
  const sources = await sql`select id, name, url, active, created_at
    from news_sources where topic_id = ${id} order by created_at desc`;
  const [rules] = await sql`select freshness_hours, min_sources, allowed_domains, blocked_domains, keywords, updated_at
    from news_rules where topic_id = ${id}`;
  const items = await sql`select id, title, url, domain, summary, published_at, status, score, reason, post_id, created_at
    from news_items where topic_id = ${id}
    order by published_at desc nulls last, created_at desc limit 50`;
  return {
    id: topic.id as string,
    name: topic.name as string,
    description: topic.description as string,
    active: topic.active as boolean,
    template_id: (topic.template_id as string | null) ?? null,
    caption_cta: (topic.caption_cta as string | null) ?? null,
    caption_footer: (topic.caption_footer as string | null) ?? null,
    source_count: sources.length,
    created_at: topic.created_at as string,
    sources: sources.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      url: s.url as string,
      active: s.active as boolean,
      created_at: s.created_at as string,
    })),
    rules: rules ? {
      freshness_hours: rules.freshness_hours as number,
      min_sources: rules.min_sources as number,
      allowed_domains: rules.allowed_domains as string[],
      blocked_domains: rules.blocked_domains as string[],
      keywords: rules.keywords as string[],
      updated_at: rules.updated_at as string,
    } : {
      freshness_hours: 72,
      min_sources: 1,
      allowed_domains: [],
      blocked_domains: [],
      keywords: [],
      updated_at: topic.created_at as string,
    },
    items: items.map((i) => ({
      id: i.id as string,
      title: i.title as string,
      url: i.url as string,
      domain: i.domain as string,
      summary: i.summary as string,
      published_at: (i.published_at as string | null) ?? null,
      status: i.status as 'pending' | 'valid' | 'rejected' | 'used',
      score: (i.score as number | null) ?? null,
      reason: (i.reason as string | null) ?? null,
      post_id: (i.post_id as string | null) ?? null,
      created_at: i.created_at as string,
    })),
  };
}

export async function addNewsSource(groupId: string, topicId: string, d: NewsSourceInput): Promise<NewsSource | null> {
  const [topic] = await sql`select id from news_topics where id = ${topicId} and group_id = ${groupId}`;
  if (!topic) return null;
  const [r] = await sql`insert into news_sources (topic_id, name, url)
    values (${topicId}, ${d.name}, ${d.url})
    returning id, name, url, active, created_at`;
  return { id: r!.id as string, name: r!.name as string, url: r!.url as string, active: r!.active as boolean, created_at: r!.created_at as string };
}

export async function deleteNewsSource(groupId: string, topicId: string, id: string): Promise<void> {
  await sql`delete from news_sources s using news_topics t
    where s.id = ${id} and s.topic_id = ${topicId} and s.topic_id = t.id and t.group_id = ${groupId}`;
}

export async function upsertNewsRules(groupId: string, topicId: string, d: NewsRuleInput): Promise<NewsRule | null> {
  const [topic] = await sql`select id from news_topics where id = ${topicId} and group_id = ${groupId}`;
  if (!topic) return null;
  const [r] = await sql`insert into news_rules (topic_id, freshness_hours, min_sources, allowed_domains, blocked_domains, keywords)
    values (${topicId}, ${d.freshness_hours}, ${d.min_sources}, ${d.allowed_domains}, ${d.blocked_domains}, ${d.keywords})
    on conflict (topic_id) do update set
      freshness_hours = excluded.freshness_hours,
      min_sources = excluded.min_sources,
      allowed_domains = excluded.allowed_domains,
      blocked_domains = excluded.blocked_domains,
      keywords = excluded.keywords,
      updated_at = now()
    returning freshness_hours, min_sources, allowed_domains, blocked_domains, keywords, updated_at`;
  return {
    freshness_hours: r!.freshness_hours as number,
    min_sources: r!.min_sources as number,
    allowed_domains: r!.allowed_domains as string[],
    blocked_domains: r!.blocked_domains as string[],
    keywords: r!.keywords as string[],
    updated_at: r!.updated_at as string,
  };
}

export async function listActiveNewsSources(groupId: string, topicId: string): Promise<NewsSource[] | null> {
  const [topic] = await sql`select id from news_topics where id = ${topicId} and group_id = ${groupId}`;
  if (!topic) return null;
  const rows = await sql`select id, name, url, active, created_at from news_sources
    where topic_id = ${topicId} and active order by created_at desc`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, url: r.url as string, active: r.active as boolean, created_at: r.created_at as string }));
}

// Items already stored for a topic (url → status/reason) — ingest uses this to skip
// finished work: a used/valid item must never be overwritten by a re-fetch, and an
// AI-judged item is not re-scored (LLM cost + minutes of waiting).
export async function existingNewsItems(topicId: string): Promise<Map<string, { status: string; reason: string }>> {
  const rows = await sql`select url, status, reason from news_items where topic_id = ${topicId}`;
  return new Map(rows.map((r) => [r.url as string, { status: r.status as string, reason: (r.reason as string | null) ?? '' }]));
}

export async function getNewsTopicBrief(groupId: string, topicId: string): Promise<{ name: string; description: string } | null> {
  const [t] = await sql`select name, description from news_topics where id = ${topicId} and group_id = ${groupId}`;
  return t ? { name: t.name as string, description: t.description as string } : null;
}

export async function getNewsRules(groupId: string, topicId: string): Promise<NewsRule | null> {
  const [topic] = await sql`select id, created_at from news_topics where id = ${topicId} and group_id = ${groupId}`;
  if (!topic) return null;
  const [r] = await sql`select freshness_hours, min_sources, allowed_domains, blocked_domains, keywords, updated_at
    from news_rules where topic_id = ${topicId}`;
  if (!r) return { freshness_hours: 72, min_sources: 1, allowed_domains: [], blocked_domains: [], keywords: [], updated_at: topic.created_at as string };
  return {
    freshness_hours: r.freshness_hours as number,
    min_sources: r.min_sources as number,
    allowed_domains: r.allowed_domains as string[],
    blocked_domains: r.blocked_domains as string[],
    keywords: r.keywords as string[],
    updated_at: r.updated_at as string,
  };
}

export async function upsertNewsItem(topicId: string, sourceId: string, d: { title: string; url: string; domain: string; summary: string; published_at: Date | null; status: 'pending' | 'valid' | 'rejected'; score: number | null; reason: string }): Promise<NewsItem> {
  const [r] = await sql`insert into news_items (topic_id, source_id, title, url, domain, summary, published_at, status, score, reason)
    values (${topicId}, ${sourceId}, ${d.title}, ${d.url}, ${d.domain}, ${d.summary}, ${d.published_at}, ${d.status}, ${d.score}, ${d.reason})
    on conflict (topic_id, url) do update set
      title = excluded.title,
      source_id = excluded.source_id,
      domain = excluded.domain,
      summary = excluded.summary,
      published_at = excluded.published_at,
      status = excluded.status,
      score = excluded.score,
      reason = excluded.reason
    returning id, title, url, domain, summary, published_at, status, score, reason, post_id, created_at`;
  return itemOut(r!);
}

export async function listActiveNewsTopicIds(groupId: string): Promise<string[]> {
  const rows = await sql`select id from news_topics where group_id = ${groupId} and active order by created_at desc`;
  return rows.map((r) => r.id as string);
}

export async function setNewsTopicTemplate(groupId: string, topicId: string, templateId: string | null): Promise<boolean> {
  const rows = await sql`update news_topics set template_id = ${templateId}
    where id = ${topicId} and group_id = ${groupId} returning id`;
  return rows.length > 0;
}

// undefined = leave as-is, null = clear (→ group Settings)
export async function setNewsTopicCaption(groupId: string, topicId: string, d: { caption_cta?: string | null; caption_footer?: string | null }): Promise<boolean> {
  const rows = await sql`update news_topics set
    caption_cta = ${d.caption_cta === undefined ? sql`caption_cta` : d.caption_cta},
    caption_footer = ${d.caption_footer === undefined ? sql`caption_footer` : d.caption_footer}
    where id = ${topicId} and group_id = ${groupId} returning id`;
  return rows.length > 0;
}

// Caption override of the topic a news item belongs to (pipeline: generate time).
// The news topic an item belongs to: caption overrides + the topic definition
// (the writer's audience/angle comes from the TOPIC, not a hardcoded persona).
export async function getNewsItemTopic(itemId: string): Promise<{ name: string; description: string; caption_cta: string | null; caption_footer: string | null } | null> {
  const [r] = await sql`select t.name, t.description, t.caption_cta, t.caption_footer
    from news_items i join news_topics t on t.id = i.topic_id where i.id = ${itemId}`;
  if (!r) return null;
  return {
    name: r.name as string, description: r.description as string,
    caption_cta: (r.caption_cta as string | null) ?? null, caption_footer: (r.caption_footer as string | null) ?? null,
  };
}

export async function getNewsTopicTemplate(groupId: string, topicId: string): Promise<string | null | undefined> {
  const [r] = await sql`select template_id from news_topics where id = ${topicId} and group_id = ${groupId}`;
  if (!r) return undefined;
  return (r.template_id as string | null) ?? null;
}

export async function listNewsTopicsWithValidItems(groupId: string): Promise<{ id: string; name: string; n: number }[]> {
  const rows = await sql`select t.id, t.name, count(i.id)::int as n
    from news_topics t
    join news_items i on i.topic_id = t.id and i.status = 'valid' and i.post_id is null
    where t.group_id = ${groupId} and t.active
    group by t.id, t.name
    order by max(i.score) desc nulls last, max(i.published_at) desc nulls last, t.created_at desc
    limit 10`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, n: r.n as number }));
}

export async function listValidNewsItemsForTopic(topicId: string): Promise<{ id: string; title: string; domain: string; score: number | null; published_at: string | null }[]> {
  const rows = await sql`select id, title, domain, score, published_at
    from news_items
    where topic_id = ${topicId} and status = 'valid' and post_id is null
    order by score desc nulls last, published_at desc nulls last, created_at desc
    limit 8`;
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    domain: r.domain as string,
    score: (r.score as number | null) ?? null,
    published_at: (r.published_at as string | null) ?? null,
  }));
}

export async function getNewsItemGenerateContext(itemId: string): Promise<{ slug: string; groupId: string; topicId: string; templateId: string | null; title: string } | null> {
  const [r] = await sql`select g.slug, g.id as group_id, t.id as topic_id, t.template_id, i.title
    from news_items i
    join news_topics t on t.id = i.topic_id
    join groups g on g.id = t.group_id
    where i.id = ${itemId} and i.status = 'valid' and i.post_id is null and t.active
    limit 1`;
  if (!r) return null;
  return { slug: r.slug as string, groupId: r.group_id as string, topicId: r.topic_id as string, templateId: (r.template_id as string | null) ?? null, title: r.title as string };
}

export async function claimValidNewsItem(groupId: string, p?: { topicId?: string; itemId?: string }): Promise<NewsItem | null> {
  const [r] = p?.itemId
    ? await sql`select i.id, i.title, i.url, i.domain, i.summary, i.published_at, i.status, i.score, i.reason, i.post_id, i.created_at
      from news_items i
      join news_topics t on t.id = i.topic_id
      where t.group_id = ${groupId} and t.active and i.status = 'valid' and i.id = ${p.itemId} and (${p.topicId ?? null}::uuid is null or i.topic_id = ${p.topicId ?? null}::uuid)
      limit 1`
    : p?.topicId
      ? await sql`select i.id, i.title, i.url, i.domain, i.summary, i.published_at, i.status, i.score, i.reason, i.post_id, i.created_at
        from news_items i
        join news_topics t on t.id = i.topic_id
        where t.group_id = ${groupId} and t.active and i.status = 'valid' and i.topic_id = ${p.topicId}
        order by i.score desc nulls last, i.published_at desc nulls last, i.created_at desc
        limit 1`
      : await sql`select i.id, i.title, i.url, i.domain, i.summary, i.published_at, i.status, i.score, i.reason, i.post_id, i.created_at
        from news_items i
        join news_topics t on t.id = i.topic_id
        where t.group_id = ${groupId} and t.active and i.status = 'valid'
        order by i.score desc nulls last, i.published_at desc nulls last, i.created_at desc
        limit 1`;
  return r ? itemOut(r) : null;
}

export async function markNewsItemUsed(id: string, postId?: string): Promise<void> {
  await sql`update news_items set status = 'used', post_id = coalesce(${postId ?? null}, post_id) where id = ${id} and status = 'valid'`;
}

export async function deleteNewsItems(groupId: string, topicId: string, ids?: string[], status?: string): Promise<number> {
  const rows = ids?.length
    ? await sql`delete from news_items i using news_topics t
      where i.topic_id = ${topicId} and i.topic_id = t.id and t.group_id = ${groupId} and i.id = any(${ids}::uuid[])
      returning i.id`
    : await sql`delete from news_items i using news_topics t
      where i.topic_id = ${topicId} and i.topic_id = t.id and t.group_id = ${groupId} and i.status = ${status ?? 'rejected'}
      returning i.id`;
  return rows.length;
}
