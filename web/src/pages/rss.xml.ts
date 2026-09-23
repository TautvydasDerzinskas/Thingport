import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { SITE_NAME } from "../lib/site.mjs";
import { url } from "../lib/url";

export async function GET(context: APIContext) {
  const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  return rss({
    title: `${SITE_NAME} blog`,
    description: "Release notes, guides and news from the Thingport project.",
    site: new URL(url(), context.site),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      categories: post.data.tags,
      link: url(`blog/${post.id}/`),
    })),
    customData: "<language>en</language>",
  });
}
