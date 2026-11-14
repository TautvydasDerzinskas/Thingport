import { describe, expect, it, vi } from "vitest";

// VoxelShare's sign-in is its token cookie, which only a signed-in visitor has.
let jar: Record<string, string> = {};
const asked: { url: string; name: string }[] = [];

vi.stubGlobal("chrome", {
  cookies: {
    get: async (details: { url: string; name: string }) => {
      asked.push(details);
      return details.name in jar ? { name: details.name, value: jar[details.name] } : null;
    },
  },
});

const { voxelshareSession } = await import("./session");

// A token in the site's shape, made up.
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjo0MDcwOTA4ODAwfQ.c2lnbmF0dXJl";

describe("VoxelShare's sign-in, read from its cookies", () => {
  it("sends the token cookie, and nothing else of the site's", async () => {
    jar = { token: TOKEN, refresh_token: "NJU0NTM2MZYT", app_did: "1a554e1b" };
    expect(await voxelshareSession.read()).toEqual({ value: TOKEN, body: { token: TOKEN }, userId: null });
    expect(asked.at(-1)).toEqual({ url: "https://www.voxelshare.com", name: "token" });
  });

  it("says signed out where there's no token, or one that isn't", async () => {
    jar = { app_did: "1a554e1b" };
    expect(await voxelshareSession.read()).toBeNull();
    jar = { token: "not a token" };
    expect(await voxelshareSession.read()).toBeNull();
  });

  it("clears the sign-in it sent once the user signs out there", () => {
    expect(voxelshareSession.signedOut).toEqual({ token: null });
  });
});
