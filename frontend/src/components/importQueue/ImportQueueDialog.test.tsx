import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineOut } from "../../api/imports";
import type { ImportQueueValue } from "./ImportQueueContext";
import ImportQueueDialog from "./ImportQueueDialog";
import LineRow from "./LineRow";
import { personAvatar } from "./personAvatar";
import type { QueueSection } from "./queueView";
import { MINUTE, NOW, ago, renderQueue, testJob, testQueue, textOf } from "./testing";

const holder = vi.hoisted(() => ({ queue: null as unknown, toast: null as { key: number; message: string } | null }));

vi.mock("./ImportQueueContext", () => ({ useImportQueue: () => holder.queue }));
vi.mock("../ToastProvider", () => ({ useCurrentToast: () => holder.toast }));

// The real one renders into a portal, which needs a DOM.
vi.mock("@mui/material/Dialog", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <dialog open>{children}</dialog> : null,
}));

const MIA = { id: "mia", display_name: "Mia Chen", email: "mia@example.com" };
const SAM = { id: "sam", display_name: "Sam Okafor", email: "sam@example.com" };

const dialogState = (section: QueueSection, scope: "mine" | "everyone" = "mine", person: string | null = null) => ({
  open: true,
  section,
  scope,
  person,
});

function render(queue: Partial<ImportQueueValue> = {}, isAdmin = false) {
  holder.queue = testQueue(queue);
  return renderQueue(<ImportQueueDialog isAdmin={isAdmin} />);
}

const rendered = (queue: Partial<ImportQueueValue> = {}, isAdmin = false) => textOf(render(queue, isAdmin));

const running = testJob({
  id: "r",
  status: "RUNNING",
  source_label: "Running one",
  total: 4,
  processed: 1,
  can_pause: true,
});
const held = testJob({ id: "h", status: "PAUSED", source_label: "Held one", queued_at: null, can_start: true });
const inLine = testJob({ id: "q", status: "QUEUED", source_label: "Waiting one", position: 2, can_pause: true });
const failed = testJob({
  id: "f",
  status: "ERROR",
  source_label: "Failed one",
  attention: true,
  can_retry: true,
  failure_reason: "It broke",
});
const finished = testJob({
  id: "d",
  status: "DONE",
  source_label: "Finished one",
  total: 2,
  processed: 2,
  can_delete: true,
});
const own = [running, held, inLine, failed, finished];

const everyoneJobs = [
  testJob({ id: "a", owner: MIA, status: "RUNNING", source_label: "Mia running", can_pause: true }),
  testJob({ id: "b", owner: SAM, status: "QUEUED", source_label: "Sam second", position: 2, can_pause: true }),
  testJob({ id: "c", owner: MIA, status: "QUEUED", source_label: "Mia first", position: 1, can_pause: true }),
  testJob({ id: "e", owner: SAM, status: "DONE", source_label: "Sam done", total: 2, processed: 2 }),
];
const everyone = {
  jobs: everyoneJobs,
  olderBackend: false,
  finishedTotal: 0,
  finishedByOwner: {},
  loading: false,
  failed: false,
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  holder.toast = null;
});

