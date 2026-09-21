// Template repository (group-scoped). 1 active per format — deactivate siblings first.
// One row = one visual package: html (body), html_first (cover, nullable), html_last (CTA, nullable).
import { sql } from '../db/pool.ts';
import type { Template, TemplateDetail, TemplateFormat } from '@workspace/shared';

export async function listTemplates(groupId: string, limit = 50): Promise<Template[]> {
  const rows = await sql`select id, name, format, is_active, updated_at
    from templates where group_id = ${groupId} order by id desc limit ${limit}`;
  return rows.map((t) => ({
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    is_active: t.is_active as boolean, updated_at: t.updated_at as string,
  }));
}

export async function getTemplate(groupId: string, id: string): Promise<TemplateDetail | null> {
  const [t] = await sql`select id, name, format, is_active, updated_at, html, html_first, html_last
    from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return null;
  return {
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    is_active: t.is_active as boolean, updated_at: t.updated_at as string,
    html: t.html as string,
    html_first: (t.html_first as string | null) ?? null,
    html_last: (t.html_last as string | null) ?? null,
  };
}

export async function createTemplate(groupId: string, d: {
  name: string; format: string; html: string; html_first: string | null; html_last: string | null; is_active: boolean;
}): Promise<void> {
  if (d.is_active) {
    await sql`update templates set is_active = false
      where format = ${d.format} and group_id = ${groupId}`;
  }
  await sql`insert into templates (group_id, name, format, html, html_first, html_last, is_active)
    values (${groupId}, ${d.name}, ${d.format}, ${d.html}, ${d.html_first}, ${d.html_last}, ${d.is_active})`;
}

export async function activateTemplate(groupId: string, id: string): Promise<void> {
  const [t] = await sql`select format from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return;
  await sql`update templates set is_active = false
    where format = ${t.format} and group_id = ${groupId}`;
  await sql`update templates set is_active = true where id = ${id} and group_id = ${groupId}`;
}

export async function deleteTemplate(groupId: string, id: string): Promise<void> {
  await sql`delete from templates where id = ${id} and group_id = ${groupId}`;
}

// Edit name + html parts (format immutable — one-active-per-format constraint makes
// format changes deactivation juggling; delete + recreate instead; is_active via activate).
// False when not found → API 404.
export async function updateTemplate(groupId: string, id: string, d: {
  name: string; html: string; html_first: string | null; html_last: string | null;
}): Promise<boolean> {
  const r = await sql`update templates set
    name = ${d.name}, html = ${d.html}, html_first = ${d.html_first}, html_last = ${d.html_last},
    updated_at = now()
    where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}
