// Promotion usecases: AI content generation, brief drafting, image-slot reporting.
import { chatJson, writerModel, criticModel } from '../llm.ts';
import { recordLlmRun } from '../repos/llm-runs.ts';
import { isPromoContentOut, isPromoVideoOut, isPromoBriefOut, criticScore, criticFeedback, stripCriticMeta, type PromoContentOut, type PromoVideoOut, type PromoBriefOut } from '../schema.ts';
import { promoContentPrompt, promoCriticPrompt, promoVideoPrompt, promoVideoCriticPrompt, promoBriefPrompt, PROMO_ARCS, type PromoData } from '../prompts.ts';
import { getPromotion, setContent, setContentWithTemplate, setVideoContent, setVideoArtifact, imageSlots, markPromotionSent } from '../repos/promotions.ts';
import { getTemplate } from '../repos/templates.ts';
import { cssVocabOf, promoVocabOf, sanitizePromoFragment, defaultTemplate, renderPromotion } from '../render/promotion.ts';
import { artifactExists, uploadPromotionImage } from '../storage.ts';
import { renderPromotionVideo } from '../render/promotion-video.ts';
import { sendMessage } from '../telegram.ts';
import { resolveCaptionParts, appendCaptionParts } from '../schema.ts';
import type { GroupCfg } from '../groups.ts';
import type { Promotion, PromoVideoScene } from '@workspace/shared';

const PROMO_THRESHOLD = 7;