describe("ImportQueueDialog's shell", () => {
  it("renders nothing while closed", () => {
    expect(render({ dialog: { ...dialogState("run"), open: false } })).not.toContain("<dialog");
    expect(render()).toContain("<dialog");
  });

  it("is the import queue for one's own, the server's for everyone's", () => {
    expect(rendered()).toContain("Import queue");
    expect(rendered({ dialog: dialogState("run", "everyone") }, true)).toContain("Server import queue");
  });

  it("says how many are importing, in the list showing", () => {
    expect(rendered({ jobs: own })).toContain("1 importing now");
    expect(rendered({ jobs: [held] })).not.toContain("importing now");
    expect(rendered({ everyone, dialog: dialogState("run", "everyone") }, true)).toContain("1 importing now");
    expect(rendered({ everyone, dialog: dialogState("run", "everyone", "sam") }, true)).not.toContain("importing now");
  });

  it("has the cog for everyone, members included", () => {
    const html = render();
    expect(html).toContain('aria-label="Queue settings"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("names the rail", () => {
    expect(render()).toContain('aria-label="Queue sections"');
  });

  describe("for screen readers, which a modal dialog keeps from the toast", () => {
    const echo = /<output[^>]*aria-live="polite"[^>]*>(.*?)<\/output>/s;

    it("says the toast on screen again", () => {
      holder.toast = { key: 1, message: "Cleared 2 finished imports." };
      expect(render().match(echo)?.[1]).toBe("<span>Cleared 2 finished imports.</span>");
    });

    it("waits, ready, while there's none", () => {
      expect(render().match(echo)?.[1]).toBe("");
    });

    it("is gone with the dialog, so the toast's own alert speaks alone", () => {
      holder.toast = { key: 1, message: "Cleared 2 finished imports." };
      expect(render({ dialog: { ...dialogState("run"), open: false } })).not.toContain("<output");
    });
  });
});

describe("ImportQueueDialog's rail", () => {
  it("lists the four sections with their counts, zero included", () => {
    const text = rendered({ jobs: own, dialog: dialogState("run") });
    expect(text).toContain("Importing 1 Needs attention 1 Waiting 2 Finished 1");
    expect(rendered()).toContain("Importing 0 Needs attention 0 Waiting 0 Finished 0");
  });

  it("is not a single grouped list: only the chosen section's cards show", () => {
    const text = rendered({ jobs: own, dialog: dialogState("att") });
    expect(text).toContain("Failed one");
    expect(text).not.toContain("Running one");
    expect(text).not.toContain("Held one");
    expect(text).not.toContain("Finished one");
  });

  it("counts every finished import, not only those listed", () => {
    expect(rendered({ jobs: [finished], finishedTotal: 120 })).toContain("Finished 120");
  });

  it("keeps one's own total out of everyone's", () => {
    const text = rendered({ everyone, finishedTotal: 120, dialog: dialogState("run", "everyone") }, true);
    expect(text).toContain("Finished 1");
    expect(text).not.toContain("Finished 120");
  });

  describe("on everyone's, with the server's totals", () => {
    const totals = { ...everyone, finishedTotal: 1400, finishedByOwner: { sam: 300, mia: 1100 } };

    it("counts every finished import, on the rail and the button", () => {
      const text = rendered({ everyone: totals, dialog: dialogState("done", "everyone") }, true);
      expect(text).toContain("Finished 1400");
      expect(text).toContain("Clear finished (1400)");
    });

    it("counts one person's when they're picked", () => {
      const text = rendered({ everyone: totals, dialog: dialogState("done", "everyone", "sam") }, true);
      expect(text).toContain("Finished 300");
      expect(text).toContain("Clear finished (300)");
    });

    it("falls back to the list on a backend that doesn't say", () => {
      const text = rendered({ everyone, dialog: dialogState("done", "everyone") }, true);
      expect(text).toContain("Clear finished (1)");
      expect(rendered({ everyone, dialog: dialogState("done", "everyone", "sam") }, true)).toContain(
        "Clear finished (1)",
      );
    });

    it("says how far the list goes", () => {
      const text = rendered({ everyone: totals, dialog: dialogState("done", "everyone") }, true);
      expect(text).toContain("Showing the newest 1 of 1400");
    });

    it("has more to say than 'nothing finished' when all of someone's are too old to list", () => {
      const text = rendered({ everyone: totals, dialog: dialogState("done", "everyone", "mia") }, true);
      expect(text).toContain("Clear finished (1100)");
      expect(text).toContain("1100 older imports aren't listed here");
      expect(text).not.toContain("Nothing finished yet");
    });
  });

  it("offers Mine and Everyone to admins only", () => {
    expect(render({}, true)).toContain('aria-label="Whose imports"');
    expect(render({}, true)).toContain('role="group"');
    expect(render()).not.toContain('aria-label="Whose imports"');
  });

  it("lists people in Everyone only, with all of each person's imports", () => {
    expect(rendered({ everyone }, true)).not.toContain("People");
    const text = rendered({ everyone, dialog: dialogState("run", "everyone") }, true);
    expect(text).toContain("People Everyone 4 MC Mia Chen 2 SO Sam Okafor 2");
    // On phones it's a select.
    expect(text).toContain("Everyone · 4");
  });

  it("keeps people's counts when one person is picked, while the sections follow them", () => {
    const text = rendered({ everyone, dialog: dialogState("wait", "everyone", "sam") }, true);
    expect(text).toContain("Importing 0 Needs attention 0 Waiting 1 Finished 1");
    expect(text).toContain("People Everyone 4 MC Mia Chen 2 SO Sam Okafor 2");
  });

  it("shows no people until they've loaded", () => {
    const loading = { ...everyone, jobs: [], loading: true };
    expect(rendered({ everyone: loading, dialog: dialogState("run", "everyone") }, true)).not.toContain("People");
  });

  it("doesn't send people's email anywhere: their avatars are initials", () => {
    const html = render({ everyone, dialog: dialogState("run", "everyone") }, true);
    expect(html).not.toContain("gravatar");
    expect(html).toContain("Mia Chen · mia@example.com");
  });
});

describe("ImportQueueDialog's panels", () => {
  it.each([
    ["run", "What's running now, live."],
    ["att", "Failed or cut off, with what to do next."],
    ["wait", "One import runs at a time, in order. Other people's imports stay private."],
    ["done", "Imports that have finished."],
  ] as const)("titles %s", (section, subtitle) => {
    expect(rendered({ dialog: dialogState(section) })).toContain(subtitle);
  });

  it("explains Waiting differently for the whole server", () => {
    expect(rendered({ dialog: dialogState("wait", "everyone") }, true)).toContain(
      "One import runs at a time for the whole server, in order.",
    );
  });

  it.each([
    ["run", "Pause all"],
    ["att", "Retry all (1)"],
    ["wait", "Start all on hold (1)"],
    ["done", "Clear finished (1)"],
  ] as const)("offers %s its action", (section, action) => {
    expect(rendered({ jobs: own, dialog: dialogState(section) })).toContain(action);
  });

  it("offers no action for an empty section", () => {
    const text = rendered({ dialog: dialogState("done") });
    expect(text).not.toContain("Clear finished");
  });

  it("says when Finished lists only the newest, and not while it lists them all", () => {
    expect(rendered({ jobs: [finished], finishedTotal: 312, dialog: dialogState("done") })).toContain(
      "Showing the newest 1 of 312",
    );
    expect(rendered({ jobs: [finished], finishedTotal: 1, dialog: dialogState("done") })).not.toContain("Showing");
    expect(rendered({ jobs: [finished], finishedTotal: 312, dialog: dialogState("run") })).not.toContain("Showing");
  });

  it("doesn't speak of the list while it's still loading", () => {
    const text = rendered({ loading: true, finishedTotal: 312, dialog: dialogState("done") });
    expect(text).not.toContain("Showing");
    expect(text).not.toContain("older");
  });

  it("has a heading focus can land on when its action leaves nothing else", () => {
    const html = render({ jobs: own, dialog: dialogState("done") });
    expect(html).toMatch(
      /<div[^>]*data-queue-heading=""[^>]*tabindex="-1"[^>]*>|<div[^>]*tabindex="-1"[^>]*data-queue-heading=""/,
    );
    expect(render({ dialog: dialogState("done") })).toContain("data-queue-heading");
  });

  it("turns an action off when it has nothing to act on, but keeps it", () => {
    const html = render({ jobs: [testJob({ type: "ZIP", status: "RUNNING" })], dialog: dialogState("run") });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Pause all/s);
  });

  it("turns off an action on its way", () => {
    const html = render({ jobs: own, dialog: dialogState("done"), busy: new Set(["clearFinished"]) });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Clear finished/s);
  });

  it.each([
    ["run", "Nothing importing", "Imports show their progress here while they run."],
    ["att", "All clear", "Failed and interrupted imports land here."],
    ["wait", "Nothing waiting", "stay on hold until you start them."],
    ["done", "Nothing finished yet", "Completed imports stay here until you clear them."],
  ] as const)("has an empty state for %s", (section, title, text) => {
    const shown = rendered({ dialog: dialogState(section) });
    expect(shown).toContain(title);
    expect(shown).toContain(text);
  });

  it("doesn't tell someone whose Grab links start by themselves that they stay on hold", () => {
    const text = rendered({ startGrabLinks: true, dialog: dialogState("wait") });
    expect(text).toContain("New imports wait here for their turn.");
    expect(text).not.toContain("stay on hold");
  });

  it("says when someone else's import is what's holding things up", () => {
    const line: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 1 };
    const nothing = rendered({ line, dialog: dialogState("run") });
    expect(nothing).toContain("Another import is running");
    expect(nothing).toContain("Imports run one at a time.");
    const waiting = rendered({ line, jobs: [inLine], dialog: dialogState("run") });
    expect(waiting).toContain("Your next import is #2 in line, and starts by itself.");
  });

  it("not to an admin looking at everyone's", () => {
    const line: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 1 };
    expect(rendered({ line, dialog: dialogState("run", "everyone") }, true)).toContain("Nothing importing");
  });

  it("shows skeletons while loading, and neither empty state nor action", () => {
    const html = render({ loading: true, dialog: dialogState("wait") });
    expect(html).toContain("MuiSkeleton-root");
    expect(textOf(html)).not.toContain("Nothing waiting");
    expect(textOf(html)).not.toContain("Start all");
  });

  it("waits for everyone's list on its own", () => {
    const loading = { ...everyone, jobs: [], loading: true };
    expect(render({ everyone: loading, dialog: dialogState("wait", "everyone") }, true)).toContain("MuiSkeleton-root");
  });

  it("says it can't load, rather than that there's nothing", () => {
    const text = rendered({ failed: true, dialog: dialogState("wait") });
    expect(text).toContain("Unable to load the import queue.");
    expect(text).toContain("Retry");
    expect(text).not.toContain("Nothing waiting");
  });

  it("keeps what it had when a later read fails", () => {
    const text = rendered({ failed: true, jobs: own, dialog: dialogState("att") });
    expect(text).toContain("Unable to load the import queue.");
    expect(text).toContain("Failed one");
  });

  it("minds everyone's read when looking at everyone's", () => {
    const broken = { ...everyone, jobs: [], failed: true };
    const text = rendered({ everyone: broken, dialog: dialogState("wait", "everyone") }, true);
    expect(text).toContain("Unable to load the import queue.");
    expect(rendered({ everyone, failed: true, dialog: dialogState("run", "everyone") }, true)).not.toContain(
      "Unable to load",
    );
  });
});

