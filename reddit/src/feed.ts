// Reads thingport.net's RSS feed (web/src/pages/rss.xml.ts) and picks what to post. Kept free of Devvit imports so
// it's tested on its own.

// GitHub Pages serves the site on www.thingport.net and redirects thingport.net to it. Devvit fetches only the exact
// hosts devvit.json lists, and it lists www.thingport.net alone.
export const FEED_URL = "https://www.thingport.net/rss.xml";
// Only posts published this recently are posted, so installing the app doesn't post the whole blog, and a post the
// app missed while it was off isn't posted weeks late.
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
// Reddit's title limit.
const MAX_TITLE = 300;

export type FeedEntry = { title: string; link: string; description: string; published: Date };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  if (cdata) return cdata[1].trim();
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      // fromCodePoint throws past the last code point, which would fail every run until the feed changed.
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .trim();
}

function field(item: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(item);
  return match ? decode(match[1]) : "";
}

/** The feed's entries, newest first. One without a title, an https link or a date is left out. */
export function parseFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const [, item] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const title = field(item, "title");
    const link = field(item, "link");
    const published = new Date(field(item, "pubDate"));
    if (!title || !/^https:\/\//.test(link) || Number.isNaN(published.valueOf())) continue;
    entries.push({ title, link, description: field(item, "description"), published });
  }
  return entries.sort((a, b) => b.published.valueOf() - a.published.valueOf());
}

/** The entries to post now, oldest first: published within RECENT_MS, not dated in the future, and not posted yet. */
export function toPost(entries: FeedEntry[], posted: (link: string) => boolean, now = new Date()): FeedEntry[] {
  return entries
    .filter((e) => e.published <= now && now.valueOf() - e.published.valueOf() <= RECENT_MS && !posted(e.link))
    .sort((a, b) => a.published.valueOf() - b.published.valueOf());
}

export type PostKind = "link" | "text";

/** What reddit.submitPost takes for an entry, apart from the subreddit. */
export function submission(
  entry: FeedEntry,
  kind: PostKind,
): { title: string; url: string } | { title: string; text: string } {
  const title = entry.title.length > MAX_TITLE ? `${entry.title.slice(0, MAX_TITLE - 1)}…` : entry.title;
  if (kind === "link") return { title, url: entry.link };
  const text = [entry.description, `**[Read the post on thingport.net](${entry.link})**`].filter(Boolean).join("\n\n");
  return { title, text };
}
