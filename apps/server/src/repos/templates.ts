// Template repository (group-scoped). 1 active per (format, kind) — deactivate siblings first.
// kind: body = middle slides, first = cover page ({{image}}), last = CTA page.
import { sql } from '../db/pool.ts';
import type { Template, TemplateDetail, TemplateFormat, TemplateKind } from '@workspace/shared';

export async function listTemplates(groupId: string, limit = 50): Promise<Template[]> {
  const rows = await sql`select id, name, format, kind, is_active, updated_at
    from templates where group_id = ${groupId} order by id desc limit ${limit}`;
  return rows.map((t) => ({
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    kind: (t.kind as TemplateKind) ?? 'body', is_active: t.is_active as boolean,
    updated_at: t.updated_at as string,
  }));
}

export async function getTemplate(groupId: string, id: string): Promise<TemplateDetail | null> {
  const [t] = await sql`select id, name, format, kind, is_active, updated_at, html
    from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return null;
  return {
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    kind: (t.kind as TemplateKind) ?? 'body', is_active: t.is_active as boolean,
    updated_at: t.updated_at as string, html: t.html as string,
  };
}

export async function createTemplate(groupId: string, d: { name: string; format: string; kind: string; html: string; is_active: boolean }): Promise<void> {
  if (d.is_active) {
    await sql`update templates set is_active = false
      where format = ${d.format} and kind = ${d.kind} and group_id = ${groupId}`;
  }
  await sql`insert into templates (group_id, name, format, kind, html, is_active)
    values (${groupId}, ${d.name}, ${d.format}, ${d.kind}, ${d.html}, ${d.is_active})`;
}

export async function activateTemplate(groupId: string, id: string): Promise<void> {
  const [t] = await sql`select format, kind from templates where id = ${id} and group_id = ${groupId}`;
  if (!t) return;
  await sql`update templates set is_active = false
    where format = ${t.format} and kind = ${t.kind} and group_id = ${groupId}`;
  await sql`update templates set is_active = true where id = ${id} and group_id = ${groupId}`;
}

export async function deleteTemplate(groupId: string, id: string): Promise<void> {
  await sql`delete from templates where id = ${id} and group_id = ${groupId}`;
}

// Edit name + html (format + kind immutable — see shared TemplateEdit). False when not found → API 404.
export async function updateTemplate(groupId: string, id: string, d: { name: string; html: string }): Promise<boolean> {
  const r = await sql`update templates set
    name = ${d.name}, html = ${d.html}, updated_at = now()
    where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}
