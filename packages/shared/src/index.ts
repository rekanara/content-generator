// Shared API contract FE↔BE — zod = single source of truth.
// BE: parse request/response. FE: parse fetch result + form validation.
import { z } from 'zod';

// ---------- domain enums (mirror state.ts; state.ts does NOT import zod — pure) ----------
export const Platform = z.enum(['instagram', 'linkedin']);
export type Platform = z.infer<typeof Platform>;

export const IgFormat = z.enum(['carousel', 'reels']);
export const LiFormat = z.enum(['text', 'pdf']);
export const Format = z.enum(['carousel', 'reels', 'pdf', 'text']);
export type Format = z.infer<typeof Format>;

// Template format (DB check constraint) — different domain from Format.
export const TemplateFormat = z.enum(['ig-carousel', 'li-carousel', 'reel']);
export type TemplateFormat = z.infer<typeof TemplateFormat>;

// Template role: 'regular' = pipeline rendering (default), the others mark a template
// as designed for override content of that type (override forms filter by this).
export const TemplateType = z.enum(['regular', 'mix', 'image_only', 'text_only']);
export type TemplateType = z.infer<typeof TemplateType>;

// Override content types: mix = exactly 1 image + description; image_only = 1..10 images
// (+ caption); text_only = description only (no images).
export const OverrideType = z.enum(['mix', 'image_only', 'text_only']);
export type OverrideType = z.infer<typeof OverrideType>;

// Plan types: slot_override = pinned pipeline spec for a date; override_content = link
// to an override row (system-created by the override flow).
export const PlanType = z.enum(['slot_override', 'override_content']);
export type PlanType = z.infer<typeof PlanType>;

export const PostStatus = z.enum(['draft', 'queued', 'rendered', 'awaiting_cover', 'awaiting_approval', 'sent', 'failed', 'rejected']);
export type PostStatus = z.infer<typeof PostStatus>;

// ---------- groups (multi-account) ----------
// Secrets (api_key, bot_token) NEVER leave the API in full — only a "set" flag.
const GROUP_CONFIG_FIELDS = {
  llm_base_url: z.string().nullable(),
  llm_model: z.string().nullable(),
  llm_model_critic: z.string().nullable(),
  image_model: z.string().nullable(),
  tts_provider: z.string().nullable(),
  tts_voice: z.string().nullable(),
  tts_base_url: z.string().nullable(),
  tts_model: z.string().nullable(),
  telegram_chat_id: z.string().nullable(),
  llm_api_key_set: z.boolean(),
  tts_api_key_set: z.boolean(),
  telegram_bot_token_set: z.boolean(),
};

export const Group = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  cron_expr: z.string(),
  cron_enabled: z.boolean(),
  approval_required: z.boolean(),
  auto_plan: z.boolean(),
  created_at: z.string(),
  ...GROUP_CONFIG_FIELDS,
});
export type Group = z.infer<typeof Group>;

export const GroupInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'slug: lowercase letters, digits, dashes'),
  name: z.string().min(1),
  cron_expr: z.string().min(1).default('0 7 * * *'),
  cron_enabled: z.boolean().default(true),
  llm_base_url: z.string().nullable().default(null),
  llm_api_key: z.string().nullable().default(null),
  llm_model: z.string().nullable().default(null),
  llm_model_critic: z.string().nullable().default(null),
  image_model: z.string().nullable().default(null),
  tts_provider: z.string().nullable().default(null),
  tts_voice: z.string().nullable().default(null),
  tts_base_url: z.string().nullable().default(null),
  tts_api_key: z.string().nullable().default(null),
  tts_model: z.string().nullable().default(null),
  telegram_bot_token: z.string().nullable().default(null),
  telegram_chat_id: z.string().nullable().default(null),
  approval_required: z.boolean().default(false),
  auto_plan: z.boolean().default(false),
});
export type GroupInput = z.infer<typeof GroupInput>;
// Input version (fields with defaults become optional) — for request bodies from the FE.
export type GroupInputBody = z.input<typeof GroupInput>;

