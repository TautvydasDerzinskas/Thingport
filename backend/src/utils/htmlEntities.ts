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

/** The text of HTML such as an ActivityPub `content`: tags dropped, entities read, line breaks and paragraphs kept. */
export function textOfHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]*>/g, ""),
  ).trim();
}
