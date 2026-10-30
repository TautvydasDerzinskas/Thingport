import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./repoImages.mjs";

/** Each kind's folder in the repo, its list in that folder's index.json, and the name of its files. */
export const COMMUNITY_KINDS = {
  widgets: { folder: "community-widgets", list: "widgets", file: "widget" },
  tools: { folder: "tools", list: "tools", file: "tool" },
};

// As the app checks a folder's name (backend/src/services/customWidgetFormat.ts).
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

const exists = (/** @type {string} */ repoPath) => existsSync(path.join(REPO_ROOT, repoPath));

// Read once a build: each collection asks, and a folder that's left out is reported once.
/** @type {Map<string, { slug: string, dir: string, metadata: string, readme: string | null }[]>} */
const offeredByKind = new Map();

/**
 * The widgets or tools Thingport offers to install, found the way the app finds them
 * (backend/src/services/customWidgetsService.ts and toolsService.ts): the folders index.json lists, in its order,
 * leaving out any without its metadata (JSON, else YAML) and its script. The gallery (pages/community/) shows these.
 * @param {keyof typeof COMMUNITY_KINDS} kind
 */
export function offered(kind) {
  const cached = offeredByKind.get(kind);
  if (cached) return cached;
  const { folder, list, file } = COMMUNITY_KINDS[kind];
  const indexPath = `${folder}/index.json`;
  let index = {};
  if (exists(indexPath)) {
    try {
      index = JSON.parse(readFileSync(path.join(REPO_ROOT, indexPath), "utf8"));
    } catch (error) {
      throw new Error(`${indexPath} isn't valid JSON: ${error instanceof Error ? error.message : error}`);
    }
  }
  const listed = /** @type {Record<string, unknown>} */ (index)[list];
  const slugs = Array.isArray(listed) ? listed.filter((slug) => typeof slug === "string" && SLUG.test(slug)) : [];
  const items = [...new Set(slugs)].flatMap((slug) => {
    const dir = `${folder}/${slug}`;
    const metadata = [`${dir}/${file}.json`, `${dir}/${file}.yml`].find(exists);
    if (!metadata || !exists(`${dir}/${file}.js`)) {
      console.warn(
        `${indexPath} lists "${slug}", which Thingport leaves out: it needs ${file}.json or .yml and ${file}.js`,
      );
      return [];
    }
    return [{ slug, dir, metadata, readme: exists(`${dir}/README.md`) ? `${dir}/README.md` : null }];
  });
  offeredByKind.set(kind, items);
  return items;
}

/** Each gallery page by the repo folder and README it shows, so links to them from the docs can stay on the site. */
export function communityRoutesBySource() {
  return Object.fromEntries(
    /** @type {(keyof typeof COMMUNITY_KINDS)[]} */ (Object.keys(COMMUNITY_KINDS)).flatMap((kind) =>
      offered(kind).flatMap(({ slug, dir }) => {
        const route = `community/${kind}/${slug}/`;
        return [
          [dir, route],
          [`${dir}/README.md`, route],
        ];
      }),
    ),
  );
}
