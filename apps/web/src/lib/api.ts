// Typed API client — fetch wrapper. Semua resource scope group: /g/:slug/...
import type { Promotion, PromotionInput, UsageReport, Pillar, PostSummary, PostDetail, StyleSample, Template, TemplateDetail, Dashboard, CronSettings, Group, GroupInputBody, AuthMe, UserRow, UserInputBody, CalendarRun, Override, Plan, PlanInput, Idea } from '@workspace/shared';

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
    headers: init?.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
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
  usage: (days = 30) => req<UsageReport>(`${BASE}/usage?days=${days}`),
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
  patchPillar: (slug: string, id: string, p: { name: string; description: string; is_news: boolean; sort_order: number }) =>
    req<Pillar[]>(`${g(slug)}/pillars/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  cron: (slug: string) => req<CronSettings>(`${g(slug)}/cron`),
  saveCron: (slug: string, expr: string, enabled: boolean) =>
    req<CronSettings>(`${g(slug)}/cron`, { method: 'POST', body: JSON.stringify({ expr, enabled }) }),
  posts: (slug: string) => req<PostSummary[]>(`${g(slug)}/posts`),
  post: (slug: string, id: string) => req<PostDetail>(`${g(slug)}/posts/${id}`),
  postEvents: (slug: string, id: string) => req<{ id: string; event: string; error: string | null; created_at: string }[]>(`${g(slug)}/posts/${id}/events`),
  /** artifact URL for direct <img>/<video>/<iframe> src — session cookie rides along (same-origin) */
  artifactUrl: (slug: string, id: string, file: string) => `${g(slug)}/posts/${id}/artifacts/${file}`,
  resend: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/resend`, { method: 'POST' }),
  approve: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/approve`, { method: 'POST' }),
  reject: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/reject`, { method: 'POST' }),
  rerender: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/rerender`, { method: 'POST' }),
  skipCover: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/posts/${id}/skip-cover`, { method: 'POST' }),
  calendar: (slug: string, n = 7) => req<CalendarRun[]>(`${g(slug)}/calendar?n=${n}`),

  // overrides
  overrides: (slug: string) => req<Override[]>(`${g(slug)}/overrides`),
  addOverride: (slug: string, form: FormData) =>
    req<Override>(`${g(slug)}/overrides`, { method: 'POST', body: form }),
  overrideImageUrl: (slug: string, id: string, file: string) => `${g(slug)}/overrides/${id}/images/${file}`,
  cancelOverride: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/overrides/${id}/cancel`, { method: 'POST' }),
  delOverride: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/overrides/${id}`, { method: 'DELETE' }),

  // plans
  plans: (slug: string) => req<Plan[]>(`${g(slug)}/plans`),

  // promotions
  promotions: (slug: string) => req<Promotion[]>(`${g(slug)}/promotions`),
  promotion: (slug: string, id: string) => req<Promotion>(`${g(slug)}/promotions/${id}`),
  addPromotion: (slug: string, p: PromotionInput | { brief: string }) => req<Promotion>(`${g(slug)}/promotions`, { method: 'POST', body: JSON.stringify(p) }),
  patchPromotion: (slug: string, id: string, p: PromotionInput) => req<{ ok: true }>(`${g(slug)}/promotions/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  delPromotion: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/promotions/${id}`, { method: 'DELETE' }),
  generatePromoContent: (slug: string, id: string) => req<{ ok: true; slides: number; imageSlots: { slide: number; prompt: string }[] }>(`${g(slug)}/promotions/${id}/generate-content`, { method: 'POST' }),
  promoImageSlots: (slug: string, id: string) => req<{ slide: number; prompt: string; present: boolean }[]>(`${g(slug)}/promotions/${id}/image-slots`),
  uploadPromoImage: (slug: string, id: string, slide: number, file: File) => {
    const fd = new FormData();
    fd.set('slide', String(slide));
    fd.append('file', file, file.name);
    return req<{ ok: true; allImagesPresent: boolean }>(`${g(slug)}/promotions/${id}/images`, { method: 'POST', body: fd });
  },
  sendPromotion: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/promotions/${id}/send`, { method: 'POST' }),
  schedulePromotion: (slug: string, id: string, for_date: string) => req<Plan>(`${g(slug)}/promotions/${id}/schedule`, { method: 'POST', body: JSON.stringify({ for_date }) }),
  addPlan: (slug: string, p: PlanInput) => req<Plan>(`${g(slug)}/plans`, { method: 'POST', body: JSON.stringify(p) }),
  cancelPlan: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/plans/${id}/cancel`, { method: 'POST' }),
  delPlan: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/plans/${id}`, { method: 'DELETE' }),
  gen: (slug: string, opts?: { platform?: string; format?: string }) =>
    req<{ ok: true }>(`${g(slug)}/gen`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  styles: (slug: string) => req<StyleSample[]>(`${g(slug)}/styles`),
  addStyle: (slug: string, s: { title: string; body: string; platform?: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/styles`, { method: 'POST', body: JSON.stringify(s) }),
  delStyle: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/styles/${id}`, { method: 'DELETE' }),
  patchStyle: (slug: string, id: string, s: { title: string; body: string; platform: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/styles/${id}`, { method: 'PATCH', body: JSON.stringify(s) }),
  ideas: (slug: string) => req<Idea[]>(`${g(slug)}/ideas`),
  addIdea: (slug: string, text: string) => req<Idea>(`${g(slug)}/ideas`, { method: 'POST', body: JSON.stringify({ text }) }),
  delIdea: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/ideas/${id}`, { method: 'DELETE' }),
  templates: (slug: string) => req<Template[]>(`${g(slug)}/templates`),
  template: (slug: string, id: string) => req<TemplateDetail>(`${g(slug)}/templates/${id}`),
  patchTemplate: (slug: string, id: string, t: { name: string; html: string; html_first: string | null; html_last: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/templates/${id}`, { method: 'PATCH', body: JSON.stringify(t) }),
  addTemplate: (slug: string, t: { name: string; format: string; type?: string; html: string; html_first?: string | null; html_last?: string | null; is_active?: boolean }) =>
    req<{ ok: true }>(`${g(slug)}/templates`, { method: 'POST', body: JSON.stringify(t) }),
  activateTemplate: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/templates/${id}/activate`, { method: 'POST' }),
  delTemplate: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/templates/${id}`, { method: 'DELETE' }),
};
export { ApiError };