describe("ImportQueueDialog's Waiting", () => {
  const line: LineOut = {
    now: { mine: false, person: "p-noor", job_id: null },
    rows: [
      { position: 1, mine: false, person: "p-noor", job_id: null },
      { position: 2, mine: false, person: "p-noor", job_id: null },
      { position: 3, mine: true, person: "p-me", job_id: "q3" },
      { position: 4, mine: false, person: "p-sam", job_id: null },
      { position: 5, mine: true, person: "p-me", job_id: "q5" },
    ],
    length: 9,
  };
  const third = testJob({ id: "q3", source_label: "Plant pot", position: 3, can_pause: true });
  const fifth = testJob({ id: "q5", source_label: "Workshop bits", position: 5, can_pause: true });

  it("joins the rungs with a line in Mine, and only there", () => {
    const rail = "left:28px";
    expect(render({ jobs: [third, fifth], line, dialog: dialogState("wait") })).toContain(rail);
    expect(render({ everyone, line, dialog: dialogState("wait", "everyone") }, true)).not.toContain(rail);
    expect(render({ jobs: [third, fifth], line, dialog: dialogState("run") })).not.toContain(rail);
  });

  it("climbs the ladder in Mine: what's on, the others private, nothing past the viewer's last", () => {
    const html = render({ jobs: [third, fifth], line, dialog: dialogState("wait") });
    const text = textOf(html);
    expect(text).toContain("In line · 2");
    expect(text).toContain("Your number only goes down");
    const order = [
      "Now",
      "Private import",
      "#1-2",
      "2 private imports",
      "#3",
      "Plant pot",
      "#4",
      "#5",
      "Workshop bits",
    ];
    for (const part of order) expect(text).toContain(part);
    expect(text.indexOf("#1-2")).toBeLessThan(text.indexOf("#3"));
    expect(text.indexOf("#3")).toBeLessThan(text.indexOf("#4"));
    expect(text.indexOf("#4")).toBeLessThan(text.indexOf("#5"));
    expect(text).not.toContain("#6");
    expect(text).not.toContain("#9");
  });

  it("offers nothing on a private row", () => {
    const html = render({ jobs: [third, fifth], line, dialog: dialogState("wait") });
    // The viewer's two cards, and nothing on the rows between them.
    expect(html.split('aria-label="More actions for').length - 1).toBe(2);
    expect(textOf(html).match(/Hold/g)).toHaveLength(2);
  });

  it("names the viewer's own import when it's the one running", () => {
    const mineNow: LineOut = { ...line, now: { mine: true, person: "p-me", job_id: "r" } };
    const text = rendered({ jobs: [running, third], line: mineNow, dialog: dialogState("wait") });
    expect(text).toContain("Your import: Running one");
  });

  it("has no ladder for someone with nothing in line", () => {
    const text = rendered({ jobs: [held], line: { ...line, rows: [] }, dialog: dialogState("wait") });
    expect(text).not.toContain("Private import");
    expect(text).not.toContain("In line");
    expect(text).toContain("On hold · 1");
    expect(text).toContain("Won't run until started");
  });

  it("says when new Grab links skip the hold", () => {
    expect(rendered({ jobs: [held], startGrabLinks: true, dialog: dialogState("wait") })).toContain(
      "New Grab links skip this",
    );
  });

  it("is plain cards in place order in Everyone, with owners and no private rows", () => {
    const text = rendered({ everyone, line, dialog: dialogState("wait", "everyone") }, true);
    expect(text).toContain("In line · 2");
    expect(text).toContain("Start by themselves");
    expect(text).not.toContain("Private import");
    expect(text.indexOf("Mia first")).toBeLessThan(text.indexOf("Sam second"));
    expect(text).toContain("Mia Chen ·");
    expect(text).toContain("Sam Okafor ·");
  });

  it("keeps places as they are when one person is picked", () => {
    const text = rendered({ everyone, dialog: dialogState("wait", "everyone", "sam") }, true);
    expect(text).toContain("#2");
    expect(text).not.toContain("Mia first");
  });
});

