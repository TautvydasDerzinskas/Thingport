import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import type { MigrateCounts, MigrateRun } from "../../api/migrate";
import { canStart, checkPassed } from "./CheckStep";
import { errorDetails, errorText, followRun, formatBytes } from "./parts";

// Answers with the key and its values, so a test sees which sentence would show.
const t = ((key: string, values?: Record<string, unknown>) =>
  values && Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;

const run = (patch: Omit<Partial<MigrateRun>, "plan"> & { plan?: Partial<MigrateRun["plan"]> }): MigrateRun => ({
  id: "r",
  source: "thingport",
  status: "ready",
  options: null,
  report: null,
  error: null,
  progress: null,
  can_resume: false,
  created_at: "",
  started_at: null,
  finished_at: null,
  ...patch,
  plan: { dump: null, folder: "/old", ...patch.plan },
});

/** A check's counts: nothing of anything, but what's given. */
const countsOf = (some: Partial<MigrateCounts>): MigrateCounts => ({
  people: 0,
  models: 0,
  files: 0,
  collections: 0,
  designs: 0,
  widgets: 0,
  tools: 0,
  syncs: 0,
  signIns: 0,
  settings: 0,
  secrets: 0,
  ...some,
});

describe("migrate page helpers", () => {
  it("translates the server's reasons, with their values, and says something for any other", () => {
    expect(errorText(t, { code: "folder_missing", message: "x", values: { folder: "/old" } })).toBe(
      'adminSettings.migrate.errors.folder_missing {"folder":"/old"}',
    );
    expect(errorText(t, { code: "something_new", message: "x" })).toBe("adminSettings.migrate.errors.unexpected");
    expect(errorText(t, null)).toBe("");
    // An old instance's folder too big to copy online says so, rather than "something went wrong".
    expect(errorText(t, { code: "online_folder", message: "x", values: { limit: 10000 } })).toBe(
      'adminSettings.migrate.errors.online_folder {"limit":10000}',
    );
  });

  it("shows the tools' own words only where they say more", () => {
    expect(errorDetails({ code: "restore_failed", message: "pg_restore: error" })).toBe("pg_restore: error");
    expect(errorDetails({ code: "folder_missing", message: "There's no folder" })).toBeNull();
  });

  it("writes sizes the way people read them", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
    // With the language's own decimal comma.
    expect(formatBytes(1536, "fr")).toBe("1,5 KB");
    expect(formatBytes(1536, "lt")).toBe("1,5 KB");
  });

  it("goes on from the check only once it's ready and some of its files were found", () => {
    const all = countsOf({ people: 1, models: 2, files: 4 });
    expect(checkPassed(run({ plan: { counts: all, missingFiles: 1 } }))).toBe(true);
    expect(checkPassed(run({ plan: { counts: all, missingFiles: 4 } }))).toBe(false);
    expect(checkPassed(run({ status: "preparing" }))).toBe(false);
    expect(checkPassed(null)).toBe(false);
  });
});

describe("following a run", () => {
  it("asks once at a time, and drops what an answer says after it's stopped", async () => {
    vi.useFakeTimers();
    try {
      const answers: ((value: MigrateRun) => void)[] = [];
      const get = vi.fn<() => Promise<MigrateRun>>(() => new Promise((resolve) => answers.push(resolve)));
      const seen: string[] = [];
      const stop = followRun(
        get,
        1000,
        (next) => seen.push(next.status),
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(5000);
      // The first answer is slow: no second request meanwhile.
      expect(get).toHaveBeenCalledTimes(1);
      answers[0](run({ status: "preparing" }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(get).toHaveBeenCalledTimes(2);
      stop();
      answers[1](run({ status: "ready" }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(seen).toEqual(["preparing"]);
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a run only once its latest check passed, and not while its folder is checked again", () => {
    const counts = countsOf({ files: 4 });
    expect(canStart(run({ plan: { counts, missingFiles: 1 } }), false)).toBe(true);
    expect(canStart(run({ plan: { counts, missingFiles: 1 } }), true)).toBe(false);
    expect(canStart(run({ plan: { counts, missingFiles: 4 } }), false)).toBe(false);
    expect(canStart(run({ status: "failed", can_resume: true }), false)).toBe(true);
    expect(canStart(run({ status: "failed", can_resume: false }), false)).toBe(false);
  });
});
