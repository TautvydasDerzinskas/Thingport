import { prisma } from "../db";

// A person's Studio settings, kept on the account so every device has them: where Studio's assistant shows ("bar" keeps
// it in the bar under the view, one line while it works; "panel" puts its conversation in a panel beside the view), and
// the units a new design starts in, as CAD's preferences set them. Kept in sync by hand with the frontend's.
export const STUDIO_PROMPT_LAYOUTS = ["bar", "panel"] as const;
export type StudioPromptLayout = (typeof STUDIO_PROMPT_LAYOUTS)[number];
export const STUDIO_UNITS = ["mm", "cm", "in"] as const;
export type StudioUnits = (typeof STUDIO_UNITS)[number];

export type StudioSettings = { promptLayout: StudioPromptLayout; units: StudioUnits };

export async function getStudioSettings(userId: string): Promise<StudioSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studioPromptLayout: true, studioUnits: true },
  });
  return {
    promptLayout: STUDIO_PROMPT_LAYOUTS.find((option) => option === user?.studioPromptLayout) ?? "bar",
    units: STUDIO_UNITS.find((option) => option === user?.studioUnits) ?? "mm",
  };
}

/** Changes what's given, and returns them all. */
export async function setStudioSettings(userId: string, changes: Partial<StudioSettings>): Promise<StudioSettings> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(changes.promptLayout ? { studioPromptLayout: changes.promptLayout } : {}),
      ...(changes.units ? { studioUnits: changes.units } : {}),
    },
  });
  return getStudioSettings(userId);
}
