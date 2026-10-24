import { vi } from "vitest";
import { getSnapmakerConnection, setUserSnapmakerToken } from "../../src/services/snapmakerSessionService";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, json, loadFixture, threeMf, stl, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Snapmaker Space on the contract harness (its own end-to-end tests stay in snapmakerImport.test.ts, which also pins
// profile naming and covers). The API answers `{code, msg, data}` with its own codes: 200 ok, 603000 not found,
// 110002 a sign-in it turns down. Answers are the recorded shapes in fixtures/providers/snapmaker.

const API = "https://api-models.snapmaker.com/api";
const MODEL_ID = "9990033";
const MODEL_URL = `https://space.snapmaker.com/en/model/${MODEL_ID}-test-princess`;
const LIKES_URL = "https://space.snapmaker.com/en/creator/183998?tab=interactions&list=likes";

function token() {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    token: `${part({ alg: "RS256" })}.${part({ exp, userId: 183998 })}.sig`,
    expiresAt: new Date(exp * 1000),
    userId: "183998",
  };
}

function handlerFor(scenario: string): FetchHandler {
  return async ({ url }) => {
    const full = `${url.origin}${url.pathname}`;
    if (full === `${API}/model/detail/${MODEL_ID}`) {
      return json(loadFixture("snapmaker", scenario === "missing" ? "model-missing" : "model-detail"));
    }
    if (full === `${API}/model/download/${MODEL_ID}`) {
      return json(loadFixture("snapmaker", scenario === "rejected" ? "unauthorized" : "model-download"));
    }
    if (full === `${API}/model/like/my`) return json(loadFixture("snapmaker", "likes"));
    if (url.hostname === "models.snapmaker.com") {
      // Snapmaker serves files as text/html whatever they are.
      return url.pathname.endsWith(".stl")
        ? binary(stl("princess"), "text/html")
        : binary(await threeMf(url.pathname), "text/html");
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "snapmaker",
  name: "Snapmaker Space",
  modelUrl: MODEL_URL,
  expected: {
    externalId: MODEL_ID,
    title: "Test Princess",
    notesIncludes: "A **princess**.",
    author: "Test Designer",
    tags: ["Princess"],
    category: { name: "Creatures", parent: "Miniatures" },
    galleryImages: 2,
    // The designer's profile, the one a plain link brings.
    plateInstanceIds: ["501"],
    plateFilenames: ["501.3mf"],
  },
  connect: async (userId) => {
    await setUserSnapmakerToken(userId, token());
  },
  disconnect: async (userId) => {
    await setUserSnapmakerToken(userId, null);
  },
  createHandler: handlerFor,
  credentials: {
    sessionCode: "snapmaker_session",
    connection: getSnapmakerConnection,
  },
  reimport: {
    profile: {
      url: `${MODEL_URL}#profileId-502`,
      plateInstanceIds: ["501", "502"],
    },
  },
  list: {
    endpoint: "/api/import/snapmaker-list/entries",
    url: LIKES_URL,
    title: "Snapmaker Space likes",
    importedId: MODEL_ID,
    freshId: "9990034",
  },
  // The user's own lists are never gone: a missing one is an empty one.
  listing: {
    sync: { externalId: "likes-183998", sourceUrl: LIKES_URL },
    ids: [MODEL_ID, "9990034"],
    needsSignIn: true,
    neverGone: true,
  },
};

describeProviderContract(spec);
