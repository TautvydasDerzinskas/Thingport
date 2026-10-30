import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { PROVIDER_COMPARISON } from "./providers.generated.mjs";
import { GISCUS } from "./site.mjs";

/** What each provider's page has after its Markdown (components/starlight/MarkdownContent.astro), in order: each
 *  section's heading id and its entry in the page's table of contents. */
export const RELATED_HEADING = { id: "related", toc: "Related" };
export const COMPARISON_HEADING = { id: "compare-providers", toc: "Compare providers" };
export const NOTES_HEADING = { id: "notes-from-users", toc: "Notes from users" };
/** Where every other docs page ends, left out of the table of contents. */
export const FEEDBACK_HEADING = { id: "feedback", text: "Feedback" };

/** The docsSlug of the provider whose page a docs route is (id `docs/providers/<docsSlug>`); undefined on any other. */
export const providerOfRoute = (id: string) =>
  PROVIDER_COMPARISON.rows.find((row) => id === `docs/providers/${row.docsSlug}`)?.docsSlug;

export const onRequest = defineRouteMiddleware(({ locals: { starlightRoute: route } }) => {
  const provider = providerOfRoute(route.id);
  // The threads show only where their category is set (components/Comments.astro).
  const sections = provider
    ? [RELATED_HEADING, COMPARISON_HEADING, ...(GISCUS.categories.providers.id ? [NOTES_HEADING] : [])]
    : [];
  const feedback = !provider && route.id !== "docs" && GISCUS.categories.docs.id ? [FEEDBACK_HEADING] : [];

  // A heading of the page's own with the same id would take these sections' links.
  const ids = [...sections, ...feedback].map(({ id }) => id);
  const clash = route.headings.find((heading) => ids.includes(heading.slug));
  if (clash) throw new Error(`${route.id} has a heading "${clash.text}" with the id of a section the site adds`);

  // They aren't in the page's Markdown, so the table of contents doesn't know they're there.
  route.toc?.items.push(...sections.map(({ id, toc }) => ({ depth: 2, slug: id, text: toc, children: [] })));
});
