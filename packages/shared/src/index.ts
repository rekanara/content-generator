// Shared kontrak API FE↔BE — zod = single source of truth.
// BE: parse request/response. FE: parse fetch result + form validation.
import { z } from 'zod';

// ---------- enums domain (mirror state.ts; state.ts TIDAK import zod — pure) ----------
export const Platform = z.enum(['instagram', 'linkedin']);
export type Platform = z.infer<typeof Platform>;

export const IgFormat = z.enum(['carousel', 'reels']);
export const LiFormat = z.enum(['text', 'pdf']);
export const Format = z.enum(['carousel', 'reels', 'pdf', 'text']);
export type Format = z.infer<typeof Format>;

// Template format (DB check constraint) — beda domain dari Format.
export const TemplateFormat = z.enum(['ig-carousel', 'li-carousel', 'reel']);
export type TemplateFormat = z.infer<typeof TemplateFormat>;

export const PostStatus = z.enum(['draft', 'queued', 'rendered', 'sent', 'failed']);
export type PostStatus = z.infer<typeof PostStatus>;

// ---------- response shapes ----------
export const Pillar = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  is_news: z.boolean(),
  active: z.boolean(),
  sort_order: z.number(),
});
export type Pillar = z.infer<typeof Pillar>;

export const PillarInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  is_news: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});
export type PillarInput = z.infer<typeof PillarInput>;

export const CronSettings = z.object({
  expr: z.string(),
  enabled: z.boolean(),
  running: z.boolean(),
});
export type CronSettings = z.infer<typeof CronSettings>;

export const CronInput = z.object({
  expr: z.string().min(1), // validasi expr via cron pkg di BE
  enabled: z.boolean().default(false),
});
export type CronInput = z.infer<typeof CronInput>;

export const PostSummary = z.object({
  id: z.number(),
  platform: z.string(),
  format: z.string(),
  topic: z.string(),
  status: PostStatus,
  source: z.string(),
  created_at: z.string(),
  pillar_id: z.number().nullable(),
});
export type PostSummary = z.infer<typeof PostSummary>;

export const PostDetail = PostSummary.extend({
  caption: z.string(),
  error: z.string().nullable(),
  body_text: z.string(), // body sudah dirapikan (slides/scenes → teks)
});
export type PostDetail = z.infer<typeof PostDetail>;

export const StyleSample = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  platform: z.string().nullable(),
  created_at: z.string(),
});
export type StyleSample = z.infer<typeof StyleSample>;

export const StyleInput = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  platform: Platform.nullable().default(null),
});
export type StyleInput = z.infer<typeof StyleInput>;

export const Template = z.object({
  id: z.number(),
  name: z.string(),
  format: TemplateFormat,
  is_active: z.boolean(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof Template>;

export const TemplateInput = z.object({
  name: z.string().min(1),
  format: TemplateFormat,
  html: z.string().min(1),
  is_active: z.boolean().default(false),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

export const RotationView = z.object({
  last_platform: z.string(),
  last_ig_format: z.string().nullable(),
  last_li_format: z.string().nullable(),
  last_pillar_id: z.number().nullable(),
  updated_at: z.string().nullable(),
});
export type RotationView = z.infer<typeof RotationView>;

export const NextSlot = z.object({
  platform: Platform,
  format: Format,
  pillar_id: z.number(),
});
export type NextSlot = z.infer<typeof NextSlot>;

export const Dashboard = z.object({
  cron: CronSettings,
  queue: z.object({ running: z.boolean(), pending: z.number() }),
  rotation: RotationView,
  next_slot: NextSlot,
  last_posts: z.array(PostSummary),
});
export type Dashboard = z.infer<typeof Dashboard>;

export const GenerateInput = z.object({
  platform: Platform.optional(),
  format: Format.optional(),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

// Token template per format — utk hint UI + validasi FE.
export const TEMPLATE_TOKENS: Record<TemplateFormat, string[]> = {
  'ig-carousel': ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  'li-carousel': ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  reel: ['{{overlay}}', '{{index}}', '{{total}}'],
};
