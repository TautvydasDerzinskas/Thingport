import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobItem } from "../../api/imports";
import type { ImportQueueValue } from "./ImportQueueContext";
import JobCard, { JobCardSkeletons, LinkRow } from "./JobCard";
import { isInLine, linksVersion, ownerName, type RawQueueJob } from "./queueView";
import { MINUTE, NOW, ago, renderQueue, testJob, testQueue, textOf } from "./testing";

const holder = vi.hoisted(() => ({ queue: null as unknown }));

vi.mock("./ImportQueueContext", () => ({ useImportQueue: () => holder.queue }));

// A closed menu renders nothing without a DOM, and what's in it is the point here.
vi.mock("@mui/material/Menu", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-menu="">{children}</div>,
}));

function card(fields: Partial<RawQueueJob> = {}, queue: Partial<ImportQueueValue> = {}, theme?: "light" | "dark") {
  holder.queue = testQueue(queue);
  return renderQueue(<JobCard job={testJob(fields)} />, theme);
}

const textOfCard = (fields: Partial<RawQueueJob> = {}, queue: Partial<ImportQueueValue> = {}) =>
  textOf(card(fields, queue));

const everyone = {
  dialog: { open: true, section: "wait", scope: "everyone", person: null },
} satisfies Partial<ImportQueueValue>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobCard, for focus to come back to", () => {
  it("marks itself, as somewhere focus can land, and its primary button", () => {
    const html = card({ id: "j7", status: "PAUSED", queued_at: null, can_start: true });
    expect(html).toMatch(/<article[^>]*data-queue-card="j7"/);
    expect(html).toMatch(/<article[^>]*tabindex="-1"/);
    expect(html).toMatch(/<button[^>]*data-queue-primary=""[^>]*>(?:(?!<\/button>).)*Start/s);
  });

  it("has no primary mark when there's nothing to press", () => {
    expect(card({ status: "PAUSED", runner_live: true })).not.toContain("data-queue-primary");
  });
});

