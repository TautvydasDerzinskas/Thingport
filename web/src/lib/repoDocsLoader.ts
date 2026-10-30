import { glob, type Loader } from "astro/loaders";
import { BRANCH, DOCS, REPO_URL } from "./site.mjs";

type SourcedDoc = (typeof DOCS)[number] & { source: string };

const sourced = DOCS.filter((d): d is SourcedDoc => Boolean(d.source));
const bySource = new Map(sourced.map((d) => [d.source, d]));
const byId = new Map(sourced.map((d) => [`docs/${d.slug}`, d]));

/**
 * Starlight's docs collection, read from the repo's own Markdown (DOCS in site.mjs) so the pages can't drift from
 * GitHub. Those files have no frontmatter, so each page's title, description and GitHub link come from DOCS. An id
 * of `docs/<slug>` serves the page at /docs/<slug>/.
 */
export function repoDocsLoader(): Loader {
  const files = glob({
    base: "..",
    pattern: sourced.map((d) => d.source),
    generateId: ({ entry }) => `docs/${bySource.get(entry)?.slug ?? entry}`,
  });
  return {
    name: "thingport-repo-docs",
    load: (context) =>
      files.load({
        ...context,
        parseData: (entry) => {
          const doc = byId.get(entry.id);
          const data = doc && {
            title: doc.title,
            description: doc.description,
            editUrl: `${REPO_URL}/blob/${BRANCH}/${doc.source}`,
          };
          return context.parseData({ ...entry, data: { ...data, ...entry.data } });
        },
      }),
  };
}
