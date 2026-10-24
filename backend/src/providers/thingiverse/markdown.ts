import { absoluteHttpUrl, tidy } from "../../services/descriptionMarkdown";
import { decodeHtmlEntities } from "../../utils/htmlEntities";

/** Thingiverse descriptions are Markdown already, but older ones mix in a little HTML. HTML
 *  parsing would collapse the Markdown's line breaks, so the common tags are mapped by hand. */
export function cleanThingiverseMarkdown(text: string): string | null {
  if (!/<\/?[a-z][^>]*>/i.test(text)) return tidy(text);
  const converted = decodeHtmlEntities(
    text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, (_match, src: string) => {
        const url = absoluteHttpUrl(src);
        return url ? `![](${url})` : "";
      })
      .replace(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
        const url = absoluteHttpUrl(href);
        return url ? `[${label.replace(/<[^>]+>/g, "").trim() || url}](${url})` : label;
      })
      .replace(/<\/?(strong|b)>/gi, "**")
      .replace(/<\/?(em|i)>/gi, "*")
      .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );
  return tidy(converted);
}
