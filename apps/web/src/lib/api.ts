// Typed API client — fetch wrapper. Semua resource scope group: /g/:slug/...
import type { Pillar, PostSummary, PostDetail, StyleSample, Template, Dashboard, CronSettings, Group, GroupInputBody, AuthMe, UserRow, UserInputBody, CalendarRun } from '@workspace/shared';

const BASE = '/api';
const g = (slug: string) => `${BASE}/g/${slug}`;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 401 dari API mana pun → session mati → pindah ke /login.
function onUnauthorized() {
  if (location.pathname !== '/login') history.pushState(null, '', '/login');
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new CustomEvent('cg-unauthorized'));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // auth
  login: (username: string, password: string) =>
    req<{ ok: true; user: AuthMe }>(`${BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req<{ ok: true }>(`${BASE}/auth/logout`, { method: 'POST' }),
  me: () => req<AuthMe>(`${BASE}/auth/me`),
  // groups (multi-akun)
  groups: () => req<Group[]>(`${BASE}/groups`),
  group: (slug: string) => req<Group>(`${BASE}/groups/${slug}`),
  createGroup: (d: GroupInputBody) => req<Group>(`${BASE}/groups`, { method: 'POST', body: JSON.stringify(d) }),
  patchGroup: (slug: string, d: Record<string, unknown>) =>
    req<Group>(`${BASE}/groups/${slug}`, { method: 'PATCH', body: JSON.stringify(d) }),
  delGroup: (slug: string) => req<{ ok: true }>(`${BASE}/groups/${slug}`, { method: 'DELETE' }),

  // users (admin)
  users: () => req<UserRow[]>(`${BASE}/users`),
  addUser: (d: UserInputBody) => req<UserRow>(`${BASE}/users`, { method: 'POST', body: JSON.stringify(d) }),
  resetUserPass: (id: string, password: string) =>
    req<{ ok: true }>(`${BASE}/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  delUser: (id: string) => req<{ ok: true }>(`${BASE}/users/${id}`, { method: 'DELETE' }),

  // scope group
  dashboard: (slug: string) => req<Dashboard>(`${g(slug)}/dashboard`),
  pillars: (slug: string) => req<Pillar[]>(`${g(slug)}/pillars`),
  addPillar: (slug: string, p: { name: string; description: string; is_news?: boolean; sort_order?: number }) =>
    req<{ ok: true }>(`${g(slug)}/pillars`, { method: 'POST', body: JSON.stringify(p) }),
  togglePillar: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/pillars/${id}/toggle`, { method: 'POST' }),
  delPillar: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/pillars/${id}`, { method: 'DELETE' }),
  cron: (slug: string) => req<CronSettings>(`${g(slug)}/cron`),
  saveCron: (slug: string, expr: string, enabled: boolean) =>
    req<CronSettings>(`${g(slug)}/cron`, { method: 'POST', body: JSON.stringify({ expr, enabled }) }),
  posts: (slug: string) => req<PostSummary[]>(`${g(slug)}/posts`),
  post: (slug: string, id: string) => req<PostDetail>(`${g(slug)}/posts/${id}`),
  resend: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/resend`, { method: 'POST' }),
  approve: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/approve`, { method: 'POST' }),
  reject: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/reject`, { method: 'POST' }),
  calendar: (slug: string, n = 7) => req<CalendarRun[]>(`${g(slug)}/calendar?n=${n}`),
  gen: (slug: string, opts?: { platform?: string; format?: string }) =>
    req<{ ok: true }>(`${g(slug)}/gen`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  styles: (slug: string) => req<StyleSample[]>(`${g(slug)}/styles`),
  addStyle: (slug: string, s: { title: string; body: string; platform?: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/styles`, { method: 'POST', body: JSON.stringify(s) }),
  delStyle: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/styles/${id}`, { method: 'DELETE' }),
  templates: (slug: string) => req<Template[]>(`${g(slug)}/templates`),
  addTemplate: (slug: string, t: { name: string; format: string; html: string; is_active?: boolean }) =>
    req<{ ok: true }>(`${g(slug)}/templates`, { method: 'POST', body: JSON.stringify(t) }),
  activateTemplate: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/templates/${id}/activate`, { method: 'POST' }),
  delTemplate: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/templates/${id}`, { method: 'DELETE' }),
};
export { ApiError };
