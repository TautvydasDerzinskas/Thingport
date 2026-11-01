import { describe, expect, it } from "vitest";
import { IndicatorFace } from "./ImportQueueIndicator";
import { indicatorState, type QueueJob } from "./queueView";
import { renderQueue, testJob, textOf } from "./testing";

const TICK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
const CUBE = "M11 2.5 3 7v9.5l8 4.5 8-4.5V7l-8-4.5z";
const PLUS = "M17.25 15h1.5v2.25H21v1.5h-2.25V21h-1.5v-2.25H15v-1.5h2.25z";
const COMET = "conic-gradient";

const render = (jobs: QueueJob[], { flash = false, theme = "light" as "light" | "dark" } = {}) =>
  renderQueue(<IndicatorFace state={indicatorState(jobs, flash)} />, theme);

const running = testJob({ id: "r", status: "RUNNING", total: 8, processed: 2 });
const waiting = testJob({ id: "w", status: "QUEUED", position: 3 });
const failed = testJob({ id: "f", status: "ERROR", attention: true });
const held = testJob({ id: "h", status: "PAUSED" });
const sync = testJob({ id: "s", status: "RUNNING", collection_sync_id: "c1" });

describe("IndicatorFace", () => {
  it("with nothing going on it's Add: the cube and its plus, and nothing else", () => {
    const html = render([]);
    expect(html).toContain(CUBE);
    expect(html).toContain(PLUS);
    expect(html).not.toContain("<circle");
    expect(textOf(html)).toBe("");
  });

  it("running: the cube inside an arc for how far, with the comet, and no plus", () => {
    const html = render([running]);
    expect(html).toContain(CUBE);
    expect(html).not.toContain(PLUS);
    expect(html).toContain("stroke-dasharray:25 100");
    expect(html).toContain(COMET);
    expect(textOf(html)).toBe("");
  });

  it("running with more to come: how many", () => {
    expect(textOf(render([running, waiting]))).toBe("2");
  });

  it("running with one needing attention: that's the count to show", () => {
    expect(textOf(render([running, waiting, failed]))).toBe("1");
  });

  it("the comet is a ring: its mask ends transparent, or it would show as a square", () => {
    expect(render([running])).toMatch(/mask:radial-gradient\(circle farthest-side,[^;]*transparent 100%\)/);
  });

  it("the comet is gone with reduced motion, and the ring stops easing", () => {
    const html = render([running]);
    expect(html).toMatch(/prefers-reduced-motion: ?reduce\)\{[^}]*display:none/);
    expect(html).toMatch(/prefers-reduced-motion: ?reduce\)\{[^}]*transition:none/);
  });

  it("in line, none running: its place where the plus was, with no ring", () => {
    const html = render([waiting]);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain(COMET);
    expect(html).not.toContain(PLUS);
    expect(textOf(html)).toBe("#3");
  });

  it("just finished: a full ring and a tick", () => {
    const html = render([], { flash: true });
    expect(html).toContain("stroke-dasharray:100 100");
    expect(html).toContain(TICK);
    expect(html).not.toContain(COMET);
    expect(html).not.toContain(CUBE);
  });

  it("needing attention: a count where the plus was", () => {
    const html = render([failed]);
    expect(html).toContain(CUBE);
    expect(html).not.toContain(PLUS);
    expect(html).not.toContain("<circle");
    expect(textOf(html)).toBe("1");
  });

  it("on hold: a count where the plus was", () => {
    const html = render([held]);
    expect(html).not.toContain(PLUS);
    expect(textOf(html)).toBe("1");
  });

  it("a sync of their own stays out of it: still plain Add", () => {
    const html = render([sync]);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain(COMET);
    expect(html).toContain(PLUS);
    expect(textOf(html)).toBe("");
  });

  it("the dark theme's square corners can't reach what's drawn and masked", () => {
    const html = render([running], { theme: "dark" });
    expect(html).toContain("<circle");
    expect(html).toContain("mask:radial-gradient");
    expect(html).toContain("stroke-dasharray:25 100");
  });
});
