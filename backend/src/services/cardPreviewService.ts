import { prisma } from "../db";

// Kept in sync by hand with the frontend's CardPreview. "images" leads with a model's pictures from its import or
// upload and falls back to our render; "renders" leads with the render and falls back to the pictures.
export const CARD_PREVIEWS = ["images", "renders"] as const;
export type CardPreview = (typeof CARD_PREVIEWS)[number];

export async function getCardPreview(userId: string): Promise<CardPreview> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { cardPreview: true } });
  return CARD_PREVIEWS.find((option) => option === user?.cardPreview) ?? "images";
}

export async function setCardPreview(userId: string, preview: CardPreview): Promise<CardPreview> {
  await prisma.user.update({ where: { id: userId }, data: { cardPreview: preview } });
  return preview;
}
