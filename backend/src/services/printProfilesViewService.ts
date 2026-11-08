import { prisma } from "../db";

// Kept in sync by hand with the frontend's PrintProfilesView. How a model page shows the print profiles a model was
// imported with: "off" as plain files, as they were before; "list", "picker" or "tiles" as profiles.
export const PRINT_PROFILES_VIEWS = ["off", "list", "picker", "tiles"] as const;
export type PrintProfilesView = (typeof PRINT_PROFILES_VIEWS)[number];
export const DEFAULT_PRINT_PROFILES_VIEW: PrintProfilesView = "picker";

export async function getPrintProfilesView(userId: string): Promise<PrintProfilesView> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { printProfilesView: true } });
  return PRINT_PROFILES_VIEWS.find((option) => option === user?.printProfilesView) ?? DEFAULT_PRINT_PROFILES_VIEW;
}

export async function setPrintProfilesView(userId: string, view: PrintProfilesView): Promise<PrintProfilesView> {
  await prisma.user.update({ where: { id: userId }, data: { printProfilesView: view } });
  return view;
}
