import { describe, expect, it } from "vitest";
import { isStalled, queueJobActions } from "./queueJobActions";
import type { ImportJobStatus, ImportJobType } from "../../api/imports";

const state = (type: ImportJobType, status: ImportJobStatus) => ({
  type,
  status,
  runner_live: false,
  pending_count: 1,
  running_count: 0,
  failed_items_count: 0,
  failed_count: 0,
});
describe("queue actions", () => {
  it.each<ImportJobType>(["SINGLE", "COLLECTION", "ZIP", "PROFILES", "LINKS"])(
    "pauses and resumes waiting %s jobs",
    (type) => {
      expect(queueJobActions(state(type, "QUEUED"))).toMatchObject({
        canPause: true,
        idle: false,
        canStart: false,
        canRetry: false,
      });
      expect(queueJobActions(state(type, "PAUSED")).canStart).toBe(true);
    },
  );
  it.each<ImportJobType>(["SINGLE", "COLLECTION", "ZIP", "PROFILES"])("cannot pause running %s", (type) => {
    expect(queueJobActions(state(type, "RUNNING")).canPause).toBe(false);
  });
  it("keeps interrupted ZIP imports from being replayed", () => {
    expect(queueJobActions({ ...state("ZIP", "ERROR"), failed_count: 1 })).toMatchObject({
      canStart: false,
      canRetry: false,
    });
  });
  it.each<ImportJobType>(["SINGLE", "COLLECTION", "PROFILES"])("retries failed %s", (type) => {
    expect(queueJobActions(state(type, "ERROR")).canRetry).toBe(true);
  });
  it("allows partial batch retries but waits for live link runners", () => {
    expect(queueJobActions({ ...state("COLLECTION", "DONE"), failed_count: 1 }).canRetry).toBe(true);
    expect(queueJobActions({ ...state("LINKS", "PAUSED"), runner_live: true, failed_items_count: 1 })).toMatchObject({
      canStart: false,
      canRetry: false,
      idle: false,
    });
  });
});

describe("stalled imports", () => {
  it.each<ImportJobType>(["SINGLE", "COLLECTION", "ZIP", "PROFILES"])(
    "does not require a local runner for %s",
    (type) => {
      expect(isStalled(state(type, "RUNNING"))).toBe(false);
    },
  );
  it("detects only running LINKS jobs without a local runner", () => {
    expect(isStalled(state("LINKS", "RUNNING"))).toBe(true);
    expect(isStalled({ ...state("LINKS", "RUNNING"), runner_live: true })).toBe(false);
    expect(isStalled(state("LINKS", "QUEUED"))).toBe(false);
  });
});