export const GroupPatch = z.object({
  name: z.string().min(1).optional(),
  cron_expr: z.string().min(1).optional(),
  cron_enabled: z.boolean().optional(),
  llm_base_url: z.string().nullable().optional(),
  llm_api_key: z.string().nullable().optional(), // null = remove override, fall back to env
  llm_model: z.string().nullable().optional(),
  llm_model_critic: z.string().nullable().optional(),
  image_model: z.string().nullable().optional(),
  tts_provider: z.string().nullable().optional(),
  tts_voice: z.string().nullable().optional(),
  tts_base_url: z.string().nullable().optional(),
  tts_api_key: z.string().nullable().optional(),
  tts_model: z.string().nullable().optional(),
  telegram_bot_token: z.string().nullable().optional(),
  telegram_chat_id: z.string().nullable().optional(),
  approval_required: z.boolean().optional(),
  auto_plan: z.boolean().optional(),
});
export type GroupPatch = z.infer<typeof GroupPatch>;

// ---------- response shapes ----------
export const Pillar = z.object({
  id: z.string().uuid(),
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

// Full-field edit (FE edit form sends every field — no partial semantics to trip on).
export const PillarEdit = PillarInput;
export type PillarEdit = z.infer<typeof PillarEdit>;

export const CronSettings = z.object({
  expr: z.string(),
  enabled: z.boolean(),
  running: z.boolean(),
});
export type CronSettings = z.infer<typeof CronSettings>;

export const CronInput = z.object({
  expr: z.string().min(1), // expr validated via cron pkg on the BE
  enabled: z.boolean().default(false),
});
export type CronInput = z.infer<typeof CronInput>;

export const PostSummary = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  format: z.string(),
  topic: z.string(),
  status: PostStatus,
  source: z.string(),
  created_at: z.string(),
  pillar_id: z.string().uuid().nullable(),
});
export type PostSummary = z.infer<typeof PostSummary>;

export const PostDetail = PostSummary.extend({
  caption: z.string(),
  error: z.string().nullable(),
  body_text: z.string(), // body flattened to text (slides/scenes → text)
  artifacts: z.array(z.string()), // artifact file names per format (exist once rendered)
});
export type PostDetail = z.infer<typeof PostDetail>;

