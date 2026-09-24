// Promotion usecases: AI content generation, brief drafting, image-slot reporting.
import { chatJson, writerModel } from '../llm.ts';
import { isPromoContentOut, isPromoBriefOut, type PromoContentOut, type PromoBriefOut } from '../schema.ts';
import { promoContentPrompt, promoBriefPrompt, type PromoData } from '../prompts.ts';
import { getPromotion, setContent, setContentWithTemplate, imageSlots, markPromotionSent } from '../repos/promotions.ts';
import { getTemplate } from '../repos/templates.ts';
import { cssVocabOf, renderPromotion } from '../render/promotion.ts';
import { artifactExists, uploadPromotionImage } from '../storage.ts';
import { sendMessage } from '../telegram.ts';
import type { GroupCfg } from '../groups.ts';
import type { Promotion } from '@workspace/shared';

// AI writes the slides for a stored promotion (template css drives the layout).
// Image slots ({{image}}) reported back; status flips to awaiting_images/ready.
export async function generatePromotionContent(cfg: GroupCfg, promoId: string): Promise<{ slides: number; imageSlots: { slide: number; prompt: string }[] }> {
  const promo = await getPromotion(cfg.id, promoId);
  if (!promo) throw new Error(`promotion ${promoId} not found`);
  const tpl = promo.template_id ? await getTemplate(cfg.id, promo.template_id) : null;
  const cssVocab = cssVocabOf(tpl?.html ?? '');
  const data: PromoData = {
    name: promo.name, topic: promo.topic, features: promo.features, stacks: promo.stacks,
    stats: promo.stats, price: promo.price, price_sale: promo.price_sale,
  };
  const out = await chatJson<PromoContentOut>(
    cfg, writerModel(cfg), promoContentPrompt(data, cssVocab), isPromoContentOut, 8000,
  );
  const slides = out.data.slides.map((s) => ({ html: s.html, image_prompt: s.image_prompt ?? '' }));
  await setContent(promoId, slides);
  console.log(`[promo] #${promoId} content generated — ${slides.length} slides`);
  return { slides: slides.length, imageSlots: imageSlots({ ...promo, content: slides }) };
}

// AI drafts promo DATA from a rough brief (dashboard flow).
export async function draftPromotionFromBrief(cfg: GroupCfg, brief: string): Promise<PromoBriefOut> {
  const out = await chatJson<PromoBriefOut>(cfg, writerModel(cfg), promoBriefPrompt(brief), isPromoBriefOut, 3000);
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
  const cssVocab = cssVocabOf(tpl?.html ?? '');
  const data: PromoData = {
    name: promo.name, topic: promo.topic, features: promo.features, stacks: promo.stacks,
    stats: promo.stats, price: promo.price, price_sale: promo.price_sale,
  };
  const out = await chatJson<PromoContentOut>(
    cfg, writerModel(cfg), promoContentPrompt(data, cssVocab), isPromoContentOut, 8000,
  );
  const slides = out.data.slides.map((s) => ({ html: s.html, image_prompt: s.image_prompt ?? '' }));
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
  const caption = promoCaption(promo);
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
