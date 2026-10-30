import { getCollection, getEntry, render, type CollectionEntry } from "astro:content";
import { COMMUNITY_KINDS } from "./communityCatalog.mjs";
import { REPO_IMAGES } from "./repoImages.mjs";
import { BRANCH, DOCS, REPO_URL } from "./site.mjs";
import { url } from "./url";
import en from "../../../frontend/src/i18n/locales/en.json";

export type Kind = keyof typeof COMMUNITY_KINDS;

export const KIND_NAMES: Record<Kind, string> = { widgets: "Dashboard widgets", tools: "Tools" };

export type Screenshot = { src: string; width: number; height: number; caption?: string };

export type CommunityItem = {
  kind: Kind;
  slug: string;
  /** Its folder in the repo. */
  dir: string;
  href: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  authorUrl?: string;
  /** An image address, or null for the kind's own icon. */
  icon: string | null;
  hosts: string[];
  languages: string[];
  screenshots: Screenshot[];
  readme?: CollectionEntry<"communityReadmes">;
  /** Its folder on GitHub. */
  source: string;
  // Tools only.
  shelf?: { id: string; label: string };
  window?: { width: number; height: number };
  models?: { count: number; collection: string; from: string[] };
};

// The order Thingport lists them in, read when the pages are built: the collections only know what's in each folder.
const INDEXES = import.meta.glob<Record<string, unknown>>("../../../{community-widgets,tools}/index.json", {
  eager: true,
  import: "default",
});
const orderOf = (kind: Kind): unknown[] => {
  const { folder, list } = COMMUNITY_KINDS[kind];
  const listed = INDEXES[`../../../${folder}/index.json`]?.[list];
  return Array.isArray(listed) ? listed : [];
};
/** Sorts by where each id is in `order`, anything missing from it last. */
const byPlaceIn = (order: unknown[]) => {
  const place = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return (a: string, b: string) => place(a) - place(b);
};

/** The Tools page's shelves, in its order and its words. */
const SHELVES: Record<string, string> = en.app.tools.categories;

const LANGUAGE_NAMES = new Intl.DisplayNames(["en-GB"], { type: "language" });
const languageName = (code: string) => {
  try {
    return LANGUAGE_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

const repoUrl = (repoPath: string) => url(REPO_IMAGES + encodeURI(repoPath));

/** The widgets or the tools Thingport offers, in its order, with what their pages show. */
export async function communityItems(kind: Kind): Promise<CommunityItem[]> {
  const entries: (CollectionEntry<"communityWidgets"> | CollectionEntry<"communityTools">)[] =
    kind === "widgets" ? await getCollection("communityWidgets") : await getCollection("communityTools");
  const readmes = new Map((await getCollection("communityReadmes")).map((entry) => [entry.id, entry]));
  const order = byPlaceIn(orderOf(kind));
  return [...entries]
    .sort((a, b) => order(a.id, b.id))
    .map(({ id: slug, data }) => {
      const { dir } = data.site;
      const item: CommunityItem = {
        kind,
        slug,
        dir,
        href: url(`community/${kind}/${slug}/`),
        name: data.name,
        description: data.description,
        version: data.version,
        author: data.author || undefined,
        authorUrl: data.authorUrl && /^https?:\/\//i.test(data.authorUrl) ? data.authorUrl : undefined,
        icon: data.site.icon && (data.site.icon.startsWith("data:") ? data.site.icon : repoUrl(data.site.icon)),
        hosts: data.hosts,
        languages: data.locales.map(languageName),
        screenshots: data.site.screenshots.map((shot, i) => ({
          src: repoUrl(shot.path),
          width: shot.width,
          height: shot.height,
          caption: data.screenshots[i]?.caption || undefined,
        })),
        readme: readmes.get(dir),
        source: `${REPO_URL}/tree/${BRANCH}/${dir}`,
      };
      if ("window" in data) {
        const shelf = data.category || "other";
        item.shelf = { id: shelf, label: SHELVES[shelf] ?? shelf[0].toUpperCase() + shelf.slice(1) };
        item.window = data.window;
        const models = data.collection?.models ?? [];
        if (data.collection && models.length) {
          const from = models.flatMap((model) => (model.source ? [new URL(model.source).hostname] : []));
          item.models = {
            count: models.length,
            collection: data.collection.name,
            from: [...new Set(from.map((host) => host.replace(/^www\./, "")))],
          };
        }
      }
      return item;
    });
}

/** Tools by shelf, in the Tools page's order, leaving out empty ones as it does. */
export function shelvesOf(tools: CommunityItem[]) {
  return [...new Set(tools.map((tool) => tool.shelf!.id))].sort(byPlaceIn(Object.keys(SHELVES))).map((id) => {
    const items = tools.filter((tool) => tool.shelf!.id === id);
    return { id, label: items[0].shelf!.label, items };
  });
}

/** A docs page's address, and a heading on it: one that's gone fails the build rather than leaving a dead link. */
export async function docsLink(slug: string, hash?: string): Promise<string> {
  if (!DOCS.some((doc) => doc.slug === slug)) {
    throw new Error(`The gallery links to docs/${slug}/, which isn't in DOCS`);
  }
  if (hash) {
    const entry = await getEntry("docs", `docs/${slug}`);
    const headings = entry ? (await render(entry)).headings : [];
    if (!headings.some((heading) => heading.slug === hash)) {
      throw new Error(`The gallery links to docs/${slug}/#${hash}, a heading that page doesn't have`);
    }
  }
  return url(`docs/${slug}/${hash ? `#${hash}` : ""}`);
}
