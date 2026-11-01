import { describe, expect, it } from "vitest";
import type { QueueImportResult } from "../../shared/api";
import { pausedHtml, queuedHtml } from "./results";

const INSTANCE = "http://192.168.1.20:8080";
const LINK = `href="${INSTANCE}/admin-queue"`;

function result(extra: Partial<QueueImportResult> = {}): QueueImportResult {
  return { job_id: "job1", item_id: "item1", duplicate: false, waiting: 2, ...extra };
}

/** The text as the panel shows it, entities read back. */
function shown(html: string): string {
  return html.replaceAll("&#39;", "'").replaceAll("&gt;", ">");
}

describe("queuedHtml", () => {
  describe("on an older instance", () => {
    it("says today's words, exactly", () => {
      const html = shown(queuedHtml(INSTANCE, result(), false));
      expect(html).toContain("Added to the queue");
      expect(html).toContain("Paused until it's started from Administration > Import queue (2 links waiting).");
      expect(html).toContain("Open import queue");
      expect(html).toContain(LINK);
    });

    it("counts one link as one", () => {
      expect(shown(queuedHtml(INSTANCE, result({ waiting: 1 }), false))).toContain(
        "Paused until it's started from Administration > Import queue (1 link waiting).",
      );
    });

    it("says today's words for a link already there", () => {
      const html = shown(queuedHtml(INSTANCE, result({ duplicate: true }), false));
      expect(html).toContain("Already in the queue");
      expect(html).toContain("This link was already waiting in the queue (2 links waiting).");
      expect(html).toContain(LINK);
    });
  });

  describe("on an instance with a queue of one's own", () => {
    it("reads an answer with no new fields as on hold", () => {
      const html = queuedHtml(INSTANCE, result(), true);
      expect(html).toContain("On hold in your import queue until you start it (2 links waiting).");
      expect(html).toContain("Added to the queue");
      expect(html).toContain(LINK);
    });

    it("says on hold when the instance does", () => {
      expect(queuedHtml(INSTANCE, result({ started: false, position: null }), true)).toContain(
        "On hold in your import queue until you start it",
      );
    });

    it.each([
      [1, "Next up in your import queue (2 links waiting)."],
      [3, "#3 in line in your import queue (2 links waiting)."],
      [null, "In line in your import queue (2 links waiting)."],
      [undefined, "In line in your import queue (2 links waiting)."],
    ])("says where it is in line at position %s", (position, text) => {
      expect(queuedHtml(INSTANCE, result({ started: true, position }), true)).toContain(text);
    });

    it("says the same of a link already there, under its own title", () => {
      const html = queuedHtml(INSTANCE, result({ duplicate: true, started: true, position: 2 }), true);
      expect(html).toContain("Already in the queue");
      expect(html).toContain("#2 in line in your import queue");
    });

    it("never names the admin page", () => {
      expect(shown(queuedHtml(INSTANCE, result(), true))).not.toContain("Administration");
    });
  });

  it("believes an answer that says it's in line, whatever Grab last heard about the instance", () => {
    const html = queuedHtml(INSTANCE, result({ started: true, position: 1 }), false);
    expect(html).toContain("Next up in your import queue");
    expect(shown(html)).not.toContain("Administration");
  });

  it("keeps a plain http instance's address as it is", () => {
    expect(queuedHtml("http://thingport.home.arpa", result(), true)).toContain(
      'href="http://thingport.home.arpa/admin-queue"',
    );
  });
});

describe("pausedHtml", () => {
  it("says it stopped and where it carries on, and never that it was imported", () => {
    const html = shown(pausedHtml(INSTANCE, "Imported 3 of 10 so far.", "Sync is on."));
    expect(html).toContain("Import paused");
    expect(html).toContain("Imported 3 of 10 so far. It continues from the import queue once it's started there.");
    expect(html).toContain("Sync is on.");
    expect(html).toContain(LINK);
    expect(html).toContain("Open import queue");
    expect(html).not.toContain("Imported!");
  });

  it("needs no progress to say so", () => {
    expect(shown(pausedHtml(INSTANCE))).toContain(">It continues from the import queue once it's started there.<");
  });
});