async function writePromoSlides(cfg: GroupCfg, data: PromoData, cssVocab: string): Promise<{ html: string; image_prompt: string }[]> {
  const first = promoContentPrompt(data, cssVocab);
  const w = await chatJson<PromoContentOut>(cfg, writerModel(cfg), first, isPromoContentOut, 8000);
  await recordLlmRun(cfg.id, 'promo', writerModel(cfg), w.usage.prompt, w.usage.completion).catch(() => {});
  const critique = async (d: PromoContentOut) => {
    const c = await chatJson<PromoContentOut>(cfg, criticModel(cfg), promoCriticPrompt(data, cssVocab, d), isPromoContentOut, 8000);
    await recordLlmRun(cfg.id, 'promo', criticModel(cfg), c.usage.prompt, c.usage.completion).catch(() => {});
    return c.data;
  };
  let final: PromoContentOut;
  try {
    final = await critique(w.data);
  } catch (e) {
    console.warn(`[promo] critic failed — shipping writer draft: ${(e as Error).message.slice(0, 160)}`);
    final = w.data;
  }
  let score = criticScore(final);
  if (score !== null && score < PROMO_THRESHOLD) {
    console.log(`[promo] score ${score} < ${PROMO_THRESHOLD} — one regeneration`);
    try {
      const w2 = await chatJson<PromoContentOut>(cfg, writerModel(cfg), promoContentPrompt(data, cssVocab, undefined, criticFeedback(final, score)), isPromoContentOut, 8000);
      await recordLlmRun(cfg.id, 'promo', writerModel(cfg), w2.usage.prompt, w2.usage.completion).catch(() => {});
      const c2 = await critique(w2.data);
      const score2 = criticScore(c2);
      if (score2 === null || score2 > score) { final = c2; score = score2; }
    } catch (e) {
      console.warn(`[promo] retry failed — keeping first revision: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  console.log(`[promo] editor score=${score ?? 'n/a'}`);
  return stripCriticMeta(final).slides.map((s) => ({ html: sanitizePromoFragment(s.html), image_prompt: s.image_prompt ?? '' }));
}

// AI writes the slides for a stored promotion (template css drives the layout).
// Image slots ({{image}}) reported back; status flips to awaiting_images/ready.
export async function generatePromotionContent(cfg: GroupCfg, promoId: string): Promise<{ slides: number; imageSlots: { slide: number; prompt: string }[] }> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo) throw new Error(`promotion ${promoId} not found`);
  const tpl = promo.template_id ? await getTemplate(cfg.id, promo.template_id) : null;
  const cssVocab = promoVocabOf(tpl?.html ?? defaultTemplate('ig-carousel-promo'));
  const data: PromoData = {
    name: promo.name, topic: promo.topic, features: promo.features, stacks: promo.stacks,
    stats: promo.stats, price: promo.price, price_sale: promo.price_sale,
  };
  const slides = await writePromoSlides(cfg, data, cssVocab);
  await setContent(promoId, slides);
  console.log(`[promo] #${promoId} content generated — ${slides.length} slides`);
  return { slides: slides.length, imageSlots: imageSlots({ ...promo, content: slides }) };
}


const promoData = (p: Promotion): PromoData => ({
  name: p.name, topic: p.topic, features: p.features, stacks: p.stacks, stats: p.stats, price: p.price, price_sale: p.price_sale,
});

// AI writes the VIDEO script (scenes) for a promotion — no template/css involved, the Remotion
// renderer owns all motion. Same writer → editor → one retry gate as the slide flow.
export async function generatePromotionVideoScript(cfg: GroupCfg, promoId: string, audioMode: 'silent' | 'voice'): Promise<{ scenes: number }> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo) throw new Error(`promotion ${promoId} not found`);
  const data = promoData(promo);
  const arc = PROMO_ARCS[Math.floor(Math.random() * PROMO_ARCS.length)]!;
  const run = async (model: string, msgs: ReturnType<typeof promoVideoPrompt>) => {
    const r = await chatJson<PromoVideoOut>(cfg, model, msgs, isPromoVideoOut, 4000);
    await recordLlmRun(cfg.id, 'promo', model, r.usage.prompt, r.usage.completion).catch(() => {});
    return r.data;
  };
  const w = await run(writerModel(cfg), promoVideoPrompt(data, arc, audioMode));
  let final: PromoVideoOut;
  try { final = await run(criticModel(cfg), promoVideoCriticPrompt(data, audioMode, w)); }
  catch (e) { console.warn(`[promo-video] editor failed — shipping writer draft: ${(e as Error).message.slice(0, 160)}`); final = w; }
  let score = criticScore(final);
  if (score !== null && score < PROMO_THRESHOLD) {
    console.log(`[promo-video] score ${score} < ${PROMO_THRESHOLD} — one regeneration`);
    try {
      const w2 = await run(writerModel(cfg), promoVideoPrompt(data, arc, audioMode, criticFeedback(final, score)));
      const c2 = await run(criticModel(cfg), promoVideoCriticPrompt(data, audioMode, w2));
      const score2 = criticScore(c2);
      if (score2 === null || score2 > score) { final = c2; score = score2; }
    } catch (e) {
      console.warn(`[promo-video] retry failed — keeping first revision: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  console.log(`[promo-video] editor score=${score ?? 'n/a'}`);
  const clean = stripCriticMeta(final);
  const scenes: PromoVideoScene[] = clean.scenes.map((sc, i, all) => ({
    overlay_text: sc.overlay_text.trim(),
    narration: audioMode === 'voice' ? sc.narration.trim() : '',
    visual: i === 0 ? 'hook' : i === all.length - 1 ? 'cta' : (sc.visual === 'hook' || sc.visual === 'cta' ? 'point' : sc.visual ?? 'point'),
    image_query: sc.image_query?.trim() ?? '',
    image_credit: '',
  }));
  await setVideoContent(promoId, scenes, audioMode);
  console.log(`[promo-video] #${promoId} script generated — ${scenes.length} scenes (${audioMode})`);
  return { scenes: scenes.length };
}

export async function deliverPromotionVideo(cfg: GroupCfg, promoId: string): Promise<void> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo?.video_content) throw new Error(`promotion ${promoId} has no video script`);
  const r = await renderPromotionVideo(promo, cfg);
  await setVideoArtifact(promoId, r.prefix, r.durationSec);
  const { sendVideo } = await import('../telegram.ts');
  const caption = appendCaptionParts(promoCaption(promo), resolveCaptionParts(promo, cfg));
  await sendVideo(cfg, r.key, `promo-${promoId}.mp4`, caption);
  await markPromotionSent(promoId);
  console.log(`[promo-video] #${promoId} delivered — rotation untouched`);
}

// AI drafts promo DATA from a rough brief (dashboard flow).
export async function draftPromotionFromBrief(cfg: GroupCfg, brief: string): Promise<PromoBriefOut> {
  const out = await chatJson<PromoBriefOut>(cfg, writerModel(cfg), promoBriefPrompt(brief), isPromoBriefOut, 3000);
  await recordLlmRun(cfg.id, 'promo', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  return out.data;
}

// Re-generate the slides of an EXISTING promo — same data source (name/features/
// stack/price are the human's truth), fresh AI slides. Optionally switches the
// template first (the AI writes against the new template's CSS vocabulary).
// Refuses promos already sent: a re-gen would make storage lie about what shipped
// (re-render is the honest tool there).
export async function regeneratePromotionContent(
  cfg: GroupCfg,
  promoId: string,
  templateId?: string | null,
): Promise<{ slides: number; imageSlots: { slide: number; prompt: string }[]; templateChanged: boolean }> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo) throw new Error(`promotion ${promoId} not found`);
  if (promo.status === 'sent') throw new Error('already sent — re-render (resend with current template) instead');
  const chosenId = templateId !== undefined ? templateId : promo.template_id;
  const tpl = chosenId ? await getTemplate(cfg.id, chosenId) : null;
  if (chosenId && !tpl) throw new Error(`template ${chosenId} not found`);
  if (tpl && !tpl.format.endsWith('-promo')) throw new Error(`template ${tpl.name} is ${tpl.format} — regeneration needs a promo template`);
  const cssVocab = promoVocabOf(tpl?.html ?? defaultTemplate('ig-carousel-promo'));
  const data: PromoData = {
    name: promo.name, topic: promo.topic, features: promo.features, stacks: promo.stacks,
    stats: promo.stats, price: promo.price, price_sale: promo.price_sale,
  };
  const slides = await writePromoSlides(cfg, data, cssVocab);
  await setContentWithTemplate(promoId, slides, chosenId);
  const templateChanged = (chosenId ?? null) !== (promo.template_id ?? null);
  console.log(`[promo] #${promoId} content re-generated — ${slides.length} slides (template ${templateChanged ? 'switched' : 'kept'})`);
  return { slides: slides.length, imageSlots: imageSlots({ ...promo, content: slides }), templateChanged };
}

// After content generation: tell Telegram which images are needed (or that none are).
export async function notifyImageSlots(cfg: GroupCfg, promoId: string): Promise<void> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo?.content) return;
  const slots = imageSlots(promo);
  const lines = [`Promo "${promo.name}" — konten siap (${promo.content.length} slide).`];
  if (slots.length === 0) {
    lines.push('Tidak butuh gambar — siap dikirim kapan pun.');
  } else {
    lines.push(`Butuh ${slots.length} gambar:`);
    for (const s of slots) lines.push(`· slide ${s.slide}: ${s.prompt || '(tanpa deskripsi)'}`);
    lines.push('', 'Upload gambarnya dari dashboard (halaman promo → Upload gambar).');
  }
  await sendMessage(cfg, lines.join('\n')).catch(() => {});
}

