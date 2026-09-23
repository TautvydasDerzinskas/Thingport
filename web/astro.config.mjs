// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { unified } from "@astrojs/markdown-remark";
import { rehypeRepoLinks } from "./src/lib/rehypeRepoLinks.mjs";

// Defaults to the GitHub Pages project URL. For a custom domain, build with
// SITE_URL=https://thingport.example.com BASE_PATH=/ (and add public/CNAME).
const site = process.env.SITE_URL || "https://tautvydasderzinskas.github.io";
const base = process.env.BASE_PATH || "/Thingport";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [sitemap({ filter: (page) => !page.endsWith("/404/") })],
  markdown: {
    // Both themes are emitted as CSS variables; global.css picks one per colour scheme.
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false },
    // The unified (remark/rehype) pipeline, not Astro's default one, because of this plugin.
    processor: unified({ rehypePlugins: [[rehypeRepoLinks, { base }]] }),
  },
  // The docs, logos, fonts and screenshots live elsewhere in the repo and are used from there.
  // assetsInlineLimit 0: favicons must be real files (search engines ignore data: URI favicons).
  vite: { server: { fs: { allow: [".."] } }, build: { assetsInlineLimit: 0 } },
});
