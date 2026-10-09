// Article fetch for news research: source URL → readable plain text the research
// step can extract facts from. Stdlib only (fetch + regex) — no readability dep.
// ponytail: regex HTML→text; swap to a readability parser if extraction quality plateaus.
import type Parser from 'rss-parser';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 12_000;

// Trust boundary: URLs come from external RSS feeds — never let them reach the LAN/metadata.
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  return false;
}

// Main-content HTML → plain text. Prefers <article>/<main>, drops chrome + scripts.
export function htmlToText(html: string, max = MAX_TEXT): string {
  const pick = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  return pick
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, max);
}

// Fail-safe: any error → '' (research falls back to the RSS summary, never blocks the run).
// rss-parser's parseURL() calls the deprecated url.parse() (DEP0169, no upstream fix) —
// fetch with the stdlib and hand the XML to parseString() instead.
export async function parseFeed(parser: Parser, url: string): Promise<Parser.Output<Record<string, unknown>>> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'Mozilla/5.0 (content-generator feed reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`feed ${res.status}: ${url}`);
  return parser.parseString(await res.text());
}

async function safeUrl(raw: string, base?: URL): Promise<URL | null> {
  const u = new URL(raw, base);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isPrivateHost(u.hostname)) return null;
  const { address } = await lookup(u.hostname);
  return isPrivateHost(address) ? null : u;
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/\s+/g, ' ').trim();

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
}

// Page metadata (pure): og/twitter/article tags first, <title>/<h1> as fallback.
export function htmlMeta(html: string): { title: string; summary: string; publishedAt: Date | null; canonical: string } {
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title')
    || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    || decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' '));
  const summary = metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description');
  const rawDate = metaContent(html, 'article:published_time') || metaContent(html, 'datePublished') || metaContent(html, 'pubdate')
    || html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || '';
  const d = rawDate ? new Date(rawDate) : null;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1] ?? '';
  return { title: title.slice(0, 300), summary: summary.slice(0, 600), publishedAt: d && !Number.isNaN(d.getTime()) ? d : null, canonical };
}

// Article photos (pure): og/twitter image first (the editor's chosen lead photo), then <img>
// inside the article body. Drops chrome (logos, icons, avatars, ads, tracking pixels), vector/
// animated formats, and images declared smaller than 400px. Absolute, deduped, capped.
const JUNK_IMG = /(logo|icon|avatar|sprite|favicon|badge|banner-ad|\/ads?\/|pixel|tracking|placeholder|blank|spacer|emoji|gravatar)/i;

export function extractImageUrls(html: string, baseUrl: string, max = 5): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    let u: URL;
    try { u = new URL(decode(raw), baseUrl); } catch { return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    if (/\.(svg|gif|ico)(\?|$)/i.test(u.pathname) || JUNK_IMG.test(u.href)) return;
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
  };
  push(metaContent(html, 'og:image') || undefined);
  push(metaContent(html, 'og:image:url') || undefined);
  push(metaContent(html, 'twitter:image') || undefined);
  const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? '';
  for (const tag of body.match(/<img\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}=["']([^"']+)["']`, 'i'))?.[1];
    const w = Number(attr('width')), h = Number(attr('height'));
    if ((w && w < 400) || (h && h < 300)) continue;
    const srcset = attr('srcset') ?? attr('data-srcset');
    const best = srcset?.split(',').map((p) => p.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1] ?? '0') || 0) - (parseInt(a[1] ?? '0') || 0))[0]?.[0];
    push(best ?? attr('data-src') ?? attr('data-lazy-src') ?? attr('src'));
  }
  return out.slice(0, max);
}

// Pixel size from image bytes (pure): PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X. null = unknown.
export function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: (b.readUIntLE(24, 3)) + 1, h: (b.readUIntLE(27, 3)) + 1 };
  }
  return null;
}

const MAX_IMG = 8_000_000;
const MIN_IMG_W = 600;

// SSRF-safe image download (same hop checks as pages). Rejects non-images, oversized files,
// and anything narrower than 600px (would look blurry on a 1080px slide).
export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    let u = await safeUrl(url);
    let res: Response | null = null;
    for (let hop = 0; u && hop < 4; hop++) {
      res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 (content-generator research bot)', accept: 'image/jpeg,image/png,image/webp' } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      u = await safeUrl(loc, u);
      res = null;
    }
    if (!u || !res || !res.ok || !/^image\/(jpeg|png|webp)/.test(res.headers.get('content-type') ?? '')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMG) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMG) return null;
    const size = imageSize(buf);
    return size && size.w >= MIN_IMG_W ? buf : null;
  } catch {
    return null;
  }
}

// SSRF-safe fetch of an article page (manual redirects, every hop host-checked).
// Returns the final URL + raw HTML, or null on any failure.
async function fetchHtml(url: string, allowText = false): Promise<{ url: string; html: string; type: string } | null> {
  try {
    let u = await safeUrl(url);
    let res: Response | null = null;
    for (let hop = 0; u && hop < 4; hop++) {
      res = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'Mozilla/5.0 (content-generator research bot)', accept: allowText ? 'text/html, text/markdown, text/plain' : 'text/html' },
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      u = await safeUrl(loc, u);
      res = null;
    }
    const type = res?.headers.get('content-type') ?? '';
    const ok = type.includes('html') || (allowText && /text\/(plain|markdown|x-markdown)/.test(type));
    if (!u || !res || !res.ok || !ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;
    return { url: u.toString(), html: new TextDecoder().decode(buf), type };
  } catch {
    return null;
  }
}

// Tutorial source: official docs page (html) or raw README/markdown (text). Larger text
// budget than news — install commands often sit deep in the page, and provenance checks
// every command against this text.
const DOC_TEXT = 60_000;
export async function fetchDocSource(url: string): Promise<{ url: string; title: string; text: string } | null> {
  const r = await fetchHtml(url, true);
  if (!r) return null;
  if (r.type.includes('html')) return { url: r.url, title: htmlMeta(r.html).title || r.url, text: htmlToText(r.html, DOC_TEXT) };
  return { url: r.url, title: new URL(r.url).pathname.split('/').filter(Boolean).pop() || r.url, text: r.html.slice(0, DOC_TEXT) };
}

export async function fetchArticleText(url: string): Promise<string> {
  const r = await fetchHtml(url);
  return r ? htmlToText(r.html) : '';
}

// News research: article text + candidate photo URLs from ONE fetch.
export async function fetchArticleWithImages(url: string): Promise<{ text: string; images: string[] }> {
  const r = await fetchHtml(url);
  return r ? { text: htmlToText(r.html), images: extractImageUrls(r.html, r.url) } : { text: '', images: [] };
}

// Full article for the "fetch one URL" flow: final URL, metadata, and body text.
export async function fetchArticle(url: string): Promise<{ url: string; title: string; summary: string; publishedAt: Date | null; canonical: string; text: string } | null> {
  const r = await fetchHtml(url);
  if (!r) return null;
  return { url: r.url, ...htmlMeta(r.html), text: htmlToText(r.html) };
}
