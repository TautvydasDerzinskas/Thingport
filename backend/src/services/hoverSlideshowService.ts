import { prisma } from "../db";

export async function getHoverSlideshowEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hoverSlideshowEnabled: true } });
  return user?.hoverSlideshowEnabled ?? true;
}

export async function setHoverSlideshowEnabled(userId: string, enabled: boolean): Promise<boolean> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { hoverSlideshowEnabled: enabled },
    select: { hoverSlideshowEnabled: true },
  });
  return user.hoverSlideshowEnabled;
}
