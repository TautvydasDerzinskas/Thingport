import * as cheerio from "cheerio";

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `value` safe as HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

/** Plain text as one paragraph of HTML, its line breaks kept: an ActivityPub `content`. */
export function paragraphOf(text: string): string {
  return `<p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`;
}

// Elements whose content stands apart from what's around it, a blank line between.
const BLOCKS =
  "p, div, li, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6, table, tr, section, article, header, footer";
// Where a block began or ended, until they're all made one blank line; no text has it.
const EDGE = "\u0001";

/** The text of HTML such as an ActivityPub `content`, read by a parser: every character reference decoded, scripts and
 *  styles dropped, a line break for each `<br>` and a blank line between blocks. */
export function textOfHtml(html: string): string {
  const $ = cheerio.load(html, null, false);
  $("script, style, template").remove();
  $("br").replaceWith("\n");
  $(BLOCKS).each((_, element) => {
    $(element).before(EDGE).after(EDGE);
  });
  return $.root()
    .text()
    .replace(new RegExp(`\\s*${EDGE}[\\s${EDGE}]*`, "g"), "\n\n")
    .trim();
}
