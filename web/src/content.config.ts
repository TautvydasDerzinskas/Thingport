import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { offered } from "./lib/communityCatalog.mjs";
import { communityLoader } from "./lib/communityLoader";
import { repoDocsLoader } from "./lib/repoDocsLoader";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default("Tautvydas Derzinskas"),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const docs = defineCollection({ loader: repoDocsLoader(), schema: docsSchema() });
// Starlight's own UI strings, where the site words them differently (src/content/i18n/en.json).
const i18n = defineCollection({ loader: i18nLoader(), schema: i18nSchema() });

// The widgets and tools Thingport offers, for the gallery at /community/: their metadata (lib/communityLoader.ts),
// and their READMEs by folder (`tools/<slug>`), through the site's Markdown pipeline like the docs.
const communityWidgets = defineCollection({ loader: communityLoader("widgets") });
const communityTools = defineCollection({ loader: communityLoader("tools") });
const communityReadmes = defineCollection({
  loader: glob({
    base: "..",
    pattern: [...offered("widgets"), ...offered("tools")].flatMap((item) => item.readme ?? []),
    generateId: ({ entry }) => entry.replace(/\/README\.md$/, ""),
  }),
});

export const collections = { blog, docs, i18n, communityWidgets, communityTools, communityReadmes };
