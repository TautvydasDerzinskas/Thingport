import { z } from "zod";
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

// Kept in sync by hand with the frontend's DashboardBreakpoint: wide (12 columns), medium (6) and phone (1).
export const DASHBOARD_BREAKPOINTS = ["lg", "md", "sm"] as const;
export const MAX_DASHBOARD_TEMPLATES = 30;

const gridItems = z
  .array(
    z.object({
      i: z.string().min(1).max(64),
      x: z.number().int().min(0).max(11),
      y: z.number().int().min(0).max(500),
      w: z.number().int().min(1).max(12),
      h: z.number().int().min(1).max(40),
    }),
  )
  .max(DASHBOARD_WIDGETS.length)
  .optional();

/** Saving takes only current widget ids; reading takes any, and `cleanTemplate` drops the ones since removed, so
 *  removing a widget doesn't throw away the user's whole dashboard. */
function configSchema<W extends z.ZodTypeAny>(widgetId: W) {
  return z.object({
    active: z.string().min(1).max(64),
    // The built-in templates the user has been given, so one added in a later release is offered once, and one they
    // deleted doesn't come back.
    offered: z.array(z.string().max(32)).max(50).optional(),
    templates: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          // Null shows the preset's translated name, so a built-in template follows the user's language until renamed.
          name: z.string().trim().min(1).max(60).nullable(),
          preset: z.string().max(32).nullable(),
          panels: z
            .array(
              z.object({
                id: z.string().min(1).max(64),
                // More than one makes a tabbed panel; `tab` is the one it shows.
                widgets: z.array(widgetId).min(1).max(DASHBOARD_WIDGETS.length),
                tab: z.number().int().min(0).max(DASHBOARD_WIDGETS.length).optional(),
              }),
            )
            .max(DASHBOARD_WIDGETS.length),
          // Only the breakpoints the user has arranged; the frontend derives the rest from the widest one.
          layouts: z.object({ lg: gridItems, md: gridItems, sm: gridItems }),
          // Each widget's own options, e.g. the clock's 12/24-hour format, as only what differs from its defaults.
          // The frontend knows each widget's options and drops values it doesn't recognise.
          settings: z
            .record(
              z.string().max(40),
              z.record(z.string().max(40), z.union([z.string().max(40), z.number(), z.boolean()])),
            )
            .refine((value) => Object.keys(value).length <= DASHBOARD_WIDGETS.length * 2)
            .optional(),
        }),
      )
      .min(1)
      .max(MAX_DASHBOARD_TEMPLATES),
  });
}

export const dashboardConfigSchema = configSchema(z.enum(DASHBOARD_WIDGETS));
const storedConfigSchema = configSchema(z.string());
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
type StoredTemplate = z.infer<typeof storedConfigSchema>["templates"][number];

/** Drops what no longer fits -- a widget since removed, a panel left empty, layout for a panel that's gone -- rather
 *  than failing the whole dashboard over it. */
function cleanConfig(config: z.infer<typeof storedConfigSchema>): DashboardConfig {
  const templates = config.templates.map((template: StoredTemplate) => {
    const seen = new Set<string>();
    const panels = template.panels.flatMap((panel) => {
      // A widget shows at most once per template.
      const widgets = panel.widgets.filter(
        (id): id is DashboardWidgetId => KNOWN.has(id) && !seen.has(id) && !!seen.add(id),
      );
      return widgets.length ? [{ ...panel, widgets }] : [];
    });
    const panelIds = new Set(panels.map((panel) => panel.id));
    const layouts: DashboardConfig["templates"][number]["layouts"] = {};
    for (const breakpoint of DASHBOARD_BREAKPOINTS) {
      const items = template.layouts[breakpoint];
      if (items) layouts[breakpoint] = items.filter((item) => panelIds.has(item.i));
    }
    const settings = template.settings
      ? Object.fromEntries(Object.entries(template.settings).filter(([id]) => KNOWN.has(id)))
      : undefined;
    return { ...template, panels, layouts, ...(settings && { settings }) };
  });
  const active = templates.some((template) => template.id === config.active) ? config.active : templates[0].id;
  return { active, templates, ...(config.offered && { offered: config.offered }) };
}

/** Null until saved once: the frontend then builds the first templates from the older widget and layout choices. */
export async function getDashboardConfig(userId: string): Promise<DashboardConfig | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dashboardTemplates: true } });
  const parsed = storedConfigSchema.safeParse(user?.dashboardTemplates);
  return parsed.success ? cleanConfig(parsed.data) : null;
}

/** Saved whole: the frontend holds the full config and sends it after each change. */
export async function setDashboardConfig(userId: string, config: DashboardConfig): Promise<DashboardConfig> {
  const saved = cleanConfig(config);
  await prisma.user.update({ where: { id: userId }, data: { dashboardTemplates: saved } });
  return saved;
}
