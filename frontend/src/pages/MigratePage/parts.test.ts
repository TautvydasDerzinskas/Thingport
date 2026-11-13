import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { MigrateRun } from "../../api/migrate";
import { checkPassed } from "./CheckStep";
import { errorDetails, errorText, formatBytes } from "./parts";

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
});
