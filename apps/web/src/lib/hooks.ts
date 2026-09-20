// Small data-fetch hooks — no react-query, stdlib fetch + useEffect.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Pillar, PostSummary, PostDetail, StyleSample, Template, Dashboard, CronSettings } from '@workspace/shared';

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

export const useDashboard = () => useApi<Dashboard>(api.dashboard);
export const usePillars = () => useApi<Pillar[]>(api.pillars);
export const usePosts = () => useApi<PostSummary[]>(api.posts);
export const usePost = (id: number | null) => useApi<PostDetail>(() => id ? api.post(id) : Promise.reject(new Error('no id')), [id]);
export const useStyles = () => useApi<StyleSample[]>(api.styles);
export const useTemplates = () => useApi<Template[]>(api.templates);
export const useCron = () => useApi<CronSettings>(api.cron);