// Deliver: render (missing images degrade gracefully) → send album/pdf → sent.
// Rotation untouched (promo is not a rotation product).
export async function deliverPromotion(cfg: GroupCfg, promoId: string, platform: 'instagram' | 'linkedin'): Promise<void> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo || !promo.content) throw new Error(`promotion ${promoId} has no content`);
  const r = await renderPromotion(promo, cfg, platform);
  const { sendMediaGroupPhoto, sendDocument, sendMessage } = await import('../telegram.ts');
  const caption = appendCaptionParts(promoCaption(promo), resolveCaptionParts(promo, cfg));
  if (r.missingImages.length > 0) {
    await sendMessage(cfg, `Promo "${promo.name}": ${r.missingImages.length} slide tanpa gambar (slot kosong) — tetap dikirim. Slide: ${r.missingImages.join(', ')}`).catch(() => {});
  }
  if (platform === 'instagram') {
    await sendMediaGroupPhoto(cfg, r.files.filter((f) => f.endsWith('.png')), caption);
  } else {
    await sendDocument(cfg, `${r.prefix}carousel.pdf`, `promo-${promoId}.pdf`, caption);
  }
  await markPromotionSent(promoId);
  console.log(`[promo] #${promoId} delivered (${platform}, ${r.files.length} artifacts) — rotation untouched`);
}

function promoCaption(p: Promotion): string {
  const parts = [p.name];
  if (p.topic) parts.push('', p.topic);
  if (p.price && p.price_sale) parts.push('', `${p.price_sale} (normal ${p.price})`);
  else if (p.price) parts.push('', p.price);
  return parts.join('\n').slice(0, 1024);
}

// store an uploaded image for a slide slot — CORRECT prefix: <slug>/promotions/<id>/
export async function storePromoImage(cfg: GroupCfg, promoId: string, slide: number, buf: Buffer): Promise<void> {
  const ext = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpg' : 'png';
  const file = `slide-${String(slide).padStart(2, '0')}.${ext}`;
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(`out/${promoId}`, { recursive: true });
  const tmp = `out/${promoId}/${file}`;
  writeFileSync(tmp, buf);
  await uploadPromotionImage(cfg.slug, promoId, tmp, file);
}

// is the promo fully imaged (every {{image}} slot has a stored file)?
export async function allImagesPresent(cfg: GroupCfg, promoId: string): Promise<boolean> {
  const slots = await imageSlotStatus(cfg, promoId);
  return slots.every((s) => s.present);
}

// Per-slot file status — drives the FE upload UI (upload ✓ per slot).
export async function imageSlotStatus(cfg: GroupCfg, promoId: string): Promise<{ slide: number; prompt: string; present: boolean }[]> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo?.content) return [];
  const out: { slide: number; prompt: string; present: boolean }[] = [];
  for (const s of imageSlots(promo)) {
    let found = false;
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      if (await artifactExists(`${cfg.slug}/promotions/${promoId}/slide-${String(s.slide).padStart(2, '0')}.${ext}`)) { found = true; break; }
      if (await artifactExists(`${cfg.slug}/posts/${promoId}/slide-${String(s.slide).padStart(2, '0')}.${ext}`)) { found = true; break; } // legacy prefix
    }
    out.push({ slide: s.slide, prompt: s.prompt, present: found });
  }
  return out;
}