export const StyleSample = z.object({
  id: z.string().uuid(),
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

// Full-field edit. platform null = "all platforms" (NOT "skip this field").
export const StyleEdit = StyleInput;
export type StyleEdit = z.infer<typeof StyleEdit>;

export const Template = z.object({
  id: z.string().uuid(),
  name: z.string(),
  format: TemplateFormat,
  type: TemplateType,
  is_active: z.boolean(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof Template>;

// Detail view incl. HTML (list excludes it — payloads stay small).
// One template = one visual package: html = body slides, html_first = cover page
// ({{image}} token, optional), html_last = CTA page (optional). null → falls back to body.
export const TemplateDetail = Template.extend({
  html: z.string(),
  html_first: z.string().nullable(),
  html_last: z.string().nullable(),
});
export type TemplateDetail = z.infer<typeof TemplateDetail>;

export const TemplateInput = z.object({
  name: z.string().min(1),
  format: TemplateFormat,
  type: TemplateType.default('regular'),
  html: z.string().min(1),
  html_first: z.string().min(1).nullable().default(null),
  html_last: z.string().min(1).nullable().default(null),
  is_active: z.boolean().default(false),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

// Edit: name + html parts. null on a part = remove it (falls back to body).
export const TemplateEdit = z.object({
  name: z.string().min(1),
  html: z.string().min(1),
  html_first: z.string().min(1).nullable(),
  html_last: z.string().min(1).nullable(),
});
export type TemplateEdit = z.infer<typeof TemplateEdit>;

export const RotationView = z.object({
  last_platform: z.string(),
  last_ig_format: z.string().nullable(),
  last_li_format: z.string().nullable(),
  last_pillar_id: z.string().uuid().nullable(),
  updated_at: z.string().nullable(),
});
export type RotationView = z.infer<typeof RotationView>;

export const NextSlot = z.object({
  platform: Platform,
  format: Format,
  pillar_id: z.string().uuid(),
});
export type NextSlot = z.infer<typeof NextSlot>;

export const Dashboard = z.object({
  cron: CronSettings, // active group's cron
  queue: z.object({ running: z.boolean(), pending: z.number() }), // active group's queue
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

// ---------- calendar preview ----------
// One upcoming run: slot sequence from pure rotation + (optional) scheduled fire time
// from the group's cron expr. scheduled_at null when cron is off or beyond computed fires.
// planned carries the plan owning that date (if any) — pinned spec or override content.
// ponytail: in-flight queue runs are NOT reflected — rotation advances only after `sent`.
export const CalendarRun = z.object({
  scheduled_at: z.string().nullable(),
  platform: Platform,
  format: Format,
  pillar_id: z.string().uuid(),
  pillar_name: z.string(),
  planned: z.object({
    type: PlanType,
    note: z.string(),
    platform: z.enum(['instagram', 'linkedin']).nullable(),
    format: Format.nullable(),
    template_name: z.string().nullable(),
  }).nullable(),
});
export type CalendarRun = z.infer<typeof CalendarRun>;

// ---------- override content ----------
// Manual content that replaces the automatic pipeline for a specific date.
export const Override = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: OverrideType,
  template_id: z.string().uuid().nullable(),
  description: z.string(),
  for_date: z.string(), // YYYY-MM-DD (Asia/Jakarta)
  images: z.array(z.string()), // artifact file names (MinIO overrides/<id>/)
  status: z.enum(['scheduled', 'sent', 'cancelled']),
  created_at: z.string(),
});
export type Override = z.infer<typeof Override>;

// text-field part of the create form (dashboard sends multipart: these + image files)
export const OverrideInput = z.object({
  name: z.string().min(1),
  type: OverrideType,
  template_id: z.string().uuid().nullable().default(null),
  description: z.string().default(''),
  for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type OverrideInput = z.infer<typeof OverrideInput>;

// ---------- plans ----------
// Date-scoped source of truth: what runs on a given day. Plans are EXCEPTIONS —
// no plan row = natural rotation. slot_override pins the pipeline spec for that
// date (platform/format/pillar/template, each field optional → natural fallback);
// override_content rows are created automatically by the override flow.
export const Plan = z.object({
  id: z.string().uuid(),
  for_date: z.string(),
  type: PlanType,
  platform: z.enum(['instagram', 'linkedin']).nullable(),
  format: Format.nullable(),
  pillar_id: z.string().uuid().nullable(),
  template_id: z.string().uuid().nullable(),
  override_id: z.string().uuid().nullable(),
  note: z.string(),
  status: z.enum(['active', 'cancelled']),
  created_at: z.string(),
});
export type Plan = z.infer<typeof Plan>;

// create slot_override via API (override_content plans are system-created)
export const PlanInput = z.object({
  for_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platform: z.enum(['instagram', 'linkedin']).nullish(),
  format: Format.nullish(),
  pillar_id: z.string().uuid().nullish(),
  template_id: z.string().uuid().nullish(),
  note: z.string().default(''),
}).refine((d) => {
  // format must match platform when both given
  if (d.platform && d.format) {
    if (d.platform === 'instagram' && (d.format === 'pdf' || d.format === 'text')) return false;
    if (d.platform === 'linkedin' && (d.format === 'carousel' || d.format === 'reels')) return false;
  }
  return true;
}, { message: 'format does not match platform (IG: carousel|reels, LI: pdf|text)' });
export type PlanInput = z.infer<typeof PlanInput>;

// Template tokens per format — for UI hints + FE validation.
// {{image}} (generated cover, data-URI) only on the html_first part of carousel formats.
// Reels are scene-based: html only, no first/last parts.
export const TEMPLATE_TOKENS: Record<TemplateFormat, { body: string[]; first?: string[]; last?: string[] }> = {
  'ig-carousel': {
    first: ['{{image}}', '{{headline}}', '{{index}}', '{{total}}'],
    body: ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
    last: ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  },
  'li-carousel': {
    first: ['{{image}}', '{{headline}}', '{{index}}', '{{total}}'],
    body: ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
    last: ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  },
  reel: {
    body: ['{{overlay}}', '{{index}}', '{{total}}'],
  },
};

// ---------- auth ----------
export const AuthMe = z.object({
  username: z.string(),
  role: z.enum(['admin', 'user']),
});
export type AuthMe = z.infer<typeof AuthMe>;

export const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof LoginBody>;

// ---------- users (admin) ----------
export const UserRow = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(['admin', 'user']),
});
export type UserRow = z.infer<typeof UserRow>;

export const UserInputBody = z.object({
  username: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']),
});
export type UserInputBody = z.infer<typeof UserInputBody>;
