import { DEFAULT_THEME, parseTheme, type ReelsThemeType } from "@workspace/reels"

export const DEFAULT_REEL_THEME_JSON = JSON.stringify(DEFAULT_THEME, null, 2)

export function themeFromJson(html: string): ReelsThemeType {
  try { return parseTheme(JSON.parse(html)) } catch { return DEFAULT_THEME }
}
