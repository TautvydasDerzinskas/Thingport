import { describe, expect, it, vi } from "vitest";

// QIDI Maker's sign-in is its token cookie, which only a signed-in visitor has.
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

const { qidimakerSession } = await import("./session");

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("QIDI Maker's sign-in, read from its cookies", () => {
  it("sends the token cookie, and nothing else of the site's", async () => {
    jar = { token: TOKEN, "XSRF-TOKEN": "not-a-real-xsrf-value", theme: "system" };
    expect(await qidimakerSession.read()).toEqual({ value: TOKEN, body: { token: TOKEN }, userId: null });
    expect(asked.at(-1)).toEqual({ url: "https://www.qidimaker.com", name: "token" });
  });

  it("says signed out where there's no token, or one that isn't", async () => {
    jar = { theme: "system" };
    expect(await qidimakerSession.read()).toBeNull();
    jar = { token: "not a token" };
    expect(await qidimakerSession.read()).toBeNull();
  });

  it("clears the sign-in it sent once the user signs out there", () => {
    expect(qidimakerSession.signedOut).toEqual({ token: null });
  });
});
