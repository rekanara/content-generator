import { downloadImage } from './article.ts';

export type FoundImage = { buf: Buffer; credit: string; url: string };

type OpenverseResult = {
  url?: string;
  width?: number;
  height?: number;
  license?: string;
  license_version?: string;
  creator?: string | null;
  title?: string | null;
  source?: string | null;
};

const OK = new Set(['cc0', 'pdm', 'by', 'by-sa']);

export async function findLicensedImage(query: string): Promise<FoundImage | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=8&mature=false&extension=jpg`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'content-generator/1.0', accept: 'application/json' } }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as { results?: OpenverseResult[] } | null;
  for (const r of data?.results ?? []) {
    const lic = (r.license ?? '').toLowerCase();
    if (!r.url || !OK.has(lic) || (r.width ?? 0) < 900 || (r.height ?? 0) < 500) continue;
    // Flickr (most Openverse hits) 403s any UA containing "bot"; the API itself is fine with this one.
    const buf = await downloadImage(r.url, 'content-generator/1.0');
    if (!buf) continue;
    const who = r.creator?.trim() || r.source?.trim() || 'Openverse';
    const license = [r.license?.toUpperCase(), r.license_version].filter(Boolean).join(' ');
    return { buf, credit: `Foto: ${who}${license ? ` (${license})` : ''}`, url: r.url };
  }
  return null;
}
