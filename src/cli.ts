// CLI entry: pnpm daily [--no-render] [--dry] [--platform X] [--format Y]
import { generateDraft, resolveSlot, markSent, markFailed, createQueuedPost } from './pipeline.ts';
import { sql } from './db.ts';
import type { Platform, Format } from './state.ts';
import type { CarouselOut } from './schema.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const platform = opt('platform') as Platform | undefined;
  const format = opt('format') as Format | undefined;

  const slot = await resolveSlot(platform ? { platform, format } : undefined);
  console.log(`[cli] slot: ${slot.platform} ${slot.format} pillar=${slot.pillar_id}`);

  // step build order 2: no-render (draft saja). render/send menyusul.
  const r = await generateDraft(slot);
  console.log(`[cli] topic: ${r.topic}`);
  console.log('--- draft preview ---');
  console.log(preview(r.draft));
  console.log('--- end preview ---');

  if (flag('no-render')) {
    console.log('[cli] no-render: berhenti di draft, tidak update rotasi.');
    await sql.end();
    return;
  }

  // --dry: render + upload artefak, tapi tidak kirim telegram + tidak update rotasi
  if (flag('dry')) {
    if (slot.format === 'carousel' || slot.format === 'pdf') {
      const { renderAndSave } = await import('./render/carousel.ts');
      const a = await renderAndSave(r.postId, slot.platform, r.draft as CarouselOut);
      console.log(`[cli] dry: ${a.files.length} artefak di ${a.prefix} (MinIO) + lokal out/${r.postId}/`);
    } else if (slot.format === 'reels') {
      console.log('[cli] dry: render reels belum tersedia (build step 6).');
    } else {
      console.log('[cli] dry: format text tidak butuh render.');
    }
    console.log('[cli] dry: tidak kirim, tidak update rotasi.');
    await sql.end();
    return;
  }
  // tanpa renderer + telegram (step berikutnya), anggap selesai di draft untuk sekarang
  console.log('[cli] renderer belum tersedia — berhenti di draft (build step 3+).');
  await sql.end();
}

function preview(d: unknown): string {
  if (d && typeof d === 'object' && 'slides' in d) {
    const c = d as { caption: string; slides: { headline: string; body: string }[] };
    return c.slides.map((s, i) => `Slide ${i + 1}: ${s.headline}\n  ${s.body}`).join('\n') +
      `\n\nCAPTION:\n${c.caption}`;
  }
  if (d && typeof d === 'object' && 'scenes' in d) {
    const r = d as { caption: string; scenes: { overlay_text: string; narration: string }[] };
    return r.scenes.map((s, i) => `Scene ${i + 1}: [${s.overlay_text}]\n  ${s.narration}`).join('\n') +
      `\n\nCAPTION:\n${r.caption}`;
  }
  return String((d as { body: string }).body);
}

main().catch((e) => { console.error(e); process.exit(1); });
