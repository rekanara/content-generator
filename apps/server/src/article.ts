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
export function htmlToText(html: string): string {
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
    .slice(0, MAX_TEXT);
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

export async function fetchArticleText(url: string): Promise<string> {
  try {
    // manual redirects: every hop is host-checked BEFORE the request is made
    let u = await safeUrl(url);
    let res: Response | null = null;
    for (let hop = 0; u && hop < 4; hop++) {
      res = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'Mozilla/5.0 (content-generator research bot)', accept: 'text/html' },
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      u = await safeUrl(loc, u);
      res = null;
    }
    if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return '';
    return htmlToText(new TextDecoder().decode(buf));
  } catch {
    return '';
  }
}
