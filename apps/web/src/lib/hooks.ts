// Small data-fetch hooks — no react-query, stdlib fetch + useEffect.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Pillar, PostSummary, PostDetail, StyleSample, Template, Dashboard, CronSettings, Group } from '@workspace/shared';

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetcher()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'gagal memuat'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload };
}

export const useGroups = () => useApi<Group[]>(api.groups);
export const useDashboard = (slug: string) => useApi<Dashboard>(() => api.dashboard(slug), [slug]);
export const usePillars = (slug: string) => useApi<Pillar[]>(() => api.pillars(slug), [slug]);
export const usePosts = (slug: string) => useApi<PostSummary[]>(() => api.posts(slug), [slug]);
export const usePost = (slug: string, id: string | null) => useApi<PostDetail>(() => id ? api.post(slug, id) : Promise.reject(new Error('no id')), [slug, id]);
export const useStyles = (slug: string) => useApi<StyleSample[]>(() => api.styles(slug), [slug]);
export const useTemplates = (slug: string) => useApi<Template[]>(() => api.templates(slug), [slug]);
export const useCron = (slug: string) => useApi<CronSettings>(() => api.cron(slug), [slug]);
