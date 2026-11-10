import { describe, expect, it } from "vitest";
import { RECENT_MS, parseFeed, submission, toPost } from "./feed";

// The shape @astrojs/rss writes for web/src/pages/rss.xml.ts.
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Thingport blog</title>
<link>https://www.thingport.net/</link><language>en</language>
<item><title>Thingport 1.6.0: models that say more, &amp; instances that connect</title>
<link>https://www.thingport.net/blog/thingport-1-6-0/</link><guid isPermaLink="true">https://www.thingport.net/blog/thingport-1-6-0/</guid>
<description>Print profiles &lt;and&gt; licences &#8212; &#x201C;quoted&#x201D;.</description>
<pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate><category>release</category></item>
<item><title><![CDATA[Thingport 1.5.0: AI becomes the engine]]></title><link>https://www.thingport.net/blog/thingport-1-5-0/</link>
<description>Studio.</description><pubDate>Thu, 05 Nov 2026 00:00:00 GMT</pubDate></item>
<item><title>Introducing Thingport</title><link>https://www.thingport.net/blog/introducing-thingport/</link>
<pubDate>Sat, 18 Oct 2026 00:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://www.thingport.net/blog/no-date/</link></item>
<item><title>Plain http</title><link>http://www.thingport.net/blog/http/</link><pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

describe("the blog feed", () => {
  it("reads entries newest first, decoding entities and CDATA, and drops ones without a date or an https link", () => {
    const entries = parseFeed(FEED);
    expect(entries.map((e) => e.link)).toEqual([
      "https://www.thingport.net/blog/thingport-1-6-0/",
      "https://www.thingport.net/blog/thingport-1-5-0/",
      "https://www.thingport.net/blog/introducing-thingport/",
    ]);
    expect(entries[0].title).toBe("Thingport 1.6.0: models that say more, & instances that connect");
    expect(entries[0].description).toBe("Print profiles <and> licences — “quoted”.");
    expect(entries[1].title).toBe("Thingport 1.5.0: AI becomes the engine");
    expect(entries[2].description).toBe("");
  });

  it("keeps a numeric entity past the last code point as it's written, rather than failing the whole feed", () => {
    const xml = `<rss><channel><item><title>Big &#99999999; &#x110000; &#x1F600;</title>
<link>https://www.thingport.net/blog/x/</link><pubDate>Tue, 10 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(xml)[0].title).toBe("Big &#99999999; &#x110000; 😀");
  });

  it("posts only recent entries not posted yet, oldest first, and none dated ahead", () => {
    const entries = parseFeed(FEED);
    const now = new Date("2026-11-10T12:00:00Z");
    expect(toPost(entries, () => false, now).map((e) => e.title)).toEqual([
      "Thingport 1.5.0: AI becomes the engine",
      "Thingport 1.6.0: models that say more, & instances that connect",
    ]);
    const posted = (link: string) => link.endsWith("thingport-1-5-0/");
    expect(toPost(entries, posted, now).map((e) => e.link)).toEqual([
      "https://www.thingport.net/blog/thingport-1-6-0/",
    ]);
    // A post dated tomorrow waits for its day.
    expect(toPost(entries, () => false, new Date("2026-11-09T12:00:00Z")).map((e) => e.link)).toEqual([
      "https://www.thingport.net/blog/thingport-1-5-0/",
    ]);
    // Past the window, nothing is posted late.
    expect(toPost(entries, () => false, new Date(Date.parse("2026-11-10T00:00:00Z") + RECENT_MS + 1))).toEqual([]);
  });

  it("makes a link post, or a text post with the summary and a link", () => {
    const [entry] = parseFeed(FEED);
    expect(submission(entry, "link")).toEqual({ title: entry.title, url: entry.link });
    expect(submission(entry, "text")).toEqual({
      title: entry.title,
      text: `${entry.description}\n\n**[Read the post on thingport.net](${entry.link})**`,
    });
    const long = submission({ ...entry, title: "x".repeat(400) }, "link");
    expect(long.title).toHaveLength(300);
  });
});
