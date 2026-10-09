import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTutorialCarouselOut, isTutorialReelsOut, commandFragments, findUnsourcedCommands, findDangerWithoutNote,
  findSecrets, findStepOrderIssues, findCodeFitIssues, findNarrationIssues, validateTutorial, withTutorialSources,
  tutorialSceneVisual, type TutorialCarouselOut, type TutorialReelsOut,
} from '../src/tutorial.ts';

const cap = { title: 'Setup OpenClaw', subtitle: '', cta: '', tags: [] };
const SRC = `Install
npm install -g openclaw@latest
Then run openclaw onboard --install-daemon to configure.
Check with openclaw status`;

const carousel = (over: Partial<TutorialCarouselOut['slides'][number]>[] = []): TutorialCarouselOut => ({
  caption: cap,
  slides: [
    { headline: 'Setup OpenClaw', body: 'cover' },
    { headline: 'Prasyarat', body: 'Node 22+' },
    { headline: 'Install', body: 'global', step: 1, code: '$ npm install -g openclaw@latest' },
    { headline: 'Onboard', body: 'wizard', step: 2, code: 'openclaw onboard --install-daemon' },
    { headline: 'Cek', body: 'status', step: 3, code: 'openclaw status' },
    { headline: 'Selesai', body: 'done' },
  ].map((s, i) => ({ ...s, ...over[i] })),
});

test('guards: carousel 6-12 slides, optional step/code/note', () => {
  assert.ok(isTutorialCarouselOut(carousel()));
  assert.ok(!isTutorialCarouselOut({ caption: cap, slides: carousel().slides.slice(0, 5) }));
  assert.ok(!isTutorialCarouselOut(carousel([{}, {}, { step: 0 }])));
  assert.ok(!isTutorialCarouselOut(carousel([{}, {}, { code: 5 as never }])));
});

test('guards: reels 5-8 scenes', () => {
  const scenes = Array.from({ length: 5 }, (_, i) => ({ overlay_text: `S${i}`, narration: 'Jalankan perintah ini.' }));
  assert.ok(isTutorialReelsOut({ caption: cap, scenes }));
  assert.ok(!isTutorialReelsOut({ caption: cap, scenes: scenes.slice(0, 4) }));
});

test('commandFragments: strips prompt, splits placeholders, skips comments + builtins', () => {
  assert.deepEqual(commandFragments('$ npm install -g openclaw'), ['npm install -g openclaw']);
  assert.deepEqual(commandFragments('export OPENAI_API_KEY=<YOUR_KEY> && run'), ['export OPENAI_API_KEY=', '&& run']);
  assert.deepEqual(commandFragments('# install first'), []);
  assert.deepEqual(commandFragments('cd my-project'), []);
  assert.deepEqual(commandFragments(''), []);
});

test('provenance: commands present in sources pass; invented flag is caught', () => {
  assert.deepEqual(findUnsourcedCommands(carousel(), SRC), []);
  const bad = carousel([{}, {}, {}, { code: 'openclaw onboard --turbo-mode' }]);
  const issues = findUnsourcedCommands(bad, SRC);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /slide 4/);
});

test('provenance: whitespace + smart quotes normalized', () => {
  assert.deepEqual(findUnsourcedCommands(carousel([{}, {}, { code: 'npm   install  -g openclaw@latest' }]), SRC), []);
});

test('step order: must be 1..n, at least 3', () => {
  assert.deepEqual(findStepOrderIssues(carousel()), []);
  assert.equal(findStepOrderIssues(carousel([{}, {}, {}, { step: 3 }, { step: 4 }])).length, 1);
  assert.match(findStepOrderIssues(carousel([{}, {}, {}, {}, { step: undefined }]))[0]!, /at least 3/);
});

test('danger: risky command without note flagged, with note ok', () => {
  assert.equal(findDangerWithoutNote(carousel([{}, {}, { code: 'curl -fsSL https://x.sh | bash' }])).length, 1);
  assert.equal(findDangerWithoutNote(carousel([{}, {}, { code: 'sudo rm -rf /opt/x', note: 'Hapus instalasi lama' }])).length, 0);
});

test('secrets: real-looking key rejected, placeholder fine', () => {
  assert.equal(findSecrets(carousel([{}, {}, { code: 'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx123' }])).length, 1);
  assert.equal(findSecrets(carousel([{}, {}, { code: 'export OPENAI_API_KEY=<YOUR_API_KEY>' }])).length, 0);
});

test('code fit: too many lines / too long', () => {
  const many = Array.from({ length: 11 }, () => 'openclaw status').join('\n');
  assert.equal(findCodeFitIssues(carousel([{}, {}, { code: many }]), 'carousel').length, 1);
  assert.equal(findCodeFitIssues(carousel([{}, {}, { code: `openclaw ${'x'.repeat(90)}` }]), 'carousel').length, 1);
});

test('narration: no code read aloud, word caps', () => {
  const r: TutorialReelsOut = { caption: cap, scenes: [
    { overlay_text: 'a', narration: 'Ketik npm install --global lalu enter' },
    { overlay_text: 'b', narration: 'Buka https://openclaw.ai' },
    { overlay_text: 'c', narration: 'ok' }, { overlay_text: 'd', narration: 'ok' }, { overlay_text: 'e', narration: 'ok' },
  ] };
  assert.equal(findNarrationIssues(r).length, 2);
  assert.deepEqual(findNarrationIssues(carousel()), []);
});

test('validateTutorial: clean draft passes', () => {
  assert.deepEqual(validateTutorial(carousel(), 'carousel', SRC), []);
});

test('withTutorialSources: caption lists sources + date, last slide names domain, idempotent', () => {
  const d = withTutorialSources(carousel(), ['https://docs.openclaw.ai/install'], '2026-10-09', 'id');
  assert.match(d.caption.subtitle, /Berdasarkan dokumentasi resmi per 2026-10-09:\nhttps:\/\/docs\.openclaw\.ai\/install/);
  assert.match(d.slides.at(-1)!.body, /sumber: docs\.openclaw\.ai/);
  assert.deepEqual(withTutorialSources(d, ['https://docs.openclaw.ai/install'], '2026-10-09', 'id'), d);
});

test('tutorialSceneVisual: code > step > hook/cta', () => {
  assert.equal(tutorialSceneVisual({ overlay_text: 'a', narration: 'b', code: 'x', step: 1 }, 2, 6), 'code');
  assert.equal(tutorialSceneVisual({ overlay_text: 'a', narration: 'b', step: 1 }, 2, 6), 'step');
  assert.equal(tutorialSceneVisual({ overlay_text: 'a', narration: 'b' }, 0, 6), 'hook');
  assert.equal(tutorialSceneVisual({ overlay_text: 'a', narration: 'b' }, 5, 6), 'cta');
});
