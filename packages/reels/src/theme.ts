import { z } from 'zod';

export const ReelsTheme = z.object({
  layout: z.enum(['kinetic', 'news', 'minimal', 'split']).default('kinetic'),
  palette: z.object({
    bg: z.string().default('#111111'),
    bg2: z.string().default('#2a2723'),
    text: z.string().default('#f4efe6'),
    muted: z.string().default('#a59f95'),
    accent: z.string().default('#ff4d2e'),
  }).prefault({}),
  font: z.object({
    family: z.string().default('Anton'),
    weight: z.number().default(400),
    scale: z.number().default(1),
  }).prefault({}),
  captions: z.object({
    style: z.enum(['word-highlight', 'line', 'none']).default('word-highlight'),
    position: z.enum(['top', 'center', 'bottom']).default('bottom'),
    case: z.enum(['preserve', 'upper']).default('preserve'),
  }).prefault({}),
  transition: z.object({ durationFrames: z.number().int().min(0).max(30).default(10) }).prefault({}),
  progressBar: z.boolean().default(true),
  brand: z.object({ handle: z.string().default(''), position: z.enum(['top', 'bottom']).default('bottom') }).prefault({}),
});

export type ReelsTheme = z.infer<typeof ReelsTheme>;
export const DEFAULT_THEME: ReelsTheme = ReelsTheme.parse({});

export function parseTheme(x: unknown): ReelsTheme {
  const parsed = ReelsTheme.safeParse(x);
  return parsed.success ? parsed.data : DEFAULT_THEME;
}
