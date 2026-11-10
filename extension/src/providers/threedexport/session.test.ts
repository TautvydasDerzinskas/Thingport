import { describe, expect, it, vi } from "vitest";

// 3DExport's sign-in is two cookies, which say on their own whether anyone is signed in: a visitor's number is -1 and
// comes with no hash.
let jar: { name: string; value: string }[] = [];

vi.stubGlobal("chrome", { cookies: { getAll: async () => jar } });

const { threedexportSession } = await import("./session");

const HASH = "0123456789abcdef0123456789abcdef";

describe("3DExport's sign-in, read from its cookies", () => {
  it("sends the user's number and hash, and nothing else of the site's", async () => {
    jar = [
      { name: "sessionid", value: "abc" },
      { name: "nm_userid", value: "1000001" },
      { name: "nm_hash", value: HASH },
      { name: "nm_language", value: "english" },
    ];
    const cookie = `nm_userid=1000001; nm_hash=${HASH}`;
    expect(await threedexportSession.read()).toEqual({ value: cookie, body: { session: cookie }, userId: "1000001" });
  });

  it("says signed out for a visitor's cookies, or a signed-out user's", async () => {
    jar = [{ name: "nm_userid", value: "-1" }];
    expect(await threedexportSession.read()).toBeNull();
    jar = [
      { name: "nm_userid", value: "1000001" },
      { name: "sessionid", value: "abc" },
    ];
    expect(await threedexportSession.read()).toBeNull();
  });
});
