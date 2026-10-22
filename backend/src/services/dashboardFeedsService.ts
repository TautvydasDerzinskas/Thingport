// The dashboard's RSS panel and uptime monitors, read through the server: most feeds and services don't let a
// browser read them from another site. The user picks the URLs, and on a self-hosted dashboard they're often on the
// local network (a printer, a NAS), so private addresses are allowed; what's limited is the scheme, the time and the
// size.

import * as cheerio from "cheerio";
import { readCapped } from "../utils/readCapped";
import { TtlCache } from "../utils/ttlCache";

const USER_AGENT = "Thingport/1.0 (self-hosted dashboard; +https://github.com/TautvydasDerzinskas/Thingport)";
const FEED_TIMEOUT_MS = 10_000;
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const FEED_TTL_MS = 10 * 60 * 1000;
const FEED_MAX_ITEMS = 50;
const MONITOR_TIMEOUT_MS = 8_000;
// Often enough to notice something going down, without every open dashboard hammering it.
const MONITOR_TTL_MS = 30 * 1000;

export type FeedItem = { title: string; link: string | null; published: string | null; feed: string };
export type Feed = { title: string; items: FeedItem[] };
export type MonitorResult = { url: string; up: boolean; status: number | null; ms: number | null };

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Lets tests answer for the outside sites. */
export function setFeedsFetchForTest(impl?: typeof fetch): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
  feeds.clear();
  monitors.clear();
}

const feeds = new TtlCache<Feed>(FEED_TTL_MS);
const monitors = new TtlCache<MonitorResult>(MONITOR_TTL_MS);

/** Only http(s): no file:, data: or anything else a URL can name. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const text = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";

const isoDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** RSS 2.0, RSS 1.0 (RDF) and Atom, the newest first. */
export function parseFeed(xml: string, url: string): Feed {
  const $ = cheerio.load(xml, { xml: true });
  const atom = $("feed").length > 0;
  const title =
    text(atom ? $("feed > title").first().text() : $("channel > title").first().text()) || new URL(url).host;
  const entries = atom ? $("feed > entry") : $("item");
  const items = entries
    .toArray()
    .map((entry): FeedItem => {
      const node = $(entry);
      const link = atom
        ? (node.find('link[rel="alternate"]').attr("href") ?? node.find("link").first().attr("href") ?? null)
        : text(node.find("link").first().text()) || null;
      const date = text(
        atom
          ? node.find("published").first().text() || node.find("updated").first().text()
          : node.find("pubDate").first().text() || node.find("dc\\:date").first().text(),
      );
      return {
        title: text(node.find("title").first().text()) || link || title,
        link: link && isWebUrl(link) ? link : null,
        published: date ? isoDate(date) : null,
        feed: title,
      };
    })
    .toSorted((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
    .slice(0, FEED_MAX_ITEMS);
  return { title, items };
}

async function getFeed(url: string): Promise<Feed> {
  const cached = feeds.get(url);
  if (cached) return cached;
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
  const { buffer } = await readCapped(res, FEED_MAX_BYTES);
  const feed = parseFeed(buffer.toString("utf8"), url);
  feeds.set(url, feed);
  return feed;
}

/** Every feed's items together, newest first. A feed that can't be read is named in `failed` rather than failing
 *  the rest. */
export async function getFeeds(urls: string[]): Promise<{ items: FeedItem[]; failed: string[] }> {
  const results = await Promise.allSettled(urls.map(getFeed));
  const failed = urls.filter((_, index) => results[index].status === "rejected");
  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value.items : []))
    .toSorted((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
    .slice(0, FEED_MAX_ITEMS);
  return { items, failed };
}

/** Up when anything answers below a server error: a login page (401, 403) still means the service is running. */
async function checkUrl(url: string): Promise<MonitorResult> {
  const cached = monitors.get(url);
  if (cached) return cached;
  const started = performance.now();
  let result: MonitorResult;
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(MONITOR_TIMEOUT_MS),
    });
    // Only the status matters; the body is left unread.
    await res.body?.cancel().catch(() => undefined);
    result = { url, up: res.status < 500, status: res.status, ms: Math.round(performance.now() - started) };
  } catch {
    result = { url, up: false, status: null, ms: null };
  }
  monitors.set(url, result);
  return result;
}

export function checkUrls(urls: string[]): Promise<MonitorResult[]> {
  return Promise.all(urls.map(checkUrl));
}
