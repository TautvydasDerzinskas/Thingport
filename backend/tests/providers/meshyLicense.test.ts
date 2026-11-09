import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMeshyPost, resolveMeshyTask } from "../../src/providers/meshy/api";
import { meshyPostLicense, meshyTaskLicense } from "../../src/providers/meshy/license";
import { installFetch, json, loadFixture, type FetchStub } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Meshy's licences: its terms' CC0 for whatever is posted to its community, the licence an uploaded model's post keeps
// in its stage arguments, and a generation's own `license`, as its API names them -- recorded from the live site and
// the user's account, renamed. No database.

const POST_ID = "01a1a8bd-7d1a-757e-a8bc-b5f5a93723c5";
const TASK_ID = "01a1b2c3-1111-7222-8333-444455556666";
const AUTH = { token: "token", deviceId: null, wafToken: null };

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("Meshy licences", () => {
  it("maps a generation's licence, and none for one that names none", () => {
    expect(meshyTaskLicense("cc0")).toEqual({ id: "CC0-1.0", raw: "cc0" });
    expect(meshyTaskLicense("cc-by-4.0")).toEqual({ id: "CC-BY-4.0", raw: "cc-by-4.0" });
    expect(meshyTaskLicense("private")).toEqual({ id: "meshy-private", raw: "private" });
    expect(meshyTaskLicense("team")).toEqual({ id: null, raw: "team", label: "team" });
    expect(meshyTaskLicense("")).toBeNull();
    expect(meshyTaskLicense(undefined)).toBeNull();
  });

  it("gives a community post CC0, unless it's of an uploaded model with a licence of its own", () => {
    const uploads = loadFixture("meshy", "post-upload-licenses");
    expect(meshyPostLicense(uploads.ccBy.items)).toEqual({ id: "CC-BY-4.0", raw: "cc-by-4.0" });
    expect(meshyPostLicense(uploads.private.items)).toEqual({ id: "meshy-private", raw: "private" });
    expect(meshyPostLicense(loadFixture("meshy", "post").result.items)).toEqual({ id: "CC0-1.0", raw: "" });
    // A generation's stage arguments name no licence that counts: only an upload's do.
    const generated = [{ kind: "model", modelArgs: { draft: { license: "private" }, generate: { license: "" } } }];
    expect(meshyPostLicense(generated)).toEqual({ id: "CC0-1.0", raw: "" });
  });

  it("puts the licence in a post's and a generation's details", async () => {
    let task = loadFixture("meshy", "task");
    stub = installFetch(({ url }) => {
      if (url.pathname.endsWith(`/public/community/posts/${POST_ID}`)) return json(loadFixture("meshy", "post"));
      if (url.pathname.endsWith(`/v2/tasks/${TASK_ID}`)) return json(task);
      return undefined;
    });
    expect((await resolveMeshyPost(POST_ID))?.meta.license).toEqual({ id: "CC0-1.0", raw: "" });
    expect((await resolveMeshyTask(TASK_ID, AUTH, null))?.meta.license).toEqual({ id: "CC0-1.0", raw: "cc0" });
    task = loadFixture("meshy", "task");
    task.result.license = "private";
    expect((await resolveMeshyTask(TASK_ID, AUTH, null))?.meta.license).toEqual({
      id: "meshy-private",
      raw: "private",
    });
    delete task.result.license;
    expect((await resolveMeshyTask(TASK_ID, AUTH, null))?.meta).not.toHaveProperty("license");
  });
});
