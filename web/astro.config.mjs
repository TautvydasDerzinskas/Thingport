// @ts-check
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { unified } from "@astrojs/markdown-remark";
import { siteHead } from "./src/lib/head.mjs";
import { rehypeRepoLinks } from "./src/lib/rehypeRepoLinks.mjs";
import { rehypeTableHeaders } from "./src/lib/rehypeTableHeaders.mjs";
import { remarkDropTitle } from "./src/lib/remarkDropTitle.mjs";
import { repoImages } from "./src/lib/repoImages.mjs";
import { remarkGithubAlerts } from "./src/lib/remarkGithubAlerts.mjs";
import { DOCS, DOCS_SIDEBAR, SITE_DESCRIPTION, SITE_NAME } from "./src/lib/site.mjs";

// SITE_URL and BASE_PATH override the custom domain, e.g.
// SITE_URL=https://tautvydasderzinskas.github.io BASE_PATH=/Thingport for a project-path build.
const site = process.env.SITE_URL || "https://thingport.net";
const base = process.env.BASE_PATH || "/";
const home = new URL(base.replace(/\/?$/, "/"), site).href;
// The folders the docs' Markdown is in (src/lib/repoDocsLoader.ts), outside src/content/docs/, for Starlight to
// process. Not the repo root, which would take in the blog: rehypeRepoLinks.mjs links the headings of the docs there,
// and remarkGithubAlerts.mjs refuses their alerts.
const docsDirs = new Set(DOCS.flatMap(({ source }) => (source?.includes("/") ? [`../${source.split("/")[0]}/`] : [])));

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [
    // Only /docs/ is Starlight's; the home page, the feature tour and the blog are the site's own pages.
    starlight({
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      titleDelimiter: "·",
      disable404Route: true,
      sidebar: DOCS_SIDEBAR,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      markdown: { processedDirs: [...docsDirs] },
      customCss: ["./src/styles/tokens.css", "./src/styles/starlight.css"],
      routeMiddleware: "./src/lib/routeData.ts",
      components: {
        EditLink: "./src/components/starlight/EditLink.astro",
        Footer: "./src/components/starlight/Footer.astro",
        Head: "./src/components/starlight/Head.astro",
        Header: "./src/components/starlight/Header.astro",
        MarkdownContent: "./src/components/starlight/MarkdownContent.astro",
        MobileMenuFooter: "./src/components/starlight/MobileMenuFooter.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
        Sidebar: "./src/components/starlight/Sidebar.astro",
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
      },
      // The same as BaseLayout.astro's; per-page tags are added in src/components/starlight/Head.astro.
      head: siteHead(home),
    }),
    sitemap({ filter: (page) => !page.endsWith("/404/") }),
    {
      name: "build-checks",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          // Search Console and crawlers try /sitemap.xml first; the integration only writes sitemap-index.xml.
          await copyFile(new URL("sitemap-index.xml", dir), new URL("sitemap.xml", dir));
          // A docs page whose Markdown moved or was renamed would otherwise just vanish from the site.
          const routes = ["docs/", ...DOCS.map((d) => `docs/${d.slug}/`)];
          const missing = routes.filter((route) => !existsSync(new URL(`${route}index.html`, dir)));
          if (missing.length) throw new Error(`Docs pages missing from the build: ${missing.join(", ")}`);
          // Starlight renders its pages dark, for its script (starlight/ThemeProvider.astro) to set the theme: without
          // JavaScript the docs would stay dark while the rest of the site is light.
          for (const route of routes) {
            const file = new URL(`${route}index.html`, dir);
            const html = await readFile(file, "utf8");
            const light = html.replace(/(<html\b[^>]*?) data-theme="dark"/, '$1 data-theme="light"');
            if (light === html) {
              throw new Error(
                `Starlight no longer renders ${route} as <html data-theme="dark">: check its theme without JavaScript`,
              );
            }
            await writeFile(file, light);
          }
        },
      },
    },
    // The images the Markdown shows, at repo/<path>: copied into the build, and served from the repo in dev.
    repoImages(),
  ],
  markdown: {
    // The unified pipeline, needed for these plugins. Code blocks are Expressive Code's (ec.config.mjs).
    processor: unified({
      remarkPlugins: [remarkDropTitle, remarkGithubAlerts],
      rehypePlugins: [[rehypeRepoLinks, { base }], rehypeTableHeaders],
    }),
  },
  // Docs, logos and screenshots are used from elsewhere in the repo. Favicons must be real files,
  // since search engines ignore data: URIs.
  vite: { server: { fs: { allow: [".."] } }, build: { assetsInlineLimit: 0 } },
});
