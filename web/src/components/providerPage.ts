// What the parts of a provider's docs page share: its data, its links into the other docs, and how its text is set.
import { getEntry, render } from "astro:content";
import { PROVIDER_COMPARISON, PROVIDER_PAGES } from "../lib/providers.generated.mjs";
import { DOCS } from "../lib/site.mjs";
import { url } from "../lib/url";

/** A provider's page data (PROVIDER_PAGES) by its docsSlug, with its name and its row of the comparison table. */
export const providerPage = (slug: string) => {
  const page = PROVIDER_PAGES.find((p) => p.docsSlug === slug);
  const row = PROVIDER_COMPARISON.rows.find((r) => r.docsSlug === slug);
  if (!page || !row) throw new Error(`No provider data for ${slug}: run npm run providers:sync`);
  // It goes into a style attribute.
  if (!/^#[0-9a-f]{6}$/i.test(page.accent)) throw new Error(`${slug}'s accent ${page.accent} isn't a #rrggbb colour`);
  return { ...page, name: row.name, row };
};

/** Curled as the docs' Markdown sets the same text: opening quotes after a space, the rest closing quotes and
 *  apostrophes. */
export const curly = (text: string) =>
  text
    .replace(/(^|[\s(])'/g, "$1‘")
    .replace(/'/g, "’")
    .replace(/(^|[\s(])"/g, "$1“")
    .replace(/"/g, "”");

/**
 * A link into the docs as the providers' data writes it, "<slug>" or "<slug>#<heading id>": its URL, the page's nav
 * label and, for a heading, its text. A page that isn't in DOCS, or a heading its Markdown doesn't have, fails the
 * build rather than leave a link to nowhere. `from` names the link in that error.
 */
export async function docsLink(link: string, from: string) {
  const [slug, anchor] = link.split("#");
  const doc = DOCS.find((d) => d.slug === slug);
  if (!doc) throw new Error(`${from} links to docs/${slug}/, which isn't in DOCS`);
  let section: string | undefined;
  if (anchor) {
    // Only Markdown pages have their headings to hand; the docs' own Astro pages have none to check against.
    const entry = doc.source ? await getEntry("docs", `docs/${slug}`) : undefined;
    if (!entry) throw new Error(`${from} links to #${anchor} on docs/${slug}/, which has no Markdown to check it in`);
    const { headings } = await render(entry);
    section = headings.find((heading) => heading.slug === anchor)?.text;
    if (!section) throw new Error(`${from} links to docs/${slug}/#${anchor}, a heading that page doesn't have`);
  }
  return { href: url(`docs/${slug}/${anchor ? `#${anchor}` : ""}`), page: doc.nav, section };
}