describe("JobCard, by state", () => {
  it("running links: a chip, Pause, the bar and the links", () => {
    const html = card({
      status: "RUNNING",
      runner_live: true,
      total: 40,
      processed: 23,
      failed_count: 1,
      failed_items_count: 1,
      can_pause: true,
      started_at: ago(12 * MINUTE),
    });
    const text = textOf(html);
    expect(text).toContain("Workshop bits");
    expect(text).toContain("Started 12 minutes ago");
    expect(text).toContain("Importing");
    expect(text).toContain("Pause");
    expect(text).toContain("23 of 40, 1 failed");
    expect(text).toContain("Show 40 links");
    expect(html).toContain('title="Importing now."');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="57"');
    expect(html).toContain('aria-label="23 of 40, 1 failed"');
    expect(html).toContain('aria-label="Pause after the current link"');
  });

  it("colours the bar by how it's going", () => {
    const running = { status: "RUNNING", total: 4, processed: 1 } as const;
    expect(card(running)).toContain("MuiLinearProgress-colorPrimary");
    expect(card({ ...running, failed_count: 1 })).toContain("MuiLinearProgress-colorWarning");
    expect(card({ status: "ERROR", total: 4, processed: 1 })).toContain("MuiLinearProgress-colorError");
  });

  it("turns its button off while its request is on the way", () => {
    const job = { id: "busy", status: "QUEUED", can_pause: true } as const;
    const pressed = (html: string) => /<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Hold/s.test(html);
    expect(pressed(card(job))).toBe(false);
    expect(pressed(card(job, { busy: new Set(["busy"]) }))).toBe(true);
  });

  it("running links with no total yet: a moving bar, no numbers", () => {
    const html = card({ status: "RUNNING", total: 0, processed: 0 });
    expect(html).toContain("MuiLinearProgress-indeterminate");
    expect(textOf(html)).not.toContain("0 of 0");
  });

  it("running anything else: nothing to press", () => {
    const text = textOfCard({ type: "ZIP", status: "RUNNING", total: 3, processed: 1, source_label: "minis.zip" });
    expect(text).toContain("Importing");
    expect(text).not.toContain("Pause");
    expect(text).not.toContain("Show");
  });

  it("in line: its place, Hold, and how far off", () => {
    const html = card({ status: "QUEUED", position: 3, can_pause: true });
    const text = textOf(html);
    expect(html).toContain('aria-label="Workshop bits"');
    expect(text).toContain("#3");
    expect(html).toContain('title="#3 in line"');
    expect(text).toContain("In line");
    expect(text).toContain("Hold");
    expect(text).toContain("2 imports ahead · 8 links");
    expect(html).not.toContain('role="progressbar"');
  });

  it("next up says so", () => {
    const html = card({ status: "QUEUED", position: 1, total: 1, single: true, can_pause: true });
    expect(html).toContain('title="Next up"');
    expect(textOf(html)).toContain("Next up · 1 model");
  });

  it("on hold: Start", () => {
    const text = textOfCard({ status: "PAUSED", can_start: true, queued_at: null });
    expect(text).toContain("On hold");
    expect(text).toContain("Start");
    expect(text).not.toContain("Hold ");
  });

  it("pausing: nothing to start until the link it's on has finished", () => {
    const html = card({ status: "PAUSED", runner_live: true, can_start: false });
    expect(textOf(html)).toContain("Pausing");
    expect(textOf(html)).not.toMatch(/\bStart\b/);
    expect(html).toContain("Finishing the link it&#x27;s on, then it stops.");
  });

  it("failed: the reason, and Retry with how many", () => {
    const text = textOfCard({
      status: "ERROR",
      attention: true,
      failed_count: 3,
      failed_items_count: 3,
      can_retry: true,
      failure_reason: "3 links: daily download limit reached on Thangs.",
    });
    expect(text).toContain("Error");
    expect(text).toContain("Retry 3");
    expect(text).toContain("3 links: daily download limit reached on Thangs.");
  });

  it("a failed ZIP can't be retried", () => {
    const text = textOfCard({
      type: "ZIP",
      status: "ERROR",
      attention: true,
      source_label: "terrain.zip",
      failure_reason: "Import interrupted. Some models or files may already be in your library; check before retrying.",
    });
    expect(text).not.toContain("Retry");
    expect(text).toContain("Start a new import with only the missing files.");
  });

  it("some failed: says so, with a plain Retry for one", () => {
    const text = textOfCard({
      status: "DONE",
      attention: true,
      total: 2,
      processed: 2,
      failed_count: 1,
      failed_items_count: 1,
      can_retry: true,
    });
    expect(text).toContain("Some failed");
    expect(text).toMatch(/Retry (?!\d)/);
    expect(text).toContain("1 link failed. Open the links to see why.");
  });

  it("done: nothing to press", () => {
    const text = textOfCard({ status: "DONE", total: 2, processed: 2 });
    expect(text).toContain("Done");
    expect(text).not.toMatch(/Retry|Start|Hold|Pause/);
  });
});

