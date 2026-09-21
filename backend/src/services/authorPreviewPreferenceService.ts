import { prisma } from "../db";

// Whether hovering an author link opens the author preview card (frontend's AuthorHoverCard).
// A plain per-user on/off switch, on by default (the column's own default), toggled from the
// Profile page.

export async function getUserAuthorPreviewEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { authorPreviewEnabled: true } });
  return user?.authorPreviewEnabled ?? true;
}

export async function setUserAuthorPreviewEnabled(userId: string, enabled: boolean): Promise<boolean> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { authorPreviewEnabled: enabled },
    select: { authorPreviewEnabled: true },
  });
  return user.authorPreviewEnabled;
}
