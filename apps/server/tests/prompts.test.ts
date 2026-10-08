import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writerPrompt, criticPrompt, type ContentBrief } from '../src/prompts.ts';
import { withNewsSource, isNewsResearchOut } from '../src/schema.ts';
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

test('news brief audience overrides the developer persona', () => {
  const b: ContentBrief = { ...news, audience: 'people following "Berita Indonesia"' };
  const [sys, user] = writerPrompt('instagram', 'carousel', 't', 'a', 'News', [], undefined, undefined, undefined, b);
  assert.match(sys!.content, /content for people following "Berita Indonesia"/);
  assert.doesNotMatch(sys!.content, /developer content/);
  assert.match(user!.content, /Audience: people following/);
});
