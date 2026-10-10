import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writerPrompt, criticPrompt, ideationPrompt, imagePrompt, type ContentBrief } from '../src/prompts.ts';
import { withNewsSource, isNewsResearchOut, isNewsUrlAnalysisOut } from '../src/schema.ts';
import { htmlToText, isPrivateHost } from '../src/article.ts';

test('isNewsResearchOut: shape guard', () => {
  assert.ok(isNewsResearchOut({ facts: ['a'], reader_scenario: 's', open_questions: [] }));
  assert.ok(!isNewsResearchOut({ facts: [], reader_scenario: 's', open_questions: [] }));
  assert.ok(!isNewsResearchOut({ facts: ['a'], open_questions: [] }));
});

test('htmlToText: prefers <article>, drops scripts/nav', () => {
  const t = htmlToText('<nav>menu</nav><article><h1>Haiku</h1><script>x()</script><p>Fact &amp; detail</p></article><footer>f</footer>');
  assert.match(t, /Haiku/);
  assert.match(t, /Fact & detail/);
  assert.doesNotMatch(t, /menu|x\(\)/);
});

test('isPrivateHost: blocks LAN/loopback/metadata, allows public', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', 'minio.local']) assert.ok(isPrivateHost(h), h);
  for (const h of ['github.blog', '8.8.8.8', '172.32.0.1']) assert.ok(!isPrivateHost(h), h);
});

const SRC = { url: 'https://github.blog/changelog/haiku', domain: 'github.blog' };

test('withNewsSource: caption link + credit on last slide (no extra slide), input untouched', () => {
  const d = { caption: { title: 'T', subtitle: 'S', cta: '', tags: [] }, slides: [{ headline: 'a', body: 'b' }] };
  const out = withNewsSource(d, SRC);
  assert.match(out.caption.subtitle, /Sumber: https:\/\/github\.blog/);
  assert.equal(out.slides.length, 1);
  assert.match(out.slides[0]!.body, /sumber: github\.blog/);
  assert.equal(d.slides[0]!.body, 'b');
});

test('withNewsSource: idempotent + text body + reels', () => {
  const twice = withNewsSource(withNewsSource({ caption: { title: 'T', subtitle: '', cta: '', tags: [] }, slides: [{ headline: 'a', body: 'b' }] }, SRC), SRC);
  assert.equal(twice.slides[0]!.body.match(/github\.blog/g)!.length, 1);
  assert.equal(twice.caption.subtitle.match(/Sumber:/g)!.length, 1);
  assert.match(withNewsSource({ body: 'post' }, SRC, 'Source').body, /Source: https/);
  const r = withNewsSource({ caption: { title: 'T', subtitle: '', cta: '', tags: [] }, scenes: [{ overlay_text: 'x', narration: 'y' }] }, SRC);
  assert.match(r.scenes[0]!.overlay_text, /github\.blog/);
});

const news: ContentBrief = {
  kind: 'news',
  premise: 'Claude Haiku 5.5 in GitHub Copilot',
  audience_moment: 'dev checks news',
  narrative_arc: 'what happened → impact',
  source_facts: ['https://github.blog/x'],
  must_include: ['source domain: github.blog'],
  must_not_do: ['generic productivity tips'],
};

test('writerPrompt: news brief + news rules embedded', () => {
  const user = writerPrompt('instagram', 'carousel', 't', 'a', 'News', [], undefined, undefined, undefined, news)[1]!.content;
  assert.match(user, /CONTENT BRIEF/);
  assert.match(user, /Kind: news/);
  assert.match(user, /NEWS RULES/);
  assert.match(user, /reader scenario/i);
  assert.match(user, /at most ONCE/);
  assert.match(user, /github\.blog/);
});

test('writerPrompt: no brief → pillar rules default', () => {
  const user = writerPrompt('instagram', 'carousel', 't', 'a', 'Tips', [])[1]!.content;
  assert.doesNotMatch(user, /CONTENT BRIEF/);
  assert.match(user, /PILLAR POST RULES/);
});

test('criticPrompt: kind-aware rules', () => {
  assert.match(criticPrompt('instagram', 'carousel', {}, 'news')[1]!.content, /NEWS RULES/);
  assert.match(criticPrompt('instagram', 'carousel', {}, 'brief')[1]!.content, /BRIEF RULES/);
});

import { resolveCaptionParts, appendCaptionParts } from '../src/schema.ts';

test('resolveCaptionParts: item override wins, blank/null falls back to Settings', () => {
  const g = { captionCta: 'Follow @dev', captionFooter: 'Settings footer' };
  assert.deepEqual(resolveCaptionParts({ caption_cta: 'Join kelas', caption_footer: null }, g), { cta: 'Join kelas', footer: 'Settings footer' });
  assert.deepEqual(resolveCaptionParts({ caption_cta: '   ', caption_footer: 'Promo footer' }, g), { cta: 'Follow @dev', footer: 'Promo footer' });
  assert.deepEqual(resolveCaptionParts(null, g), { cta: 'Follow @dev', footer: 'Settings footer' });
});

