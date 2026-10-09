import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCmd, parseCallback, parseOverrideDate } from '../src/bot.ts';

const SLUGS = ['default', 'brand2'];

test('parseCmd: bare /gen', () => {
  assert.deepEqual(parseCmd('/gen', SLUGS), { t: 'gen', slug: undefined, platform: undefined, format: undefined });
});

test('parseCmd: /gen with platform', () => {
  assert.deepEqual(parseCmd('/gen instagram', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: undefined });
});

test('parseCmd: /gen platform + format', () => {
  assert.deepEqual(parseCmd('/gen linkedin pdf', SLUGS), { t: 'gen', slug: undefined, platform: 'linkedin', format: 'pdf' });
});

test('parseCmd: /gen with group slug', () => {
  assert.deepEqual(parseCmd('/gen brand2 instagram carousel', SLUGS), { t: 'gen', slug: 'brand2', platform: 'instagram', format: 'carousel' });
});

test('parseCmd: unknown slug → treated as platform (invalid)', () => {
  const c = parseCmd('/gen foobar', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: case insensitive + spaces', () => {
  assert.deepEqual(parseCmd('  /Gen  INSTAGRAM   Carousel  ', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: 'carousel' });
});

test('parseCmd: invalid platform', () => {
  const c = parseCmd('/gen twitter', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format without platform invalid', () => {
  const c = parseCmd('/gen pdf', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /ide plain text (case preserved)', () => {
  assert.deepEqual(parseCmd('/ide Kenapa Sprint Estimation Selalu Meleset', SLUGS), { t: 'ide', slug: undefined, text: 'Kenapa Sprint Estimation Selalu Meleset' });
});

test('parseCmd: /ide with group slug', () => {
  assert.deepEqual(parseCmd('/ide brand2 Heisenbug di production', SLUGS), { t: 'ide', slug: 'brand2', text: 'Heisenbug di production' });
});

test('parseCmd: /ide with NO text → usage unknown', () => {
  const c = parseCmd('/ide', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /ide clamps to 400 chars', () => {
  const c = parseCmd('/ide ' + 'x'.repeat(500), SLUGS);
  assert.equal(c.t, 'ide');
  assert.equal(c.text!.length, 400);
});

test('parseCmd: /ide first word is not a slug → whole text is the idea', () => {
  assert.deepEqual(parseCmd('/ide git bisect itu underrated', SLUGS), { t: 'ide', slug: undefined, text: 'git bisect itu underrated' });
});

test('parseCmd: invalid format', () => {
  const c = parseCmd('/gen instagram video', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /status', () => {
  assert.deepEqual(parseCmd('/status', SLUGS), { t: 'status', slug: undefined });
});

test('parseCmd: /status with slug', () => {
  assert.deepEqual(parseCmd('/status brand2', SLUGS), { t: 'status', slug: 'brand2' });
});

// ---------- parseCmd: /rerender ----------

test('parseCmd: bare /rerender', () => {
  assert.deepEqual(parseCmd('/rerender', SLUGS), { t: 'rerender', slug: undefined });
});

test('parseCmd: /rerender with slug', () => {
  assert.deepEqual(parseCmd('/rerender brand2', SLUGS), { t: 'rerender', slug: 'brand2' });
});

test('parseCmd: /rerender unknown slug → slug undefined (default group)', () => {
  assert.deepEqual(parseCmd('/rerender foobar', SLUGS), { t: 'rerender', slug: undefined });
});

test('parseCmd: /help and /start', () => {
  assert.deepEqual(parseCmd('/help', SLUGS), { t: 'help' });
  assert.deepEqual(parseCmd('/start', SLUGS), { t: 'help' });
});

test('parseCmd: random text', () => {
  const c = parseCmd('hello bot', SLUGS);
  assert.equal(c.t, 'unknown');
});

// ---------- parseCallback (approval gate buttons) ----------

const UUID = '0192ab6e-5f78-7abc-8def-0123456789ab';

test('parseCallback: approve:<uuid>', () => {
  assert.deepEqual(parseCallback(`approve:${UUID}`), { t: 'approve', postId: UUID });
});

test('parseCallback: reject:<uuid>', () => {
  assert.deepEqual(parseCallback(`reject:${UUID}`), { t: 'reject', postId: UUID });
});

test('parseCallback: skip_cover:<uuid>', () => {
  assert.deepEqual(parseCallback(`skip_cover:${UUID}`), { t: 'skip_cover', postId: UUID });
});

test('parseCallback: uppercase uuid → normalized lowercase', () => {
  const c = parseCallback(`APPROVE:${UUID.toUpperCase()}`);
  assert.deepEqual(c, { t: 'approve', postId: UUID });
});

test('parseCallback: non-uuid payload → null', () => {
  assert.equal(parseCallback('approve:not-a-uuid'), null);
  assert.equal(parseCallback('approve:123'), null);
});

test('parseCallback: unknown action → null', () => {
  assert.equal(parseCallback(`delete:${UUID}`), null);
  assert.equal(parseCallback(UUID), null);
  assert.equal(parseCallback(''), null);
});

test('parseCallback: regen:<uuid> + star:<uuid>', () => {
  assert.deepEqual(parseCallback(`regen:${UUID}`), { t: 'regen', postId: UUID });
  assert.deepEqual(parseCallback(`star:${UUID}`), { t: 'star', postId: UUID });
});

test('parseCallback: stamped noop buttons are ignored silently', () => {
  assert.equal(parseCallback(`noop:${UUID}`), null);
});

// ---------- parseCallback: /gen format picker buttons ----------

test('parseCallback: genpick natural', () => {
  assert.deepEqual(parseCallback('genpick:default:natural'), { t: 'genpick', slug: 'default', platform: undefined, format: undefined });
});

test('parseCallback: genpick ig:carousel', () => {
  assert.deepEqual(parseCallback('genpick:brand2:ig:carousel'), { t: 'genpick', slug: 'brand2', platform: 'instagram', format: 'carousel' });
});

test('parseCallback: genpick li:reels → null (reels is IG only)', () => {
  assert.equal(parseCallback('genpick:default:li:reels'), null);
});

test('parseCallback: genpick li:pdf', () => {
  assert.deepEqual(parseCallback('genpick:default:li:pdf'), { t: 'genpick', slug: 'default', platform: 'linkedin', format: 'pdf' });
});

test('parseCallback: genpick news', () => {
  assert.deepEqual(parseCallback('genpick:default:news'), { t: 'genpick', slug: 'default', platform: 'news', format: undefined });
});

test('parseCallback: news topic/item pickers', () => {
  assert.deepEqual(parseCallback(`nt:${UUID}`), { t: 'newstopic', topicId: UUID });
  assert.deepEqual(parseCallback(`ni:${UUID}`), { t: 'newsitem', itemId: UUID });
});

test('parseCmd: /buat with group slug', () => {
  assert.deepEqual(parseCmd('/buat brand2', SLUGS), { t: 'buat', slug: 'brand2' });
});

test('parseCmd: /buat without slug → first group', () => {
  assert.deepEqual(parseCmd('/buat', SLUGS), { t: 'buat', slug: undefined });
});

test('parseCallback: buatpick ig:carousel', () => {
  assert.deepEqual(parseCallback('buatpick:default:ig:carousel'), { t: 'buatpick', slug: 'default', platform: 'instagram', format: 'carousel' });
});

test('parseCallback: buatpick natural', () => {
  assert.deepEqual(parseCallback('buatpick:default:natural'), { t: 'buatpick', slug: 'default', platform: undefined, format: undefined });
});

test('parseCallback: buatpick li:text', () => {
  assert.deepEqual(parseCallback('buatpick:default:li:text'), { t: 'buatpick', slug: 'default', platform: 'linkedin', format: 'text' });
});

test('parseCallback: genpick with invalid slug chars → null', () => {
  assert.equal(parseCallback('genpick:bad slug!:natural'), null);
});

// ---------- parseCallback: override flow buttons ----------

test('parseCallback: ovtype:mix / image_only / text_only', () => {
  assert.deepEqual(parseCallback('ovtype:mix'), { t: 'ovtype', value: 'mix' });
  assert.deepEqual(parseCallback('ovtype:image_only'), { t: 'ovtype', value: 'image_only' });
  assert.deepEqual(parseCallback('ovtype:text_only'), { t: 'ovtype', value: 'text_only' });
});

test('parseCallback: ovdone', () => {
  assert.deepEqual(parseCallback('ovdone'), { t: 'ovdone' });
});

test('parseCallback: invalid ovtype value → null', () => {
  assert.equal(parseCallback('ovtype:video'), null);
  assert.equal(parseCallback('ovtype:'), null);
});

// ---------- parseOverrideDate (pure) ----------

test('parseOverrideDate: ISO format', () => {
  assert.deepEqual(parseOverrideDate('2026-10-01', '2026-09-21'), { date: '2026-10-01', past: false });
});

test('parseOverrideDate: DD-MM-YYYY (Indonesian) maps to same date', () => {
  assert.deepEqual(parseOverrideDate('01-10-2026', '2026-09-21'), { date: '2026-10-01', past: false });
  assert.deepEqual(parseOverrideDate('25-12-2026', '2026-09-21'), { date: '2026-12-25', past: false });
});

test('parseOverrideDate: past detection', () => {
  assert.deepEqual(parseOverrideDate('2026-01-01', '2026-09-21'), { date: '2026-01-01', past: true });
  assert.deepEqual(parseOverrideDate('2026-09-21', '2026-09-21'), { date: '2026-09-21', past: false }); // today ok
});

test('parseOverrideDate: invalid shapes → null', () => {
  assert.equal(parseOverrideDate('tomorrow', '2026-09-21'), null);
  assert.equal(parseOverrideDate('2026/10/01', '2026-09-21'), null);
  assert.equal(parseOverrideDate('01/10/2026', '2026-09-21'), null);
  assert.equal(parseOverrideDate('', '2026-09-21'), null);
});

test('parseOverrideDate: calendar-rollover dates rejected (31-02)', () => {
  assert.equal(parseOverrideDate('31-02-2026', '2026-09-21'), null); // Feb never has 31 days
  assert.equal(parseOverrideDate('2026-02-31', '2026-09-21'), null);
});

test('parseCmd: /override with and without slug', () => {
  assert.deepEqual(parseCmd('/override', SLUGS), { t: 'override', slug: undefined });
  assert.deepEqual(parseCmd('/override brand2', SLUGS), { t: 'override', slug: 'brand2' });
});

test('parseCmd: /cancel', () => {
  assert.deepEqual(parseCmd('/cancel', SLUGS), { t: 'cancel' });
});

import { groupsForChat, withChatSlug } from '../src/bot.ts';

test('groupsForChat: per-group chat id, null falls back to env chat, unknown → none', () => {
  const gs = [{ slug: 'a', telegram_chat_id: '-100a' }, { slug: 'b', telegram_chat_id: null }];
  assert.deepEqual(groupsForChat(gs, '-100a', 'env').map((g) => g.slug), ['a']);
  assert.deepEqual(groupsForChat(gs, 'env', 'env').map((g) => g.slug), ['b']);
  assert.deepEqual(groupsForChat(gs, 'stranger', 'env'), []);
});

test('withChatSlug: fills missing slug only', () => {
  assert.deepEqual(withChatSlug({ t: 'gen' }, 'a'), { t: 'gen', slug: 'a' });
  assert.deepEqual(withChatSlug({ t: 'gen', slug: 'b' }, 'a'), { t: 'gen', slug: 'b' });
  assert.deepEqual(withChatSlug({ t: 'help' }, 'a'), { t: 'help' });
});

test('parseCallback: news fetch buttons', () => {
  const id = '01a11bf9-28e8-782c-babb-6fc7237dacbf';
  assert.deepEqual(parseCallback(`nfl:${id}`), { t: 'newsfetchlatest', topicId: id });
  assert.deepEqual(parseCallback(`nfu:${id}`), { t: 'newsfetchurl', topicId: id });
  assert.equal(parseCallback('nfu:not-a-uuid'), null);
});

test('parseCallback: nif:<uuid>:c|r news format confirm', () => {
  assert.deepEqual(parseCallback(`nif:${UUID}:r`), { t: 'newsitemformat', itemId: UUID, asReel: true });
  assert.deepEqual(parseCallback(`nif:${UUID}:c`), { t: 'newsitemformat', itemId: UUID, asReel: false });
  assert.equal(parseCallback(`nif:${UUID}:x`), null);
});
