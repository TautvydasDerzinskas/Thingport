import { z } from "zod";
import { prisma } from "../db";

// A person's Studio settings, kept on the account so every device has them: where Studio's assistant shows ("bar" keeps
// it in the bar under the view, one line while it works; "panel" puts its conversation in a panel beside the view), the
// units a new design starts in, and the grid, as CAD's preferences set them. Kept in sync by hand with the frontend's.
export const STUDIO_PROMPT_LAYOUTS = ["bar", "panel"] as const;
export type StudioPromptLayout = (typeof STUDIO_PROMPT_LAYOUTS)[number];
export const STUDIO_UNITS = ["mm", "cm", "in"] as const;
export type StudioUnits = (typeof STUDIO_UNITS)[number];

/** How the grid is drawn: adaptive, following the zoom at a density, or fixed at `major` mm with `subdivisions` minor
 *  lines between; and whether sketch points and moved bodies snap to it. */
export const studioGridSchema = z
  .object({
    show: z.boolean(),
    spacing: z.enum(["adaptive", "fixed"]),
    density: z.enum(["coarse", "normal", "fine"]),
    major: z.number().min(0.01).max(10_000),
    subdivisions: z.number().int().min(1).max(20),
    snap: z.boolean(),
  })
  .strict();
export type StudioGrid = z.infer<typeof studioGridSchema>;
export const STUDIO_GRID_DEFAULTS: StudioGrid = {
  show: true,
  spacing: "adaptive",
  density: "normal",
  major: 10,
  subdivisions: 10,
  snap: true,
};

export type StudioSettings = { promptLayout: StudioPromptLayout; units: StudioUnits; grid: StudioGrid };

/** What's stored, over the defaults: a value that no longer reads right is the default again. */
function gridOf(stored: unknown): StudioGrid {
  const parsed = studioGridSchema.partial().safeParse(stored ?? {});
  return { ...STUDIO_GRID_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
}

export async function getStudioSettings(userId: string): Promise<StudioSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studioPromptLayout: true, studioUnits: true, studioGrid: true },
  });
  return {
    promptLayout: STUDIO_PROMPT_LAYOUTS.find((option) => option === user?.studioPromptLayout) ?? "bar",
    units: STUDIO_UNITS.find((option) => option === user?.studioUnits) ?? "mm",
    grid: gridOf(user?.studioGrid),
  };
}

/** Changes what's given, the grid's settings one by one, and returns them all. */
export async function setStudioSettings(
  userId: string,
  changes: Partial<Omit<StudioSettings, "grid">> & { grid?: Partial<StudioGrid> },
): Promise<StudioSettings> {
  const grid = changes.grid ? { ...(await getStudioSettings(userId)).grid, ...changes.grid } : null;
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(changes.promptLayout ? { studioPromptLayout: changes.promptLayout } : {}),
      ...(changes.units ? { studioUnits: changes.units } : {}),
      ...(grid ? { studioGrid: grid } : {}),
    },
  });
  return getStudioSettings(userId);
}
