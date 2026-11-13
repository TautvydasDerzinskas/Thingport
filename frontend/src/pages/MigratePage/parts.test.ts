import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../api/admin";
import type { MigrateRun } from "../../api/migrate";
import { checkPassed } from "./CheckStep";
import { guessUser, manyfoldLines } from "./ManyfoldMigrateDialog";
import { errorDetails, errorText, formatBytes, runTitle } from "./parts";

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

describe("migrate page helpers", () => {
  it("translates the server's reasons, with their values, and says something for any other", () => {
    expect(errorText(t, { code: "folder_missing", message: "x", values: { folder: "/old" } })).toBe(
      'adminSettings.migrate.errors.folder_missing {"folder":"/old"}',
    );
    expect(errorText(t, { code: "something_new", message: "x" })).toBe("adminSettings.migrate.errors.unexpected");
    expect(errorText(t, null)).toBe("");
  });

  it("shows the tools' own words only where they say more", () => {
    expect(errorDetails({ code: "restore_failed", message: "pg_restore: error" })).toBe("pg_restore: error");
    expect(errorDetails({ code: "folder_missing", message: "There's no folder" })).toBeNull();
  });

  it("writes sizes the way people read them", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
  });

  it("goes on from the check only once it's ready and some of its files were found", () => {
    const counts = { people: 1, models: 2, files: 4, collections: 0, designs: 0, widgets: 0, tools: 0 };
    const all = { ...counts, syncs: 0, signIns: 0, settings: 0, secrets: 0 };
    expect(checkPassed(run({ plan: { counts: all, missingFiles: 1 } }))).toBe(true);
    expect(checkPassed(run({ plan: { counts: all, missingFiles: 4 } }))).toBe(false);
    expect(checkPassed(run({ status: "preparing" }))).toBe(false);
    expect(checkPassed(null)).toBe(false);
  });

  it("names a migration by where it came from", () => {
    expect(runTitle(t, run({ plan: { dump: { name: "old.dump", size: 1 }, version: "1.2.0" } }))).toBe(
      'adminSettings.migrate.runs.fromRelease {"name":"old.dump","version":"1.2.0"}',
    );
    expect(runTitle(t, run({ source: "manyfold", plan: { address: "http://192.168.1.30:3214" } }))).toBe(
      'adminSettings.migrate.manyfold.runTitle {"name":"192.168.1.30:3214"}',
    );
  });

  it("guesses who a Manyfold username is here, by name or by email, else the one asking", () => {
    const users = [
      { id: "u1", display_name: "Alex", email: "alex.k@example.com" },
      { id: "u2", display_name: "Samantha", email: "sam@example.com" },
    ] as AdminUser[];
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
      'adminSettings.migrate.report.models {"count":3}',
      'adminSettings.migrate.report.modelsEarlier {"count":2}',
      'adminSettings.migrate.manyfold.report.noFiles {"count":1}',
      'adminSettings.migrate.report.collections {"count":2}',
      'adminSettings.migrate.report.collectionsMerged {"count":1}',
    ]);
    expect(errorText(t, { code: "manyfold_key", message: "x" })).toBe("adminSettings.migrate.errors.manyfold_key");
  });
});
