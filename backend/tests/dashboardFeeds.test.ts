import { afterEach, describe, expect, it } from "vitest";
import { checkUrls, getFeeds, isWebUrl, parseFeed, setFeedsFetchForTest } from "../src/services/dashboardFeedsService";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Maker news</title>
  <item><title>Older post</title><link>https://example.com/old</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item>
  <item><title>Newer post</title><link>https://example.com/new</link><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate></item>
  <item><title>Sneaky</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Printer blog</title>
  <entry><title>Firmware 2.0</title><link rel="alternate" href="https://blog.example.com/fw2"/><updated>2024-01-03T08:00:00Z</updated></entry>
</feed>`;

const respond = (body: string, status = 200) => new Response(body, { status });

afterEach(() => setFeedsFetchForTest());

describe("parseFeed", () => {
  it("reads RSS, newest first, and drops links that aren't web addresses", () => {
    const feed = parseFeed(RSS, "https://example.com/feed");
    expect(feed.title).toBe("Maker news");
    expect(feed.items.map((item) => item.title)).toEqual(["Newer post", "Older post", "Sneaky"]);
    expect(feed.items[0]).toMatchObject({ link: "https://example.com/new", feed: "Maker news" });
    expect(feed.items[2].link).toBeNull();
  });

  it("reads Atom", () => {
    const feed = parseFeed(ATOM, "https://blog.example.com/atom");
    expect(feed.items).toEqual([
      {
        title: "Firmware 2.0",
        link: "https://blog.example.com/fw2",
        published: "2024-01-03T08:00:00.000Z",
        feed: "Printer blog",
      },
    ]);
  });
});

describe("getFeeds", () => {
  it("merges feeds newest first and names the ones that failed", async () => {
    setFeedsFetchForTest(async (input) => {
      const url = String(input);
      if (url.includes("rss")) return respond(RSS);
      if (url.includes("atom")) return respond(ATOM);
      return respond("gone", 404);
    });
    const result = await getFeeds(["https://a.example/rss", "https://b.example/atom", "https://c.example/missing"]);
    expect(result.items.map((item) => item.title).slice(0, 2)).toEqual(["Firmware 2.0", "Newer post"]);
    expect(result.failed).toEqual(["https://c.example/missing"]);
  });
});

describe("checkUrls", () => {
  it("counts any answer below a server error as up, and no answer as down", async () => {
    setFeedsFetchForTest(async (input) => {
      const url = String(input);
      if (url.includes("login")) return respond("", 401);
      if (url.includes("broken")) return respond("", 503);
      throw new Error("ECONNREFUSED");
    });
    const results = await checkUrls(["http://nas.local/login", "http://printer.local/broken", "http://gone.local"]);
    expect(results.map((result) => [result.up, result.status])).toEqual([
      [true, 401],
      [false, 503],
      [false, null],
    ]);
  });
});

describe("isWebUrl", () => {
  it("takes only http and https", () => {
    expect(isWebUrl("http://192.168.1.10:8080")).toBe(true);
    expect(isWebUrl("https://example.com/feed.xml")).toBe(true);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });
});