test('appendCaptionParts: appends CTA then footer, skips empty + duplicates', () => {
  assert.equal(appendCaptionParts('Body', { cta: 'CTA', footer: 'FOOT' }), 'Body\n\nCTA\n\nFOOT');
  assert.equal(appendCaptionParts('Body\n\nCTA', { cta: 'CTA', footer: '' }), 'Body\n\nCTA');
});

import { HASHTAG_RULES, overridePolishPrompt } from '../src/prompts.ts';

test('hashtag rules reach writer, critic and override polish', () => {
  assert.match(writerPrompt('instagram', 'carousel', 't', 'a', 'P', [])[1]!.content, /HASHTAG RULES/);
  assert.match(criticPrompt('instagram', 'carousel', {}, 'news')[1]!.content, /HASHTAG RULES/);
  assert.match(overridePolishPrompt({ name: 'n', type: 'mix', description: 'd' }, [])[0]!.content, /HASHTAG RULES/);
  assert.match(HASHTAG_RULES, /#developer/); // filler-tag ban names the reviewed offender
});

test('news brief audience overrides the developer persona', () => {
  const b: ContentBrief = { ...news, audience: 'people following "Berita Indonesia"' };
  const [sys, user] = writerPrompt('instagram', 'carousel', 't', 'a', 'News', [], undefined, undefined, undefined, b);
  assert.match(sys!.content, /content for people following "Berita Indonesia"/);
  assert.doesNotMatch(sys!.content, /developer content/);
  assert.match(user!.content, /Audience: people following/);
});


test('ideationPrompt and pillar writer do not hard-code developer audience', () => {
  const p = { id: 'p1', name: 'Kebijakan Publik', description: 'Aturan pemerintah Indonesia untuk masyarakat umum', is_news: false };
  const ideation = ideationPrompt(p, [], null, [], 'Akun berita kebijakan publik Indonesia');
  assert.match(ideation[0]!.content, /Do not assume the audience is developers/);
  assert.match(ideation[1]!.content, /Akun berita kebijakan publik Indonesia/);
  const sys = writerPrompt('linkedin', 'pdf', 'cuti melahirkan', 'aturan baru', p.name, [])[0]!.content;
  assert.doesNotMatch(sys, /developer content/);
  assert.match(sys, /Do not introduce developer\/IT\/workplace details/);
  assert.doesNotMatch(imagePrompt('Aturan cuti melahirkan'), /developer-audience|terminal|code brackets|git graphs/i);
});

test('withNewsSource: extra sources listed in caption + domains on last slide, idempotent', () => {
  const src = { ...SRC, extra: [{ url: 'https://theverge.com/a', domain: 'theverge.com' }, { url: 'https://github.blog/x', domain: 'github.blog' }] };
  const d = { caption: { title: 'T', subtitle: 'S', cta: '', tags: [] }, slides: [{ headline: 'a', body: 'b' }] };
  const out = withNewsSource(d, src);
  assert.match(out.caption.subtitle, /Sumber: https:\/\/github\.blog\/changelog\/haiku\nhttps:\/\/theverge\.com\/a/);
  assert.match(out.slides[0]!.body, /sumber: github\.blog, theverge\.com$/);
  const twice = withNewsSource(out, src);
  assert.equal(twice.caption.subtitle.match(/Sumber:/g)!.length, 1);
});

test('isNewsUrlAnalysisOut: optional unrelated must be integers', () => {
  const ok = { score: 80, reason: 'r', angle: 'a', key_points: ['k'] };
  assert.ok(isNewsUrlAnalysisOut(ok));
  assert.ok(isNewsUrlAnalysisOut({ ...ok, unrelated: [2, 3] }));
  assert.ok(!isNewsUrlAnalysisOut({ ...ok, unrelated: ['2'] }));
});

test('newsUrlAnalysisPrompt / newsResearchPrompt: multi-source wording only with 2+ articles', async () => {
  const { newsUrlAnalysisPrompt, newsResearchPrompt } = await import('../src/prompts.ts');
  const a = (n: number) => ({ title: `T${n}`, url: `https://x.com/${n}`, domain: 'x.com', summary: '', text: `body ${n}` });
  const one = newsUrlAnalysisPrompt({ name: 'n', description: '' }, [a(1)])[1]!.content;
  const many = newsUrlAnalysisPrompt({ name: 'n', description: '' }, [a(1), a(2)])[1]!.content;
  assert.ok(!one.includes('unrelated'));
  assert.match(many, /Article 2/);
  assert.match(many, /"unrelated": \[\]/);
  const r1 = newsResearchPrompt({ title: 't', url: 'u', summary: '' }, 'txt')[1]!.content;
  const r2 = newsResearchPrompt({ title: 't', url: 'u', summary: '' }, 'txt', 'devs', [{ url: 'https://y.com', title: 'Y', text: 'extra body' }])[1]!.content;
  assert.ok(!r1.includes('MULTI-SOURCE'));
  assert.match(r2, /MULTI-SOURCE RULES/);
  assert.match(r2, /extra body/);
});
