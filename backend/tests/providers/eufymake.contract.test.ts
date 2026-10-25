import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { eufymakeGtoken } from "../../src/providers/eufymake/api";
import {
  getEufymakeConnection,
  normalizeEufymakeSession,
  setUserEufymakeSession,
} from "../../src/providers/eufymake/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, json, loadFixture, stl, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// eufyMake end to end: details, and the files they link, need no sign-in; the user's likes need their token and the
// Gtoken that goes with it, a 401 in the body when they're turned down. Answers are the recorded shapes in
// fixtures/providers/eufymake.

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";
const EUFY_USER = "0000000000000000000000000000000000abcfff";
const API = "/web/modelbase/";
const MODEL_URL =
  "https://makeitreal.eufymake.com/models/9255b7378ac611efa154f2247282c358/Halloween ghost night light_lampshade/";
const LIKES_URL = "https://makeitreal.eufymake.com/user/me/";
const LIKED = [
  "be7c829023dd11f19919128e55eac07e",
  "7e215ebad51711efad6f96942a44d98d",
  "9a28d82a6e5411f1aae2b27ad9738895",
];

function handlerFor(scenario: string): FetchHandler {
  return ({ url, json: body, headers }) => {
    if (url.hostname.endsWith(".cloudfront.net") && url.pathname.endsWith(".stl")) {
      return binary(stl(url.pathname.split("/").pop()!));
    }
    if (url.hostname !== "aiot-wapi-eu.ankermake.com" || !url.pathname.startsWith(API)) return undefined;
    switch (url.pathname.slice(API.length)) {
      case "model/get_model_detail":
        return json(loadFixture("eufymake", scenario === "missing" ? "model-missing" : "model-detail"));
      case "user/get_my_like_list": {
        assertThat(
          headers["x-auth-token"] === TOKEN && headers.gtoken === eufymakeGtoken(EUFY_USER),
          "the token is the user's, with the Gtoken of their id",
        );
        if (scenario === "rejected") return json(loadFixture("eufymake", "unauthorized"));
        // Past the first page there are none, and eufyMake counts them as 0.
        if ((body as { pagination: { page: number } }).pagination.page > 1) {
          return json({ code: 0, msg: "success!", data: { models: [], total: 0 } });
        }
        return json(loadFixture("eufymake", "likes"));
      }
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "eufymake",
  name: "eufyMake",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "9255b7378ac611efa154f2247282c358",
    title: "Halloween ghost night light/lampshade",
    notesIncludes: "You can place a sensing light inside the model.",
    author: "Maker 1",
    tags: ["Halloween", "Lampshade", "Light"],
    category: { name: "Other Household Models", parent: "Household" },
    galleryImages: 2,
    plateInstanceIds: [null],
    plateFilenames: ["ghost.stl"],
  },
  connect: async (userId) => {
    await setUserEufymakeSession(userId, { token: TOKEN, gtoken: eufymakeGtoken(EUFY_USER), userId: EUFY_USER });
  },
  disconnect: async (userId) => {
    await setUserEufymakeSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  reimport: {},
  list: {
    endpoint: "/api/import/eufymake/list/entries",
    url: LIKES_URL,
    title: "eufyMake likes",
    importedId: LIKED[0],
    freshId: LIKED[1],
  },
  // The likes are the user's own, read with their sign-in, and never gone.
  listing: { sync: { externalId: "likes", sourceUrl: LIKES_URL }, ids: LIKED, needsSignIn: true, neverGone: true },
  skip: {
    missingCredentials: "eufyMake's models and their files import without a sign-in; only likes need one",
    rejectedCredentials: "eufyMake's models and their files import without a sign-in; only likes need one",
  },
};

const ctx = describeProviderContract(spec);

describe("eufyMake specifics", () => {
  it("answers a model eufyMake doesn't have with 404", async () => {
    ctx.stub("missing");
    expect(
      (await ctx.importUrl("https://makeitreal.eufymake.com/models/00000000000000000000000000000000/")).status,
    ).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("asks for a sign-in to list the likes, and remembers one eufyMake turns down", async () => {
    await spec.disconnect(ctx.userId);
    ctx.stub("list");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("eufymake_session");

    await spec.connect(ctx.userId);
    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("eufymake_session");
    expect(await getEufymakeConnection(ctx.userId)).toBe("expired");
  });

  it("imports the model's own files, not the zip of them", async () => {
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id } });
    expect(plates.map((plate) => plate.filename)).toEqual(["ghost.stl"]);
    expect(stub.calls.some((call) => call.url.pathname.endsWith(".zip"))).toBe(false);
  });
});

describe("eufyMake sign-in", () => {
  const gtoken = eufymakeGtoken(EUFY_USER);

  const INFO = JSON.stringify({ auth_token: TOKEN, user_id: EUFY_USER, email: "someone@example.com" });
  const stored = (value: string) => Buffer.from(encodeURIComponent(value)).toString("base64");

  it("reads the site's mk-userinfo value, base64 of the percent-encoded JSON as it writes it now", () => {
    expect(normalizeEufymakeSession(stored(INFO))).toEqual({ token: TOKEN, gtoken, userId: EUFY_USER });
    // Its store stamps a value that runs out with when it does, inside the base64.
    expect(normalizeEufymakeSession(stored(`exp@1795520520;${INFO}`))).toEqual({
      token: TOKEN,
      gtoken,
      userId: EUFY_USER,
    });
    // What builds before October 2026 wrote, which a user may still have.
    expect(normalizeEufymakeSession(INFO)).toEqual({ token: TOKEN, gtoken, userId: EUFY_USER });
    expect(normalizeEufymakeSession(stored("not a sign-in"))).toBeNull();
  });

  it("reads request headers pasted from DevTools, either way it copies them", () => {
    const lines = `accept\n*/*\ngtoken\n${gtoken}\nx-auth-token\n${TOKEN}`;
    expect(normalizeEufymakeSession(lines)).toEqual({ token: TOKEN, gtoken, userId: null });
    const pairs = `Gtoken: ${gtoken}\nX-Auth-Token: ${TOKEN}\nModel-Type: WEB`;
    expect(normalizeEufymakeSession(pairs)).toEqual({ token: TOKEN, gtoken, userId: null });
  });

  it("reads the two values pasted with their names stripped off, either way round", () => {
    expect(normalizeEufymakeSession(`${TOKEN}\n${gtoken}`)).toEqual({ token: TOKEN, gtoken, userId: null });
    expect(normalizeEufymakeSession(`${gtoken}\n${TOKEN}`)).toEqual({ token: TOKEN, gtoken, userId: null });
  });

  it("takes the user id from a pasted cookie row, whose Gtoken it works out", () => {
    const cookies = `makeitreal-euid\t${EUFY_USER}\nx-auth-token\t${TOKEN}`;
    expect(normalizeEufymakeSession(cookies)).toEqual({ token: TOKEN, gtoken, userId: EUFY_USER });
  });

  it("takes a bare token only with whose it is: the Gtoken can't be worked out from the token", () => {
    expect(normalizeEufymakeSession(TOKEN)).toBeNull();
    expect(normalizeEufymakeSession(TOKEN, EUFY_USER)).toEqual({ token: TOKEN, gtoken, userId: EUFY_USER });
    expect(normalizeEufymakeSession("not a sign-in")).toBeNull();
  });
});