describe("JobCard, by kind", () => {
  it("a single link has no bar and no links, and no Pause while it runs", () => {
    const html = card({ status: "RUNNING", single: true, total: 1, processed: 0 });
    const text = textOf(html);
    expect(text).toContain("Single link");
    expect(text).not.toContain("Show");
    expect(text).not.toContain("Pause");
    expect(html).not.toContain('role="progressbar"');
  });

  it("names print profiles, and leaves out a count it doesn't know yet", () => {
    const text = textOfCard({ type: "PROFILES", status: "QUEUED", position: 2, total: 0 });
    expect(text).toContain("Print profiles");
    expect(text).toContain("1 import ahead");
    expect(text).not.toContain("0 models");
  });

  it("marks a sync job, and explains the mark", () => {
    const html = card({ status: "RUNNING", collection_sync_id: "s1", total: 90, processed: 11 });
    expect(textOf(html)).toContain("SYNC");
    expect(html).toContain('title="Synced collections run alongside the line, so they never hold it up"');
  });

  it("a sync job waiting on its lane has no place, only a promise and why", () => {
    const html = card({ status: "PAUSED", collection_sync_id: "s1", sync_waiting: true, can_pause: true });
    const text = textOf(html);
    expect(text).toContain("In line");
    expect(text).toContain("Hold");
    expect(text).toContain("Starts by itself when its turn comes.");
    expect(text).not.toMatch(/#\d/);
    expect(html).toContain('aria-label="Synced collections run one at a time beside the line');
  });

  it("uses the provider's logo where there is one, and a plain tile otherwise", () => {
    const logo = card({ provider: "printables" });
    const plain = card({ provider: null, source_url: "https://example.com/a" });
    expect(logo).not.toContain('data-testid="LinkIcon"');
    expect(plain).toContain('data-testid="LinkIcon"');
    expect(card({ type: "ZIP", source_url: "https://example.com/a.zip" })).toContain("FolderZipOutlinedIcon");
  });
});

describe("JobCard, whose it is", () => {
  const owner = { id: "u2", display_name: "Sam Okafor", email: "sam@example.com" };

  it("shows its owner in everyone's list", () => {
    const text = textOfCard({ owner }, everyone);
    expect(text).toContain("SO");
    expect(text).toContain("Sam Okafor ·");
  });

  it("not in one's own", () => {
    expect(textOfCard({ owner })).not.toContain("Sam Okafor");
  });

  it("stands out in one's own line, not in everyone's", () => {
    const own = card({ status: "QUEUED", position: 1 });
    const theirs = card({ status: "QUEUED", position: 1 }, everyone);
    const gradient = "linear-gradient";
    expect(own).toContain(gradient);
    expect(theirs).not.toContain(gradient);
  });
});

describe("JobCard's menu", () => {
  const delivered = { status: "DONE", total: 1, processed: 1, can_delete: true } as const;

  it("opens the source, and offers delete after a divider", () => {
    const html = card({ ...delivered, source_url: "https://example.com/a" });
    expect(html).toContain('aria-label="More actions for Workshop bits"');
    expect(textOf(html)).toContain("Open source Delete import");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<hr");
  });

  it("opens the model of a finished single link", () => {
    const text = textOfCard({ ...delivered, single: true, result_print_id: "p1" });
    expect(text).toContain("Open model");
    expect(text).not.toContain("Open source");
  });

  it("opens the collection of a finished list", () => {
    expect(textOfCard({ ...delivered, type: "COLLECTION", result_collection_id: "c1" })).toContain("Open collection");
  });

  it("someone else's model isn't the viewer's to open", () => {
    const owner = { id: "u2", display_name: "Sam", email: "sam@example.com" };
    const text = textOfCard({ ...delivered, owner, single: true, result_print_id: "p1" }, everyone);
    expect(text).toContain("Open source");
    expect(text).not.toContain("Open model");
  });

  it("has no delete while it runs, and no divider either", () => {
    const html = card({ status: "RUNNING", can_delete: false });
    expect(textOf(html)).toContain("Open source");
    expect(textOf(html)).not.toContain("Delete import");
    expect(html).not.toContain("<hr");
  });

  it("isn't there at all with nothing to offer", () => {
    const html = card({ status: "RUNNING", source_url: "", can_delete: false });
    expect(html).not.toContain("More actions for");
    expect(html).not.toContain("data-menu");
  });
});

describe("what the card works out", () => {
  const base = { status: "RUNNING", processed: 1, pending_count: 2, running_count: 1, done_count: 1 } as const;

  it.each([
    ["status", { status: "PAUSED" }],
    ["updated_at", { updated_at: ago(0) }],
    ["processed", { processed: 2 }],
    ["pending_count", { pending_count: 1 }],
    ["running_count", { running_count: 0 }],
    ["done_count", { done_count: 2 }],
    ["failed_items_count", { failed_items_count: 1 }],
  ] as const)("reads a job's links again when %s changes", (_field, change) => {
    expect(linksVersion(testJob({ ...base, ...change }))).not.toBe(linksVersion(testJob(base)));
  });

  it("doesn't read them again when nothing about them changed", () => {
    expect(linksVersion(testJob({ ...base, position: 4 }))).toBe(linksVersion(testJob({ ...base, position: 3 })));
  });

  it("counts a sync job waiting on its lane as in line", () => {
    expect(isInLine(testJob({ status: "QUEUED" }))).toBe(true);
    expect(isInLine(testJob({ status: "PAUSED", sync_waiting: true }))).toBe(true);
    expect(isInLine(testJob({ status: "PAUSED" }))).toBe(false);
    expect(isInLine(testJob({ status: "RUNNING" }))).toBe(false);
  });

  it("finds a name for an owner with whatever they have", () => {
    expect(ownerName({ id: "u", display_name: "Mia", email: "m@example.com" })).toBe("Mia");
    expect(ownerName({ id: "u", display_name: "", email: "m@example.com" })).toBe("m@example.com");
    expect(ownerName({ id: "u", display_name: "", email: "" })).toBe("u");
  });
});

describe("JobCard with what it doesn't expect", () => {
  it("survives a status and a type this build doesn't know", () => {
    const text = textOfCard({
      status: "SOMETHING_NEW" as never,
      type: "BRAND_NEW" as never,
      can_delete: true,
    });
    expect(text).toContain("Unknown");
    expect(text).toContain("Workshop bits");
  });

  it("survives a row with almost nothing in it", () => {
    holder.queue = testQueue();
    const text = textOf(renderQueue(<JobCard job={testJob({ source_url: undefined, source_label: undefined })} />));
    expect(text).toContain("Untitled import");
  });

  it("renders in the dark theme too", () => {
    const html = card({ status: "ERROR", attention: true, can_retry: true, failure_reason: "Nope" }, {}, "dark");
    expect(textOf(html)).toContain("Nope");
  });
});

describe("JobCardSkeletons", () => {
  it("draws three placeholder cards, hidden from screen readers", () => {
    holder.queue = testQueue();
    const html = renderQueue(<JobCardSkeletons />);
    expect(html).toContain('aria-hidden="true"');
    expect(html.split("MuiSkeleton-rounded").length - 1).toBe(6);
    expect(textOf(html)).toBe("");
  });
});

describe("LinkRow", () => {
  const item = (fields: Partial<ImportJobItem> = {}): ImportJobItem => ({
    id: "i1",
    url: "https://example.com/a",
    status: "PENDING",
    attempts: 0,
    error_message: null,
    title: "Bit holder",
    collection_id: null,
    scope: null,
    ...fields,
  });

  const row = (fields: Partial<ImportJobItem> = {}, jobFields: Partial<RawQueueJob> = { status: "PAUSED" }) => {
    holder.queue = testQueue();
    return renderQueue(<LinkRow job={testJob(jobFields)} item={item(fields)} />);
  };

  it("shows title, link and its status in words", () => {
    const html = row();
    expect(textOf(html)).toContain("Bit holder");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("<title>waiting</title>");
  });

  it.each([
    ["RUNNING", "importing", "AutorenewIcon"],
    ["FAILED", "failed", "ErrorIcon"],
    ["DONE", "imported", "CheckCircleIcon"],
    ["PENDING", "waiting", "AccessTimeIcon"],
  ] as const)("marks %s", (status, words, icon) => {
    const html = row({ status }, { status: "RUNNING" });
    expect(html).toContain(`<title>${words}</title>`);
    expect(html).toContain(`data-testid="${icon}"`);
  });

  it.each(["ERROR", "PAUSED", "QUEUED"] as const)("doesn't spin a link cut off on a job that's %s", (status) => {
    const html = row({ status: "RUNNING" }, { status });
    expect(html).toContain("<title>cut off</title>");
    expect(html).toContain('data-testid="WarningAmberIcon"');
    expect(html).not.toContain('data-testid="AutorenewIcon"');
  });

  it("still spins while the job is pausing, as that link is really going", () => {
    const html = row({ status: "RUNNING" }, { status: "PAUSED", runner_live: true });
    expect(html).toContain('data-testid="AutorenewIcon"');
  });

  it("copes with a status it doesn't know", () => {
    expect(row({ status: "NEW" as never })).toContain('data-testid="AccessTimeIcon"');
  });

  it("never turns another kind of URL into a link", () => {
    const html = row({ url: "javascript:alert(1)" });
    expect(html).not.toContain("href=");
    expect(textOf(html)).toContain("javascript:alert(1)");
  });

  it("does without a title", () => {
    // "waiting" is its status icon's name.
    expect(textOf(row({ title: null }))).toBe("waiting https://example.com/a");
  });

  it("says which profiles and what went wrong", () => {
    const text = textOf(row({ scope: "designer", error_message: "Sign-in expired." }));
    expect(text).toContain("All designer print profiles");
    expect(text).toContain("Sign-in expired.");
  });

  it("can be removed while nothing runs, unless it's done", () => {
    expect(row()).toContain('aria-label="Remove link"');
    expect(row({ status: "FAILED" })).toContain('aria-label="Remove link"');
    expect(row({ status: "DONE" })).not.toContain('aria-label="Remove link"');
  });

  it("can't be removed from a running job, or one still finishing a link", () => {
    expect(row({}, { status: "RUNNING" })).not.toContain('aria-label="Remove link"');
    expect(row({}, { status: "PAUSED", runner_live: true })).not.toContain('aria-label="Remove link"');
  });
});
