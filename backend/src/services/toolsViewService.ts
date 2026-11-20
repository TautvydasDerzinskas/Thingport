import { z } from "zod";
import { prisma } from "../db";
import { SORT_DIRECTIONS } from "../utils/sortDirection";
import { TOOL_CATEGORIES } from "./toolFormat";

// How the user arranged their Tools page. Kept per user rather than per browser, so the page opens the same way on
// every device, as the models page's tree does.
//
// A tool's shelf comes from its own metadata; what's stored here is only where the user moved one themselves, so a
// tool that changes its mind about where it belongs still goes where the user put it.

/** Tools as icons in one grid, or split onto their shelves with a heading each. */
export const TOOL_LAYOUTS = ["flat", "categories"] as const;
export type ToolLayout = (typeof TOOL_LAYOUTS)[number];

/** The orders the page offers, in the order the control lists them. */
export const TOOL_SORTS = ["name", "newest", "author"] as const;
export type ToolSort = (typeof TOOL_SORTS)[number];

export const toolsViewSchema = z.object({
  layout: z.enum(TOOL_LAYOUTS).default("categories"),
  sort: z.enum(TOOL_SORTS).default("newest"),
  sortDirection: z.enum(SORT_DIRECTIONS).optional(),
  /** Where the user moved a tool, by its id; anything else sits where its metadata says. */
  categories: z.record(z.string().max(60), z.enum(TOOL_CATEGORIES)).default({}),
});
export type ToolsView = z.infer<typeof toolsViewSchema>;

export const DEFAULT_TOOLS_VIEW: ToolsView = { layout: "categories", sort: "newest", categories: {} };

export async function getToolsView(userId: string, db: Pick<typeof prisma, "user"> = prisma): Promise<ToolsView> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { toolsView: true } });
  const parsed = toolsViewSchema.safeParse(user?.toolsView ?? {});
  // Something stored that no longer fits the shape is the same as never having chosen.
  return parsed.success ? parsed.data : DEFAULT_TOOLS_VIEW;
}

/** Changes only what's given: the layout, the order, or where one tool sits. */
export async function setToolsView(userId: string, patch: Partial<ToolsView>): Promise<ToolsView> {
  return prisma.$transaction(async (tx) => {
    // Save concurrent changes to different parts of the view without overwriting one another.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await getToolsView(userId, tx);
    const sort = patch.sort ?? current.sort;
    const sortDirection = patch.sortDirection ?? (sort === current.sort ? current.sortDirection : undefined);
    const next: ToolsView = {
      layout: patch.layout ?? current.layout,
      sort,
      ...(sortDirection ? { sortDirection } : {}),
      categories: patch.categories ? { ...current.categories, ...patch.categories } : current.categories,
    };
    await tx.user.update({ where: { id: userId }, data: { toolsView: next } });
    return next;
  });
}