describe("LineRow", () => {
  const privateRow = (from: number, to: number) => ({ kind: "private", key: "k", person: "p", from, to }) as const;

  it("says only where and that it's private", () => {
    holder.queue = testQueue();
    expect(textOf(renderQueue(<LineRow row={privateRow(4, 4)} />))).toBe("#4 Private import In line");
    expect(textOf(renderQueue(<LineRow row={privateRow(1, 3)} />))).toBe("#1-3 3 private imports In line");
  });

  it("marks someone by a generated shape, the same one every time", () => {
    holder.queue = testQueue();
    const paths = (html: string) => html.match(/<path d="[^"]+"/g);
    const a = renderQueue(<LineRow row={privateRow(1, 1)} />);
    const b = renderQueue(<LineRow row={privateRow(7, 7)} />);
    expect(paths(a)).toEqual(paths(b));
    expect(a).toContain(personAvatar("p").path);
    expect(a).toContain(`fill:${personAvatar("p").foreground}`);
  });

  it("tells people apart", () => {
    holder.queue = testQueue();
    const other = ["q", "r", "s", "t", "u"].find((key) => personAvatar(key).path !== personAvatar("p").path) as string;
    const theirs = renderQueue(<LineRow row={{ ...privateRow(2, 2), person: other }} />);
    expect(theirs).toContain(personAvatar(other).path);
    expect(theirs).not.toContain(personAvatar("p").path);
  });

  it("says Now for the import on, pulsing", () => {
    holder.queue = testQueue();
    const row = { kind: "now", key: "now", mine: false, person: "p", job: null } as const;
    expect(textOf(renderQueue(<LineRow row={row} />))).toBe("Now Private import Importing");
  });

  it("uses the viewer's own mark on their own import", () => {
    holder.queue = testQueue();
    const row = {
      kind: "now",
      key: "now",
      mine: true,
      person: "p",
      job: testJob({ source_label: "Mine", started_at: ago(MINUTE) }),
    } as const;
    const html = renderQueue(<LineRow row={row} />);
    expect(textOf(html)).toBe("Now Your import: Mine Importing");
    expect(html).toContain('data-testid="PersonIcon"');
  });
});

describe("ImportQueueDialog on a backend older than the line", () => {
  const older = { ...everyone, olderBackend: true };

  it("has only everyone's list to offer an admin: no Mine, no cog", () => {
    const html = render({ supported: false, everyone: older, dialog: dialogState("wait", "everyone") }, true);
    expect(html).not.toContain('aria-label="Whose imports"');
    expect(html).not.toContain('aria-label="Queue settings"');
    expect(textOf(html)).toContain("Server import queue");
    expect(textOf(html)).toContain("Mia first");
  });

  it("leaves a member an empty list, which doesn't break", () => {
    const text = rendered({ supported: false, dialog: dialogState("wait") });
    expect(text).toContain("Nothing waiting");
  });

  it("offers no bulk action on one person: that backend would apply it to everyone", () => {
    const rows = { ...older, jobs: [testJob({ id: "z", owner: SAM, status: "PAUSED", can_start: true })] };
    expect(
      rendered({ supported: false, everyone: rows, dialog: dialogState("wait", "everyone", "sam") }, true),
    ).not.toContain("Start all");
    expect(rendered({ supported: false, everyone: rows, dialog: dialogState("wait", "everyone") }, true)).toContain(
      "Start all on hold (1)",
    );
  });
});
