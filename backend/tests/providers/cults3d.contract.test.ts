import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import {
  getCults3dConnection,
  setUserCults3dBrowser,
  setUserCults3dCredentials,
} from "../../src/providers/cults3d/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  binary,
  cloudflareChallenge,
  html,
  json,
  loadFixture,
  loadFixtureHtml,
  redirect,
  stl,
  text,
  zip,
  type FetchHandler,
  expectStatus,
} from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Cults3D end to end, two doors. Its GraphQL API (the user's nickname and API key, 401 when it turns them down) reads the
// model, the orders and likes; the files come from the site's own pages with the browser's sign-in and Cloudflare
// clearance: a free model not yet in the user's orders is ordered first, a paid one is refused, and the order's download
// page redirects to a signed CloudFront link. Answers are the recorded shapes in fixtures/providers/cults3d.

const SLUG = "ghostship-benchy";
const MODEL_URL = `https://cults3d.com/en/3d-model/art/${SLUG}`;
const NICK = "Maker";
const CREDENTIALS = { nick: NICK, apiKey: "secret" };
const BROWSER = {
  session: "a823b7a79d7156fe6eef032de8827999",
  clearance: "wmNqDF.jZwItqtSCGKAz749QYyvhuCD0stC6MC-1792449123-1.2.1.1-_Sef40o9",
  userAgent: "Mozilla/5.0 X",
};
const SIGNED_ZIP = `https://download.cults3d.com/uploads/creation_zip/file/263230/${SLUG}.zip?Expires=1&Signature=s&Key-Pair-Id=k`;

/** Scenarios beyond the contract's "ok" (a free model, ordered on the way), "rejected" and "list":
 *  - "owned": the model is in the user's orders already, so nothing is ordered;
 *  - "paid", "paid-owned": a paid model, not bought / bought;
 *  - "session-ended": the site sends the order or download pages to its sign-in;
 *  - "challenge": Cloudflare challenges the site's pages;
 *  - "order-missing": the free order is taken, and still not in the orders;
 *  - "no-form": the model's page has no Download form;
 *  - "file-blocked": the signed link answers 429;
 *  - "missing": no such model. */
function handlerFor(scenario: string): FetchHandler {
  let ordered = scenario === "owned" || scenario === "paid-owned";
  const siteCalls: string[] = [];
  return async ({ url, method, body, headers }) => {
    if (url.hostname === "download.cults3d.com") {
      if (scenario === "file-blocked") return new Response("slow down", { status: 429 });
      return binary(
        await zip("cults3d-model", { [`${SLUG}.stl`]: stl("benchy"), [`${SLUG}-base.stl`]: stl("benchy-base") }),
      );
    }
    if (url.hostname !== "cults3d.com") return undefined;
    if (url.pathname === "/graphql") {
      if (scenario === "rejected") return new Response("HTTP Basic: Access denied.", { status: 401 });
      expect(headers.authorization).toBe(`Basic ${Buffer.from(`${NICK}:secret`).toString("base64")}`);
      const query: string = JSON.parse(body ?? "{}").query;
      if (query.includes("creation(slug")) {
        return json(
          loadFixture(
            "cults3d",
            scenario === "missing"
              ? "creation-missing"
              : scenario === "paid" || scenario === "paid-owned"
                ? "creation-paid"
                : "creation",
          ),
        );
      }
      if (query.includes("ordersBatch")) return json(loadFixture("cults3d", ordered ? "orders-owned" : "orders-empty"));
      if (query.includes("likedCreations")) {
        return json(scenario === "gone" ? { data: { user: null } } : loadFixture("cults3d", "likes"));
      }
      return undefined;
    }
    // The site: every call is the browser's, cookies and User-Agent included.
    siteCalls.push(`${method} ${url.pathname}`);
    expect(headers.cookie).toContain(`_session_id=${BROWSER.session}`);
    expect(headers["user-agent"]).toBe(BROWSER.userAgent);
    if (scenario === "challenge") return cloudflareChallenge();
    if (url.pathname === `/en/creations/${SLUG}`) return redirect(`https://cults3d.com/en/3d-model/art/${SLUG}`, 301);
    if (url.pathname === `/en/3d-model/art/${SLUG}`) {
      if (scenario === "session-ended") return redirect("https://cults3d.com/en/log-in-choice");
      return html(loadFixtureHtml("cults3d", scenario === "no-form" ? "model-page-no-form" : "model-page"));
    }
    if (url.pathname === "/en/free_orders" && method === "POST") {
      expect(new URLSearchParams(body ?? "").get("authenticity_token")).toBe("tok+en/==");
      ordered = scenario !== "order-missing";
      return redirect("https://cults3d.com/en/orders/169364417");
    }
    if (url.pathname === "/en/downloads/1") {
      if (scenario === "session-ended") return redirect("/en/users/sign-in");
      return redirect(SIGNED_ZIP);
    }
    return text("not found", 404);
  };
}

const spec: ProviderContractSpec = {
  id: "cults3d",
  name: "Cults3D",
  modelUrl: MODEL_URL,
  expected: {
    externalId: SLUG,
    title: "Ghostship Benchy",
    notesIncludes: "A benchy.\nBoooo\n\n### 3D printing settings",
    author: "3rdesignworks",
    tags: ["Benchy", "Ghost"],
    category: { name: "Sculptures", parent: "Art" },
    // The two pictures; the turntable video is left out.
    galleryImages: 2,
    plateInstanceIds: [null, null],
    plateFilenames: [`${SLUG}.stl`, `${SLUG}-base.stl`],
  },
  connect: async (userId) => {
    await setUserCults3dCredentials(userId, CREDENTIALS);
    await setUserCults3dBrowser(userId, BROWSER);
  },
  disconnect: async (userId) => {
    await setUserCults3dCredentials(userId, null);
    await setUserCults3dBrowser(userId, null);
  },
  createHandler: handlerFor,
  // Two slots; the API key is the one a plain import needs first.
  credentials: {
    sessionCode: "cults3d_session",
    connection: async (userId) => (await getCults3dConnection(userId)).api,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/cults3d-list/entries",
    url: `https://cults3d.com/en/users/${NICK}/likes`,
    title: `Cults3D likes (@${NICK})`,
    importedId: SLUG,
    freshId: "free-model",
  },
  // Read with the user's API key; paid models they own stay in the listing, the rest of the paid ones are left out.
  listing: {
    sync: { externalId: `likes:${NICK.toLowerCase()}`, sourceUrl: `https://cults3d.com/en/users/${NICK}/likes` },
    ids: [SLUG, "free-model"],
    needsSignIn: true,
  },
};

const ctx = describeProviderContract(spec);

const siteCalls = (calls: { url: URL; method: string }[]) =>
  calls.filter((call) => call.url.hostname === "cults3d.com" && call.url.pathname !== "/graphql");
const graphqlQueries = (calls: { url: URL; json: any }[]) =>
  calls.filter((call) => call.url.pathname === "/graphql").map((call) => String(call.json.query));

describe("Cults3D specifics", () => {
  describe("free orders", () => {
    it("orders a free model not yet in the library as the browser, then downloads it", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("ok");
      const res = await ctx.importUrl();
      expectStatus(res, 200);
      expect(siteCalls(stub.calls).map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
        `GET /en/creations/${SLUG}`,
        `GET /en/3d-model/art/${SLUG}`,
        "POST /en/free_orders",
        "GET /en/downloads/1",
      ]);
      // The orders were read twice: before the order (to see it isn't there) and after it (for the download page).
      expect(graphqlQueries(stub.calls).filter((query) => query.includes("ordersBatch"))).toHaveLength(2);
    });

    it("downloads a model already in the user's orders without ordering it", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("owned");
      const res = await ctx.importUrl();
      expectStatus(res, 200);
      expect(siteCalls(stub.calls).map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
        "GET /en/downloads/1",
      ]);
    });

    it("says so when the order was taken and still isn't among the downloads", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("order-missing");
      const res = await ctx.importUrl();
      expect(res.status).toBe(502);
      expect(res.body.detail).toMatch(/isn't in your downloads yet/);
    });

    it("answers a model page without a Download form with 403 and a message", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("no-form");
      const res = await ctx.importUrl();
      expectStatus(res, 403);
      expect(res.body.detail).toMatch(/no free Download button/);
    });
  });

  describe("paid models", () => {
    it("refuses a paid model that isn't in the orders, naming its price, before touching the site", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("paid");
      const res = await ctx.importUrl();
      expectStatus(res, 403);
      expect(res.body.detail).toMatch(/paid Cults3D model \(€ 2\.99\)/);
      expect(siteCalls(stub.calls)).toHaveLength(0);
      expect(await ctx.prints()).toHaveLength(0);
    });

    it("downloads a paid model once it's in the orders", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("paid-owned");
      const res = await ctx.importUrl();
      expectStatus(res, 200);
      expect(siteCalls(stub.calls).map((call) => call.url.pathname)).toEqual(["/en/downloads/1"]);
    });
  });

  describe("the two sign-ins", () => {
    it("needs the browser's session for the files, with its own message, after the API has answered", async () => {
      await setUserCults3dCredentials(ctx.userId, CREDENTIALS);
      const stub = ctx.stub("ok");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("cults3d_session");
      expect(res.body.detail).toMatch(/only gives its files to a signed-in user/);
      expect(siteCalls(stub.calls)).toHaveLength(0);
      expect((await getCults3dConnection(ctx.userId)).site).toBe("disconnected");
    });

    it("needs Cloudflare's clearance with it", async () => {
      await setUserCults3dCredentials(ctx.userId, CREDENTIALS);
      await setUserCults3dBrowser(ctx.userId, { ...BROWSER, clearance: null });
      ctx.stub("ok");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("cults3d_session");
      expect(res.body.detail).toMatch(/not Cloudflare's clearance/);
    });

    it("needs the API key first, and asks nothing without it", async () => {
      await setUserCults3dBrowser(ctx.userId, BROWSER);
      const stub = ctx.stub("ok");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("cults3d_session");
      expect(res.body.detail).toMatch(/your own API key/);
      expect(stub.calls).toHaveLength(0);
    });

    it("marks the browser's sign-in, not the API key, rejected when the site sends the pages to its sign-in", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("session-ended");
      const res = await ctx.importUrl();
      expectStatus(res, 400);
      expect(res.body.code).toBe("cults3d_session");
      expect(await getCults3dConnection(ctx.userId)).toMatchObject({ api: "connected", site: "expired" });
      expect(await prisma.print.count({ where: { userId: ctx.userId, sourceProvider: "cults3d" } })).toBe(0);
    });

    it("marks the API key, not the browser's sign-in, rejected when the API turns it down", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("rejected");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(await getCults3dConnection(ctx.userId)).toMatchObject({ api: "expired", site: "connected" });
    });
  });

  describe("Cloudflare", () => {
    it("reports a challenged site page as 403 CLOUDFLARE_BLOCKED, without rejecting the sign-in", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("challenge");
      const res = await ctx.importUrl();
      expectStatus(res, 403);
      expect(res.body.code).toBe("CLOUDFLARE_BLOCKED");
      expect(await getCults3dConnection(ctx.userId)).toMatchObject({ api: "connected", site: "connected" });
    });

    it("reports a rate-limited signed link as 429", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("file-blocked");
      const res = await ctx.importUrl();
      expect(res.status).toBe(429);
      expect(res.body.detail).toMatch(/Cults3D blocked the file download/);
    });
  });

  it("answers a model that isn't there with 404", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("missing");
    expect((await ctx.importUrl()).status).toBe(404);
  });

  it("leaves out paid models not in the orders when it lists likes", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("list");
    const res = await ctx.post(spec.list!.endpoint, { url: spec.list!.url });
    expectStatus(res, 200);
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([SLUG, "free-model"]);
  });

  it("lists nothing without the API key", async () => {
    await spec.disconnect(ctx.userId);
    ctx.stub("list");
    const res = await ctx.post(spec.list!.endpoint, { url: spec.list!.url });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("cults3d_session");
  });

  describe("filling a model's details", () => {
    const barePrint = () =>
      prisma.print.create({
        data: {
          userId: ctx.userId,
          name: "Bare",
          nameNormalized: "bare",
          sourceProvider: "cults3d",
          sourceExternalId: SLUG,
        },
      });

    it("answers 400 with the session code without the API key, as an import does", async () => {
      await spec.disconnect(ctx.userId);
      const print = await barePrint();
      ctx.stub("ok");
      const res = await ctx.post(`/api/print/${print.id}/fill-gaps`, {});
      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/your own API key/);
      expect(res.body.code).toBe("cults3d_session");
    });

    it("marks the API key rejected when the API turns it down, answering 400", async () => {
      await spec.connect(ctx.userId);
      const print = await barePrint();
      ctx.stub("rejected");
      const res = await ctx.post(`/api/print/${print.id}/fill-gaps`, {});
      expect(res.status).toBe(400);
      expect(await getCults3dConnection(ctx.userId)).toMatchObject({ api: "expired" });
    });
  });
});
