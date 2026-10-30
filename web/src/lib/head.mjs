// What every page's <head> shares, on the site's own pages (layouts/BaseLayout.astro) and in the docs (Starlight's
// `head` in astro.config.mjs, and components/starlight/Head.astro) alike.

import { LINKS, SITE_DESCRIPTION, SITE_NAME } from "./site.mjs";
import { THEME_COLORS } from "./theme.mjs";

/**
 * The tags every page has besides its own (title, description, share tags), as Starlight's `head` takes them.
 * Starlight writes the others the site's pages have, such as the charset and the sitemap link, itself.
 * @param {string} home the home page's absolute URL, base path included
 * @returns {{ tag: "meta" | "link"; attrs: Record<string, string> }[]}
 */
export function siteHead(home) {
  const path = (/** @type {string} */ file) => new URL(file, home).pathname;
  return [
    // Google Search Console ownership verification; keep it, or the property becomes unverified.
    {
      tag: "meta",
      attrs: { name: "google-site-verification", content: "y4GVVvIBxmNQEKnAO3zzxa-eARxy0kimDkY0uIiSyHc" },
    },
    { tag: "meta", attrs: { name: "theme-color", content: THEME_COLORS.light } },
    { tag: "meta", attrs: { property: "og:locale", content: "en_US" } },
    { tag: "link", attrs: { rel: "icon", href: path("favicon.ico"), sizes: "48x48" } },
    { tag: "link", attrs: { rel: "icon", type: "image/svg+xml", href: path("favicon.svg") } },
    { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "96x96", href: path("favicon-96x96.png") } },
    { tag: "link", attrs: { rel: "apple-touch-icon", sizes: "180x180", href: path("apple-touch-icon.png") } },
    { tag: "link", attrs: { rel: "manifest", href: path("site.webmanifest") } },
    {
      tag: "link",
      attrs: {
        rel: "alternate",
        type: "application/rss+xml",
        title: "Thingport blog",
        href: new URL("rss.xml", home).href,
      },
    },
    { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    // "" renders a bare crossorigin; true would render crossorigin="true", which isn't a valid value.
    { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" } },
    {
      tag: "link",
      attrs: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap",
      },
    },
  ];
}

/**
 * A page's structured data (schema.org), as JSON-LD: the site and the organization behind it, then the page's own.
 * @param {string} home the home page's absolute URL, base path included
 * @param {Record<string, unknown>[]} nodes
 */
export function structuredData(home, nodes = []) {
  const site = {
    "@type": "WebSite",
    "@id": `${home}#website`,
    url: home,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": `${home}#organization` },
  };
  const organization = {
    "@type": "Organization",
    "@id": `${home}#organization`,
    name: SITE_NAME,
    url: home,
    logo: new URL("icon-512x512.png", home).href,
    sameAs: [LINKS.github],
  };
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [site, organization, ...nodes] });
}
