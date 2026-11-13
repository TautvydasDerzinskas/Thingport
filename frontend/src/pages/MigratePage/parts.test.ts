import i18next from "i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import type { AdminUser } from "../../api/admin";
import type { MigrateCounts, MigrateRun, ThingportRun } from "../../api/migrate";
import { canStart, checkPassed } from "./CheckStep";
import { guessUser, manyfoldLines } from "./ManyfoldMigrateDialog";
import { errorDetails, errorText, followRun, formatBytes, repeat, runTitle } from "./parts";

// The English the page shows, as the app's own i18next would give it.
const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  ns: ["app"],
  defaultNS: "app",
  resources: { en: { app: en.app } },
  interpolation: { escapeValue: false },
});
const { t } = i18n;

/** Someone on the Users page, with what a test doesn't care about filled in. */
function adminUser(given: Pick<AdminUser, "id" | "display_name" | "email">): AdminUser {
  return {
    role: "MEMBER",
    is_owner: false,
    can_promote: false,
    can_demote: false,
    can_delete: false,
    can_delete_models: false,
    print_count: 0,
    collection_count: 0,
    makerworld_connected: false,
    sign_in: { password: true, providers: [] },
    created_at: "2026-01-01T00:00:00Z",
    ...given,
  };
}

// With no options or report, which are each source's own.
const run = (
  patch: Omit<Partial<ThingportRun>, "plan" | "source" | "options" | "report"> & {
    source?: MigrateRun["source"];
    plan?: Partial<MigrateRun["plan"]>;
  },
): MigrateRun => ({
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
      "There's no folder at /old on this server.",
    );
    expect(errorText(t, { code: "something_new", message: "x" })).toBe(
      "Something went wrong. The server's log says more.",
    );
    expect(errorText(t, null)).toBe("");
    // An old instance's folder too big to copy online says so, rather than "something went wrong".
    expect(errorText(t, { code: "online_folder", message: "x", values: { limit: 10000 } })).toMatch(
      /^A folder on the old instance has more than 10000 files, more than can be copied online\./,
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

  it("names a migration by where it came from", () => {
    expect(runTitle(t, run({ plan: { dump: { name: "old.dump", size: 1 }, version: "1.2.0" } }))).toBe(
      "From old.dump (release 1.2.0)",
    );
    expect(runTitle(t, run({ source: "manyfold", plan: { address: "http://192.168.1.30:3214" } }))).toBe(
      "From Manyfold at 192.168.1.30:3214",
    );
  });

  it("guesses who a Manyfold username is here, by name or by email, else the one asking", () => {
    const users: AdminUser[] = [
      adminUser({ id: "u1", display_name: "Alex", email: "alex.k@example.com" }),
      adminUser({ id: "u2", display_name: "Samantha", email: "sam@example.com" }),
    ];
    expect(guessUser("alex", users, "me")).toBe("u1");
    expect(guessUser("Sam", users, "me")).toBe("u2");
    expect(guessUser("robin", users, "me")).toBe("me");
  });

  it("says what a migration from Manyfold did, leaving out what didn't happen", () => {
    const report = {
      models: { brought: 3, earlier: 2, noFiles: 1, alreadyHere: 0, failed: 0 },
      files: { copied: 9, missing: 0 },
      collections: { brought: 1, merged: 1 },
      failures: [],
    };
    expect(manyfoldLines(t, report)).toEqual([
      "3 models brought over",
      "2 models came over before",
      "1 left out: it has no 3D file Thingport takes",
      "2 collections",
      "1 of them merged into one of theirs here",
    ]);
    expect(errorText(t, { code: "manyfold_key", message: "x" })).toMatch(/^Manyfold turned the API key down\./);
    expect(errorText(t, { code: "manyfold_no_owner", message: "", values: { username: "robin" } })).toBe(
      "robin owns no models on Manyfold.",
    );
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

  it("repeats a task only once the last has settled, and goes on after one that failed", async () => {
    vi.useFakeTimers();
    try {
      const finish: (() => void)[] = [];
      let calls = 0;
      const stop = repeat(() => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error("down"));
        return new Promise<void>((resolve) => finish.push(resolve));
      }, 1000);
      await vi.advanceTimersByTimeAsync(4000);
      expect(calls).toBe(1);
      finish[0]();
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(3);
      stop();
      finish[1]();
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls).toBe(3);
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
