// Promotions repository (group-scoped). Content slides + image slots derived from {{image}} usage.
import { sql } from '../db/pool.ts';
import type { Promotion, PromotionInput, PromoSlide, PromoImageSlot } from '@workspace/shared';

type Row = {
  id: string; group_id: string; name: string; topic: string;
  features: string[]; stacks: string[]; stats: string[];
  price: string; price_sale: string; template_id: string | null;
  content: PromoSlide[] | string | null; status: Promotion['status'];
  created_at: Date; sent_at: Date | null;
};

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw) as T; } catch { return null; } }
  return raw as T;
}

function toOut(r: Row): Promotion {
  return {
    id: r.id, name: r.name, topic: r.topic,
    features: Array.isArray(r.features) ? r.features : [],
    stacks: Array.isArray(r.stacks) ? r.stacks : [],
    stats: Array.isArray(r.stats) ? r.stats : [],
    price: r.price, price_sale: r.price_sale, template_id: r.template_id ?? null,
    content: parseJson<PromoSlide[]>(r.content),
    status: r.status,
    created_at: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
  };
}

const COLS = 'id, group_id, name, topic, features, stacks, stats, price, price_sale, template_id, content, status, created_at, sent_at';

export async function listPromotions(groupId: string): Promise<Promotion[]> {
  const rows = await sql<Row[]>`select id, group_id, name, topic, features, stacks, stats, price, price_sale, template_id, content, status, created_at, sent_at
    from promotions where group_id = ${groupId} order by id desc limit 100`;
  return rows.map(toOut);
}

export async function getPromotion(groupId: string, id: string): Promise<Promotion | null> {
  const [r] = await sql<Row[]>`select id, group_id, name, topic, features, stacks, stats, price, price_sale, template_id, content, status, created_at, sent_at
    from promotions where id = ${id} and group_id = ${groupId}`;
  return r ? toOut(r) : null;
}

export async function createPromotion(groupId: string, d: PromotionInput): Promise<Promotion> {
  const j = (v: unknown) => JSON.stringify(v ?? []);
  const [r] = await sql<Row[]>`insert into promotions (group_id, name, topic, features, stacks, stats, price, price_sale, template_id)
    values (${groupId}, ${d.name}, ${d.topic}, ${j(d.features)}::jsonb, ${j(d.stacks)}::jsonb, ${j(d.stats)}::jsonb,
      ${d.price}, ${d.price_sale}, ${d.template_id})
    returning id, group_id, name, topic, features, stacks, stats, price, price_sale, template_id, content, status, created_at, sent_at`;
  if (!r) throw new Error('insert promotion failed');
  return toOut(r);
}

export async function updatePromotion(groupId: string, id: string, d: PromotionInput): Promise<boolean> {
  const j = (v: unknown) => JSON.stringify(v ?? []);
  const r = await sql`update promotions set
    name = ${d.name}, topic = ${d.topic}, features = ${j(d.features)}::jsonb, stacks = ${j(d.stacks)}::jsonb,
    stats = ${j(d.stats)}::jsonb, price = ${d.price}, price_sale = ${d.price_sale}, template_id = ${d.template_id}
    where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

export async function setContent(id: string, slides: PromoSlide[]): Promise<void> {
  await sql`update promotions set content = ${JSON.stringify(slides)}::jsonb,
    status = case when ${JSON.stringify(slides)}::jsonb::text like '%{{image}}%' then 'awaiting_images' else 'ready' end
    where id = ${id}`;
}

// Regen variant: replaces the slides AND pins a (possibly different) template —
// the AI re-writes against the new template's CSS vocabulary. Image slots
// recompute from the new content; uploaded images at surviving indices persist.
export async function setContentWithTemplate(id: string, slides: PromoSlide[], templateId: string | null): Promise<void> {
  await sql`update promotions set content = ${JSON.stringify(slides)}::jsonb, template_id = ${templateId},
    status = case when ${JSON.stringify(slides)}::jsonb::text like '%{{image}}%' then 'awaiting_images' else 'ready' end
    where id = ${id}`;
}

// Switch the pinned template only (re-render with a different look: same content,
// new design system). The promo keeps its sent history — the row just reflects
// its CURRENT visual identity.
export async function setPromotionTemplate(id: string, templateId: string | null): Promise<void> {
  await sql`update promotions set template_id = ${templateId} where id = ${id}`;
}

export async function markPromotionSent(id: string): Promise<void> {
  await sql`update promotions set status = 'sent', sent_at = now() where id = ${id}`;
}

export async function deletePromotion(groupId: string, id: string): Promise<boolean> {
  const r = await sql`delete from promotions where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

// Derived image slots: slides whose html embeds {{image}}; file names are slide-NN.(png|jpg).
// Stored-object check is the caller's job (needs MinIO access).
export function imageSlots(p: Promotion): { slide: number; prompt: string }[] {
  const out: { slide: number; prompt: string }[] = [];
  (p.content ?? []).forEach((s, i) => {
    if (s.html.includes('{{image}}')) out.push({ slide: i + 1, prompt: s.image_prompt ?? '' });
  });
  return out;
}
