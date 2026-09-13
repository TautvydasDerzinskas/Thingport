import { prisma } from "../db";

// Kept in sync by hand with frontend's constants/settingsOptions.ts ThemeSelection -- there's no
// shared package between the two, and this list changes rarely enough that duplicating it here
// (like slicerPreferenceService.ts's SLICER_IDS) is simpler than wiring up a shared module.
export const THEME_SELECTIONS = ["light", "dark", "system"] as const;
export type ThemeSelection = (typeof THEME_SELECTIONS)[number];

function isThemeSelection(value: string): value is ThemeSelection {
  return (THEME_SELECTIONS as readonly string[]).includes(value);
}

export async function getUserTheme(userId: string): Promise<ThemeSelection | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { themePreference: true } });
  const value = user?.themePreference;
  return value && isThemeSelection(value) ? value : null;
}

export async function setUserTheme(userId: string, theme: string | null): Promise<ThemeSelection | null> {
  const next = theme && isThemeSelection(theme) ? theme : null;
  await prisma.user.update({ where: { id: userId }, data: { themePreference: next } });
  return next;
}
