// Typed API client — fetch wrapper + zod parsing via @workspace/shared.
import type { Pillar, PostSummary, PostDetail, StyleSample, Template, Dashboard, CronSettings } from '@workspace/shared';

const BASE = '/api';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboard: () => req<Dashboard>('/dashboard'),
  pillars: () => req<Pillar[]>('/pillars'),
  addPillar: (p: { name: string; description: string; is_news?: boolean; sort_order?: number }) =>
    req<{ ok: true }>('/pillars', { method: 'POST', body: JSON.stringify(p) }),
  togglePillar: (id: number) => req<{ ok: true }>(`/pillars/${id}/toggle`, { method: 'POST' }),
  delPillar: (id: number) => req<{ ok: true }>(`/pillars/${id}`, { method: 'DELETE' }),
  cron: () => req<CronSettings>('/cron'),
  saveCron: (expr: string, enabled: boolean) =>
    req<CronSettings>('/cron', { method: 'POST', body: JSON.stringify({ expr, enabled }) }),
  posts: () => req<PostSummary[]>('/posts'),
  post: (id: number) => req<PostDetail>(`/posts/${id}`),
  resend: (id: number) => req<{ ok: true }>(`/posts/${id}/resend`, { method: 'POST' }),
  gen: (opts?: { platform?: string; format?: string }) =>
    req<{ ok: true }>(`/gen`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  styles: () => req<StyleSample[]>('/styles'),
  addStyle: (s: { title: string; body: string; platform?: string | null }) =>
    req<{ ok: true }>('/styles', { method: 'POST', body: JSON.stringify(s) }),
  delStyle: (id: number) => req<{ ok: true }>(`/styles/${id}`, { method: 'DELETE' }),
  templates: () => req<Template[]>('/templates'),
  addTemplate: (t: { name: string; format: string; html: string; is_active?: boolean }) =>
    req<{ ok: true }>('/templates', { method: 'POST', body: JSON.stringify(t) }),
  activateTemplate: (id: number) => req<{ ok: true }>(`/templates/${id}/activate`, { method: 'POST' }),
  delTemplate: (id: number) => req<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' }),
};
export { ApiError };
