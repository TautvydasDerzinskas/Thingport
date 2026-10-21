import { prisma } from "../db";

// Kept in sync by hand with the frontend's ThemeSelection and AccentColor.
export const THEME_SELECTIONS = ["light", "dark", "system"] as const;
export type ThemeSelection = (typeof THEME_SELECTIONS)[number];
export const ACCENT_COLORS = ["green", "blue", "orange", "amber", "teal", "purple", "graphite"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
// The accents, then light grey, which leaves the render's own grey shading all but untinted.
export const RENDER_COLORS = [...ACCENT_COLORS, "light"] as const;
export type RenderColor = (typeof RENDER_COLORS)[number];

function isThemeSelection(value: string): value is ThemeSelection {
  return (THEME_SELECTIONS as readonly string[]).includes(value);
}

function isAccentColor(value: string): value is AccentColor {
  return (ACCENT_COLORS as readonly string[]).includes(value);
}

function isRenderColor(value: string): value is RenderColor {
  return (RENDER_COLORS as readonly string[]).includes(value);
}

export type ThemePreferences = {
  theme: ThemeSelection | null;
  accent: AccentColor | null;
  renderColor: RenderColor | null;
};

export async function getUserThemePreferences(userId: string): Promise<ThemePreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { themePreference: true, accentColor: true, renderColor: true },
  });
  const theme = user?.themePreference;
  const accent = user?.accentColor;
  const renderColor = user?.renderColor;
  return {
    theme: theme && isThemeSelection(theme) ? theme : null,
    accent: accent && isAccentColor(accent) ? accent : null,
    renderColor: renderColor && isRenderColor(renderColor) ? renderColor : null,
  };
}

/** Only the fields given change; null clears one back to the frontend's default. A new accent puts the render
 *  colour back to following it, unless the same patch sets one. */
export async function setUserThemePreferences(
  userId: string,
  patch: { theme?: string | null; accent?: string | null; renderColor?: string | null },
): Promise<ThemePreferences> {
  const data: {
    themePreference?: ThemeSelection | null;
    accentColor?: AccentColor | null;
    renderColor?: RenderColor | null;
  } = {};
  if (patch.theme !== undefined)
    data.themePreference = patch.theme && isThemeSelection(patch.theme) ? patch.theme : null;
  if (patch.accent !== undefined) {
    data.accentColor = patch.accent && isAccentColor(patch.accent) ? patch.accent : null;
    data.renderColor = null;
  }
  if (patch.renderColor !== undefined)
    data.renderColor = patch.renderColor && isRenderColor(patch.renderColor) ? patch.renderColor : null;
  await prisma.user.update({ where: { id: userId }, data });
  return getUserThemePreferences(userId);
}
