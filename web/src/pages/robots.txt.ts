import type { APIContext } from "astro";
import { url } from "../lib/url";

export function GET(context: APIContext) {
  const sitemap = new URL(url("sitemap-index.xml"), context.site);
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
