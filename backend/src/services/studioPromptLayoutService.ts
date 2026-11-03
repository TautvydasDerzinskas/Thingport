import { prisma } from "../db";

// Kept in sync by hand with the frontend's StudioPromptLayout. "bar" keeps Studio's assistant in the bar under the view,
// one line while it works; "panel" puts its conversation in a panel beside the view.
export const STUDIO_PROMPT_LAYOUTS = ["bar", "panel"] as const;
export type StudioPromptLayout = (typeof STUDIO_PROMPT_LAYOUTS)[number];

export async function getStudioPromptLayout(userId: string): Promise<StudioPromptLayout> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { studioPromptLayout: true } });
  return STUDIO_PROMPT_LAYOUTS.find((option) => option === user?.studioPromptLayout) ?? "bar";
}

export async function setStudioPromptLayout(userId: string, layout: StudioPromptLayout): Promise<StudioPromptLayout> {
  await prisma.user.update({ where: { id: userId }, data: { studioPromptLayout: layout } });
  return layout;
}
