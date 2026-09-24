// Template repository (group-scoped). REGULAR templates: MULTIPLE active per format
// is the norm — the pipeline picks randomly from the active pool (variety), so
// activate is a POOL TOGGLE. Override/promo types stay exclusive: one active per
// (format, type) — they're chosen deliberately, not rotated.
// One row = one visual package: html (body), html_first (cover, nullable), html_last (CTA, nullable).
// type: 'regular' = pipeline rendering; 'mix'|'image_only'|'text_only' = for override content.
import { sql } from '../db/pool.ts';
import type { Template, TemplateDetail, TemplateFormat, TemplateType } from '@workspace/shared';

export async function listTemplates(groupId: string, limit = 50): Promise<Template[]> {
  const rows = await sql`select id, name, format, type, is_active, updated_at
    from templates where group_id = ${groupId} order by id desc limit ${limit}`;
  return rows.map((t) => ({
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    type: (t.type as TemplateType) ?? 'regular', is_active: t.is_active as boolean,
    updated_at: t.updated_at as string,
  }));
}

export async function getTemplate(groupId: string, id: string): Promise<TemplateDetail | null> {
  const [t] = await sql`select id, name, format, type, is_active, updated_at, html, html_first, html_last
    from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return null;
  return {
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    type: (t.type as TemplateType) ?? 'regular', is_active: t.is_active as boolean,
    updated_at: t.updated_at as string,
    html: t.html as string,
    html_first: (t.html_first as string | null) ?? null,
    html_last: (t.html_last as string | null) ?? null,
  };
}

export async function createTemplate(groupId: string, d: {
  name: string; format: string; type: string; html: string; html_first: string | null; html_last: string | null; is_active: boolean;
}): Promise<void> {
  // override/promo types: exclusive activate (one active per format+type).
  // regular: active = joins the rotation pool — siblings stay active.
  if (d.is_active && d.type !== 'regular') {
    await sql`update templates set is_active = false
      where format = ${d.format} and type = ${d.type} and group_id = ${groupId}`;
  }
  await sql`insert into templates (group_id, name, format, type, html, html_first, html_last, is_active)
    values (${groupId}, ${d.name}, ${d.format}, ${d.type}, ${d.html}, ${d.html_first}, ${d.html_last}, ${d.is_active})`;
}

// Regular templates: toggle this row in/out of the rotation pool.
// Override/promo types: exclusive activate (deactivates siblings of the same format+type).
export async function activateTemplate(groupId: string, id: string): Promise<void> {
  const [t] = await sql<{ format: string; type: string; is_active: boolean }[]>`select format, type, is_active from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return;
  if (t.type === 'regular') {
    await sql`update templates set is_active = ${!t.is_active}, updated_at = now()
      where id = ${id} and group_id = ${groupId}`;
    return;
  }
  await sql`update templates set is_active = false
    where format = ${t.format} and type = ${t.type} and group_id = ${groupId}`;
  await sql`update templates set is_active = true where id = ${id} and group_id = ${groupId}`;
}

export async function deleteTemplate(groupId: string, id: string): Promise<void> {
  await sql`delete from templates where id = ${id} and group_id = ${groupId}`;
}

// Edit name + html parts (format & type immutable — delete + recreate instead;
// is_active via activate). False when not found → API 404.
export async function updateTemplate(groupId: string, id: string, d: {
  name: string; html: string; html_first: string | null; html_last: string | null;
}): Promise<boolean> {
  const r = await sql`update templates set
    name = ${d.name}, html = ${d.html}, html_first = ${d.html_first}, html_last = ${d.html_last},
    updated_at = now()
    where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}
