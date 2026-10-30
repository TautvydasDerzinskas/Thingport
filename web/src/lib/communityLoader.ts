import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { imageMetadata } from "astro/assets/utils";
import { glob, type Loader } from "astro/loaders";
import { z } from "astro/zod";
import { COMMUNITY_KINDS, offered } from "./communityCatalog.mjs";
import { REPO_ROOT } from "./repoImages.mjs";

const exists = (repoPath: string) => existsSync(path.join(REPO_ROOT, repoPath));

// Where the app's icon catalog (frontend/src/components/IconPicker/iconCatalog.ts) has each group's pictures, by the
// name in `builtin:<group>/<name>`. Provider logos are the docs' tiles, made from the same logos and named by the
// docs' slug, which is the provider's id for nearly all of them.
const BUILTIN_ICONS: Record<string, (name: string) => string[]> = {
  thingport: (name) => [
    `frontend/src/assets/icons/${name}.svg`,
    `frontend/src/assets/logos/thingport-${name}-color.svg`,
    `frontend/src/assets/logos/thingport-${name}.svg`,
  ],
  services: (name) => [
    `frontend/src/assets/service-icons/${name}.svg`,
    `frontend/src/assets/service-icons/${name}.webp`,
  ],
  ai: (name) => [`frontend/src/assets/ai-logos/${name}.svg`],
  browsers: (name) => [`frontend/src/assets/logos/browsers/${name}.svg`],
  providers: (name) => [`docs/assets/providers/${name}.svg`],
};

/** An icon the site can show: an SVG written into the metadata as it is, or the repo file of one of Thingport's own.
 *  An uploaded icon is only on its author's Thingport, and an address on the web isn't the site's to show. */
function iconOf(iconUrl: unknown): string | null {
  if (typeof iconUrl !== "string") return null;
  const value = iconUrl.trim();
  if (/^data:image\//i.test(value)) return value;
  const builtin = /^builtin:([a-z]+)\/([a-z0-9-]+)$/.exec(value);
  return (builtin && BUILTIN_ICONS[builtin[1]]?.(builtin[2]).find(exists)) || null;
}

/** What the gallery works out from the folder, beside what the metadata says. */
async function siteFields(dir: string, data: Record<string, unknown>) {
  const shots = Array.isArray(data.screenshots) ? data.screenshots : [];
  return {
    dir,
    icon: iconOf(data.iconUrl),
    // Their sizes, so the page keeps their room while they load.
    screenshots: await Promise.all(
      shots.map(async (shot: { file?: unknown }) => {
        const repoPath = path.posix.join(dir, String(shot?.file ?? "").trim());
        const image = await readFile(path.join(REPO_ROOT, repoPath)).catch(() => null);
        if (!image) throw new Error(`${dir} lists the screenshot ${repoPath}, which isn't in the repo`);
        const { width, height } = await imageMetadata(image, repoPath);
        return { path: repoPath, width, height };
      }),
    ),
  };
}

// Only what the gallery shows, with the app's defaults, and never stricter than the app: the metadata is checked when
// it's merged (backend/scripts/validateCommunityWidgets.ts and validateTools.ts).
const shared = {
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
  version: z.string().trim().default("1.0.0"),
  author: z.string().trim().optional(),
  authorUrl: z.string().trim().optional(),
  hosts: z.array(z.string().trim().toLowerCase()).default([]),
  locales: z.array(z.string().trim()).default([]),
  screenshots: z.array(z.object({ file: z.string().trim(), caption: z.string().trim().optional() })).default([]),
  site: z.object({
    dir: z.string(),
    /** A data URL, or a repo path; null for the kind's own icon, as the app shows one without an icon. */
    icon: z.string().nullable(),
    screenshots: z.array(z.object({ path: z.string(), width: z.number(), height: z.number() })),
  }),
};
const SCHEMAS = {
  widgets: z.object(shared),
  tools: z.object({
    ...shared,
    window: z.object({ width: z.number(), height: z.number() }).default({ width: 960, height: 640 }),
    category: z.string().optional(),
    collection: z
      .object({
        name: z.string().trim(),
        models: z.array(z.object({ files: z.array(z.string()).optional(), source: z.string().optional() })),
      })
      .optional(),
  }),
};

/**
 * The widgets or the tools Thingport offers (communityCatalog.mjs), as a collection of their metadata, by folder name.
 * The repo is read here rather than when the pages are built, whose bundled code has lost track of where it is.
 */
export function communityLoader<K extends keyof typeof COMMUNITY_KINDS>(
  kind: K,
): Loader & { schema: (typeof SCHEMAS)[K] } {
  const items = new Map(offered(kind).map((item) => [item.slug, item]));
  const files = glob({
    base: "..",
    pattern: [...items.values()].map((item) => item.metadata),
    generateId: ({ entry }) => entry.split("/")[1],
  });
  return {
    name: `thingport-community-${kind}`,
    schema: SCHEMAS[kind],
    load: (context) =>
      files.load({
        ...context,
        parseData: async (entry) => {
          const site = await siteFields(items.get(entry.id)!.dir, entry.data);
          return context.parseData({ ...entry, data: { ...entry.data, site } });
        },
      }),
  };
}
