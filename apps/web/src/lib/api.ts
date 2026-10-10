// Typed API client — fetch wrapper. Semua resource scope group: /g/:slug/...
import type { Promotion, PromotionInput, UsageReport, Pillar, PostSummary, PostDetail, StyleSample, Template, TemplateDetail, Dashboard, CronSettings, Group, GroupInputBody, AuthMe, UserRow, UserInputBody, CalendarRun, Override, Plan, PlanInput, Idea, NewsTopic, NewsTopicDetail, NewsRule, NewsItemDetail, NewsFetchUrlsResult, NewsItemsPage, NewsItemsQuery, PillarSuggestion, StyleSuggestion, Tutorial, TutorialInput } from '@workspace/shared';

export type { NewsFetchUrlsResult }

export type IngestProgress = {
  state: 'running' | 'done' | 'failed';
  phase: string;
  feeds: { total: number; done: number; failed: number };
  items: { total: number; done: number };
  result: { fetched: number; saved: number; valid: number; rejected: number; skipped: number; feedsFailed: number } | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
};

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
  const ctrl = new AbortController();
  const timeout = window.setTimeout(() => ctrl.abort(), 180_000);
  let res: Response;
  try {
    res = await fetch(path, {
      headers: init?.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      ...init,
      signal: init?.signal ?? ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError(408, 'Request timed out. The server may still be working; refresh status before retrying.');
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // daemon health (root, unauthed) — powers the header status strip
  health: () => req<{ ok: boolean; db: boolean; stuck: boolean; queue: { running: boolean; pending: number } }>('/health'),
  // live pipeline telemetry (authed) — the single active queue run
  queueLive: () => req<{
    run: {
      active: boolean; kind: string; slug: string; postId: string | null;
      stage: string; detail: string | null; startedAt: number; updatedAt: number; error: string | null;
    } | null;
    queue: { running: boolean; pending: number };
  }>(`${BASE}/queue/live`),
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
  suggestPillars: (slug: string, brief: string, signal?: AbortSignal) =>
    req<{ pillars: PillarSuggestion[] }>(`${g(slug)}/pillars/suggest`, { method: 'POST', body: JSON.stringify({ brief }), signal }),
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
  promoVideo: (slug: string, id: string, audio: 'silent' | 'voice', send = true) =>
    req<{ ok: true }>(`${g(slug)}/promotions/${id}/video`, { method: 'POST', body: JSON.stringify({ audio, send }) }),
  schedulePromotion: (slug: string, id: string, for_date: string) => req<Plan>(`${g(slug)}/promotions/${id}/schedule`, { method: 'POST', body: JSON.stringify({ for_date }) }),
  addPlan: (slug: string, p: PlanInput) => req<Plan>(`${g(slug)}/plans`, { method: 'POST', body: JSON.stringify(p) }),
  cancelPlan: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/plans/${id}/cancel`, { method: 'POST' }),
  delPlan: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/plans/${id}`, { method: 'DELETE' }),
  gen: (slug: string, opts?: { platform?: string; format?: string }) =>
    req<{ ok: true }>(`${g(slug)}/gen`, { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  regenPost: (slug: string, id: string) =>
    req<{ ok: true }>(`${g(slug)}/posts/${id}/regenerate`, { method: 'POST' }),
  regenPostFormat: (slug: string, id: string, platform: string, format: string) =>
    req<{ ok: true }>(`${g(slug)}/posts/${id}/regenerate-format`, { method: 'POST', body: JSON.stringify({ platform, format }) }),
  polishOverride: (slug: string, d: { name: string; type: string; description: string }) =>
    req<{ polished: string }>(`${g(slug)}/overrides/polish`, { method: 'POST', body: JSON.stringify(d) }),
  resendOverride: (slug: string, id: string) =>
    req<{ ok: true }>(`${g(slug)}/overrides/${id}/resend`, { method: 'POST' }),
  patchOverrideDescription: (slug: string, id: string, description: string) =>
    req<{ ok: true }>(`${g(slug)}/overrides/${id}`, { method: 'PATCH', body: JSON.stringify({ description }) }),
  regeneratePromo: (slug: string, id: string, template_id?: string | null) =>
    req<{ ok: true; slides: number; templateChanged: boolean }>(`${g(slug)}/promotions/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ template_id: template_id ?? null }) }),
  // template_id semantics: undefined = keep the promo's current template (plain
  // re-render); null = switch to the built-in default; 'uuid' = switch to it.
  rerenderPromo: (slug: string, id: string, template_id?: string | null) =>
    req<{ ok: true }>(`${g(slug)}/promotions/${id}/rerender`, { method: 'POST', body: JSON.stringify(template_id === undefined ? {} : { template_id }) }),
  starPost: (slug: string, id: string) => req<{ ok: true; starred: boolean }>(`${g(slug)}/posts/${id}/star`, { method: 'POST' }),
  styles: (slug: string) => req<StyleSample[]>(`${g(slug)}/styles`),
  addStyle: (slug: string, s: { title: string; body: string; platform?: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/styles`, { method: 'POST', body: JSON.stringify(s) }),
  suggestStyles: (slug: string, signal?: AbortSignal) => req<{ samples: StyleSuggestion[] }>(`${g(slug)}/styles/suggest`, { method: 'POST', signal }),
  delStyle: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/styles/${id}`, { method: 'DELETE' }),
  patchStyle: (slug: string, id: string, s: { title: string; body: string; platform: string | null }) =>
    req<{ ok: true }>(`${g(slug)}/styles/${id}`, { method: 'PATCH', body: JSON.stringify(s) }),
  ideas: (slug: string) => req<Idea[]>(`${g(slug)}/ideas`),
  addIdea: (slug: string, text: string) => req<Idea>(`${g(slug)}/ideas`, { method: 'POST', body: JSON.stringify({ text }) }),
  delIdea: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/ideas/${id}`, { method: 'DELETE' }),
  newsTopics: (slug: string) => req<NewsTopic[]>(`${g(slug)}/news/topics`),
  addNewsTopic: (slug: string, p: { name: string; description?: string }) => req<NewsTopic>(`${g(slug)}/news/topics`, { method: 'POST', body: JSON.stringify(p) }),
  newsTopic: (slug: string, id: string) => req<NewsTopicDetail>(`${g(slug)}/news/topics/${id}`),
  newsItems: (slug: string, topicId: string, q: Partial<NewsItemsQuery>) =>
    req<NewsItemsPage>(`${g(slug)}/news/topics/${topicId}/items?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  newsItem: (slug: string, topicId: string, itemId: string) => req<NewsItemDetail>(`${g(slug)}/news/topics/${topicId}/items/${itemId}`),
  fetchNewsUrls: (slug: string, topicId: string, urls: string[]) =>
    req<NewsFetchUrlsResult>(`${g(slug)}/news/topics/${topicId}/items/fetch-url`, { method: 'POST', body: JSON.stringify({ urls }) }),
  delNewsTopic: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/news/topics/${id}`, { method: 'DELETE' }),
  addNewsSource: (slug: string, topicId: string, p: { name: string; url: string }) => req<NewsTopicDetail['sources'][number]>(`${g(slug)}/news/topics/${topicId}/sources`, { method: 'POST', body: JSON.stringify(p) }),
  delNewsSource: (slug: string, topicId: string, sourceId: string) => req<{ ok: true }>(`${g(slug)}/news/topics/${topicId}/sources/${sourceId}`, { method: 'DELETE' }),
  saveNewsRules: (slug: string, topicId: string, p: { freshness_hours: number; min_sources: number; allowed_domains: string[]; blocked_domains: string[]; keywords: string[] }) => req<NewsRule>(`${g(slug)}/news/topics/${topicId}/rules`, { method: 'PUT', body: JSON.stringify(p) }),
  ingestNews: (slug: string, topicId: string) => req<{ ok: true; started: boolean; progress: IngestProgress | null }>(`${g(slug)}/news/topics/${topicId}/ingest`, { method: 'POST' }),
  ingestStatus: (slug: string, topicId: string) => req<{ progress: IngestProgress | null }>(`${g(slug)}/news/topics/${topicId}/ingest/status`),
  autofillNews: (slug: string, topicId: string) => req<NewsTopicDetail>(`${g(slug)}/news/topics/${topicId}/autofill`, { method: 'POST' }),
  deleteNewsItems: (slug: string, topicId: string, p: { ids?: string[]; status?: 'pending' | 'valid' | 'rejected' | 'used' }) => req<{ ok: true; deleted: number }>(`${g(slug)}/news/topics/${topicId}/items/delete`, { method: 'POST', body: JSON.stringify(p) }),
  saveNewsCaption: (slug: string, topicId: string, p: { caption_cta: string; caption_footer: string }) => req<{ ok: true }>(`${g(slug)}/news/topics/${topicId}/caption`, { method: 'PUT', body: JSON.stringify(p) }),
  savePromoCaption: (slug: string, id: string, p: { caption_cta: string; caption_footer: string }) => req<{ ok: true }>(`${g(slug)}/promotions/${id}/caption`, { method: 'PUT', body: JSON.stringify(p) }),
  patchOverrideCaption: (slug: string, id: string, p: { caption_cta: string; caption_footer: string }) => req<{ ok: true }>(`${g(slug)}/overrides/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  saveNewsTemplate: (slug: string, topicId: string, t: { template_id: string | null; template_reel_id: string | null; use_source_images: boolean }) => req<{ ok: true }>(`${g(slug)}/news/topics/${topicId}/template`, { method: 'PUT', body: JSON.stringify(t) }),
  generateNews: (slug: string, topicId: string, p: { item_id?: string; language?: string; format?: 'carousel' | 'reels' } = {}) => req<{ ok: true; queued: { running: boolean; pending: number } }>(`${g(slug)}/news/topics/${topicId}/generate`, { method: 'POST', body: JSON.stringify(p) }),
  tutorials: (slug: string) => req<Tutorial[]>(`${g(slug)}/tutorials`),
  addTutorial: (slug: string, t: TutorialInput) => req<Tutorial>(`${g(slug)}/tutorials`, { method: 'POST', body: JSON.stringify(t) }),
  delTutorial: (slug: string, id: string) => req<{ ok: true }>(`${g(slug)}/tutorials/${id}`, { method: 'DELETE' }),
  generateTutorial: (slug: string, id: string, format: 'carousel' | 'reels') => req<{ ok: true }>(`${g(slug)}/tutorials/${id}/generate`, { method: 'POST', body: JSON.stringify({ format }) }),
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
