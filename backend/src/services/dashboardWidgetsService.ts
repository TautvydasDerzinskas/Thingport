import { prisma } from "../db";

// Kept in sync by hand with the frontend's DashboardWidgetId.
export const DASHBOARD_WIDGETS = [
  "collectionCount",
  "modelCount",
  "authorCount",
  "categoryCount",
  "topViewed",
  "topPrinted",
  "recentlyAdded",
  "topAuthors",
  "topProviders",
  "clock",
  "weather",
  "featuredModel",
  "activityHeatmap",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number];
export type DashboardWidgets = Partial<Record<DashboardWidgetId, boolean>>;

const KNOWN = new Set<string>(DASHBOARD_WIDGETS);

/** Drops anything that isn't a current widget's on/off, e.g. a widget since removed. */
function clean(value: unknown): DashboardWidgets {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: DashboardWidgets = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (KNOWN.has(id) && typeof enabled === "boolean") out[id as DashboardWidgetId] = enabled;
  }
  return out;
}

/** Only what the user has changed; the frontend knows each widget's default. Stored per user, not
 *  per browser, so every device shows the same dashboard. */
export async function getDashboardWidgets(userId: string): Promise<DashboardWidgets> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dashboardWidgets: true } });
  return clean(user?.dashboardWidgets);
}

export async function setDashboardWidgets(userId: string, changes: DashboardWidgets): Promise<DashboardWidgets> {
  // Merged in the database in one statement, so two quick toggles can't drop each other's change.
  const rows = await prisma.$queryRaw<{ dashboardWidgets: unknown }[]>`
    UPDATE "User"
    SET "dashboardWidgets" = COALESCE("dashboardWidgets", '{}'::jsonb) || ${JSON.stringify(changes)}::jsonb,
      -- Raw SQL skips Prisma's @updatedAt.
      "updatedAt" = NOW()
    WHERE "id" = ${userId}
    RETURNING "dashboardWidgets"`;
  return clean(rows[0]?.dashboardWidgets);
}

// Kept in sync by hand with the frontend's DashboardLayout. Each names where the count boxes go.
export const DASHBOARD_LAYOUTS = ["left", "top", "right", "bottom", "topTwo", "puzzle"] as const;
export type DashboardLayout = (typeof DASHBOARD_LAYOUTS)[number];

/** A layout since removed falls back to the default rather than breaking the page. */
export async function getDashboardLayout(userId: string): Promise<DashboardLayout> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dashboardLayout: true } });
  return DASHBOARD_LAYOUTS.find((layout) => layout === user?.dashboardLayout) ?? "left";
}

export async function setDashboardLayout(userId: string, layout: DashboardLayout): Promise<DashboardLayout> {
  await prisma.user.update({ where: { id: userId }, data: { dashboardLayout: layout } });
  return layout;
}
