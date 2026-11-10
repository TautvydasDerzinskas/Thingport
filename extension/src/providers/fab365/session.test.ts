import { describe, expect, it, vi } from "vitest";

// fab365.net keeps the sign-in in page storage, so Grab asks each open tab of the site for it. A tab is answered as
// holding a sign-in, holding none, or being out of reach (still loading, or one Grab may not script).
type Tab = {
  id: number;
  holds?: { access: string; refresh: string | null; userId: string } | null;
  unreachable?: true;
};
let tabs: Tab[] = [];

vi.stubGlobal("chrome", {
  tabs: { query: async () => tabs.map(({ id }) => ({ id })) },
  scripting: {
    executeScript: async ({ target }: { target: { tabId: number } }) => {
      const tab = tabs.find(({ id }) => id === target.tabId)!;
      if (tab.unreachable) throw new Error("Cannot access contents of the page");
      return [{ result: tab.holds ?? null }];
    },
  },
});

const { fab365Session } = await import("./session");

const SIGN_IN = { access: "header.access.sig", refresh: "header.refresh.sig", userId: "242181" };

describe("Fab365's sign-in, read from the site's tabs", () => {
  it("sends the access token and the refresh token beside it, from whichever tab holds them", async () => {
    tabs = [
      { id: 1, holds: null },
      { id: 2, holds: SIGN_IN },
    ];
    expect(await fab365Session.read()).toEqual({
      value: SIGN_IN.access,
      body: { access_token: SIGN_IN.access, refresh_token: SIGN_IN.refresh },
      userId: SIGN_IN.userId,
    });
  });

  it("says signed out only when every tab it asked said so", async () => {
    tabs = [
      { id: 1, holds: null },
      { id: 2, holds: null },
    ];
    expect(await fab365Session.read()).toBeNull();
  });

  it("says nothing either way when a tab couldn't be read and none held a sign-in, or there's no tab to ask", async () => {
    // A www.fab365.net tab keeps storage of its own, so its having none says nothing of a fab365.net tab out of reach.
    tabs = [
      { id: 1, unreachable: true },
      { id: 2, holds: null },
    ];
    expect(await fab365Session.read()).toBeUndefined();
    tabs = [];
    expect(await fab365Session.read()).toBeUndefined();
  });

  it("still finds the sign-in when another tab is out of reach", async () => {
    tabs = [
      { id: 1, unreachable: true },
      { id: 2, holds: SIGN_IN },
    ];
    expect(await fab365Session.read()).toMatchObject({ userId: SIGN_IN.userId });
  });
});
