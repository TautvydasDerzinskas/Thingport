import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { DOCS } from "./lib/site.mjs";

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

// Rendered straight from the repo's own Markdown (see DOCS in lib/site.mjs), keyed by site slug.
const sourced = DOCS.filter((d): d is (typeof DOCS)[number] & { source: string } => Boolean(d.source));
const docs = defineCollection({
  loader: glob({
    base: "..",
    pattern: sourced.map((d) => d.source),
    generateId: ({ entry }) => sourced.find((d) => d.source === entry)?.slug ?? entry,
  }),
});

export const collections = { blog, docs };
