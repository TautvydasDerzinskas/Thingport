import { z } from "zod";
import { prisma } from "../db";
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
  layout: z.enum(TOOL_LAYOUTS).default("flat"),
  sort: z.enum(TOOL_SORTS).default("name"),
  /** Where the user moved a tool, by its id; anything else sits where its metadata says. */
  categories: z.record(z.string().max(60), z.enum(TOOL_CATEGORIES)).default({}),
});
export type ToolsView = z.infer<typeof toolsViewSchema>;

export const DEFAULT_TOOLS_VIEW: ToolsView = { layout: "flat", sort: "name", categories: {} };

export async function getToolsView(userId: string): Promise<ToolsView> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { toolsView: true } });
  const parsed = toolsViewSchema.safeParse(user?.toolsView ?? {});
  // Something stored that no longer fits the shape is the same as never having chosen.
  return parsed.success ? parsed.data : DEFAULT_TOOLS_VIEW;
}

/** Changes only what's given: the layout, the order, or where one tool sits. */
export async function setToolsView(userId: string, patch: Partial<ToolsView>): Promise<ToolsView> {
  const current = await getToolsView(userId);
  const next: ToolsView = {
    layout: patch.layout ?? current.layout,
    sort: patch.sort ?? current.sort,
    categories: patch.categories ? { ...current.categories, ...patch.categories } : current.categories,
  };
  // A tool moved back to where its metadata puts it leaves nothing behind.
  await prisma.user.update({ where: { id: userId }, data: { toolsView: next } });
  return next;
}
