import { describe, expect, it, vi } from "vitest";
import type { ImportQueueValue } from "./ImportQueueContext";
import ImportQueueIndicator from "./ImportQueueIndicator";
import { indicatorState, type QueueJob } from "./queueView";
import { renderQueue, testJob, testQueue, textOf } from "./testing";

const holder = vi.hoisted(() => ({ queue: null as unknown }));

vi.mock("./ImportQueueContext", () => ({ useImportQueue: () => holder.queue }));

const TICK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
const TRAY = "M4 14h3.5l1.5 3h6l1.5-3H20v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5z";
const COMET = "conic-gradient";

function render(jobs: QueueJob[], { flash = false, theme = "light" as "light" | "dark", ...overrides } = {}) {
  holder.queue = testQueue({
    jobs,
    indicator: indicatorState(jobs, flash),
    ...(overrides as Partial<ImportQueueValue>),
  });
  return renderQueue(<ImportQueueIndicator />, theme);
}

const label = (html: string) => /aria-label="([^"]*)"/.exec(html)?.[1];

const running = testJob({ id: "r", status: "RUNNING", total: 8, processed: 2 });
const waiting = testJob({ id: "w", status: "QUEUED", position: 3 });
const failed = testJob({ id: "f", status: "ERROR", attention: true });
const held = testJob({ id: "h", status: "PAUSED" });
const sync = testJob({ id: "s", status: "RUNNING", collection_sync_id: "c1" });

describe("ImportQueueIndicator", () => {
  it("isn't there when the backend has no queue", () => {
    expect(render([], { supported: false } as never)).not.toContain("<button");
  });

  it("is an outlined button of the top bar's size, in a known state from the start", () => {
    const html = render([]);
    expect(html).toContain("<button");
    expect(html).toContain("width:32px");
    expect(html).toContain("height:32px");
    expect(label(html)).toBe("Import queue: Import queue is empty");
  });

  it("running: an arc for how far, the comet, what's still to come, and why it matters", () => {
    const html = render([running, waiting, failed]);
    expect(label(html)).toBe("Import queue: Importing, 25%. 1 in line. 1 needs attention");
    expect(html).toContain("stroke-dasharray:25 100");
    expect(html).toContain(COMET);
    expect(html).not.toContain(TRAY);
    expect(textOf(html)).toBe("2 1");
  });

  it("the comet is a ring: its mask ends transparent, or it would show as a square", () => {
    const html = render([running]);
    expect(html).toMatch(/mask:radial-gradient\(circle farthest-side,[^;]*transparent 100%\)/);
  });

  it("the comet is gone with reduced motion, and the ring stops easing", () => {
    const html = render([running]);
    expect(html).toMatch(/prefers-reduced-motion: ?reduce\)\{[^}]*display:none/);
    expect(html).toMatch(/prefers-reduced-motion: ?reduce\)\{[^}]*transition:none/);
  });

  it("in line, none running: the track alone, the number in the waiting colour, no comet", () => {
    const html = render([waiting]);
    expect(label(html)).toBe("Import queue: Your next import is #3 in line");
    expect(html).toContain('class="arc none"');
    expect(html).toContain("stroke-dasharray:0 100");
    expect(html).not.toContain(COMET);
    expect(textOf(html)).toBe("1");
  });

  it("next up says so", () => {
    expect(label(render([testJob({ status: "QUEUED", position: 1 })]))).toBe(
      "Import queue: Your next import is next up",
    );
  });

  it("just finished: a full ring and a tick", () => {
    const html = render([], { flash: true });
    expect(label(html)).toBe("Import queue: All imports finished");
    expect(html).toContain("stroke-dasharray:100 100");
    expect(html).toContain(TICK);
    expect(html).not.toContain(COMET);
    expect(html).not.toContain(TRAY);
  });

  it("needing attention: the tray with a red arrow, and a red count", () => {
    const html = render([failed]);
    expect(label(html)).toBe("Import queue: 1 needs attention");
    expect(html).toContain(TRAY);
    expect(html).not.toContain("<circle");
    expect(html).toMatch(/\.detail\{fill:#(d32f2f|f44336);?\}/);
    expect(textOf(html)).toBe("1");
  });

  it("on hold: the tray, with a neutral count", () => {
    const html = render([held]);
    expect(label(html)).toBe("Import queue: 1 on hold");
    expect(html).toContain(TRAY);
    expect(html).not.toMatch(/\.detail\{fill:#(d32f2f|f44336);?\}/);
    expect(textOf(html)).toBe("1");
  });

  it("empty: the tray alone", () => {
    const html = render([]);
    expect(html).toContain(TRAY);
    expect(html).not.toContain("<circle");
    expect(textOf(html)).toBe("");
  });

  it("a sync of their own stays out of the ring, the comet and the number", () => {
    const html = render([sync]);
    expect(label(html)).toBe("Import queue: A synced collection is updating");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain(COMET);
    expect(html).toContain(TRAY);
    expect(textOf(html)).toBe("");
  });

  it("the dark theme's square corners can't reach what's drawn and masked", () => {
    const html = render([running], { theme: "dark" });
    expect(html).toContain("<circle");
    expect(html).toContain("mask:radial-gradient");
    expect(html).toContain("stroke-dasharray:25 100");
  });
});
