import { beforeEach, describe, expect, it, vi } from "vitest";

const model = (id: string) => ({
  id,
  title: id,
  url: `https://x/${id}`,
  image: null,
  likes: 1,
  author: null,
  paid: false,
});

type Model = ReturnType<typeof model>;

vi.mock("../src/services/printablesApi", () => ({
  fetchPrintablesTrending: vi.fn<() => Promise<Model[]>>(async () => [model("p1")]),
}));
vi.mock("../src/services/thingiverseApi", () => ({
  fetchThingiversePopular: vi.fn<() => Promise<Model[]>>(async () => [model("t1")]),
}));
vi.mock("../src/providers/cults3d/api", () => ({
  fetchCults3dPopular: vi.fn<() => Promise<Model[]>>(async () => [model("c1")]),
}));
vi.mock("../src/services/settingsService", () => ({
  getThingiverseAccessToken: vi.fn<() => Promise<string | null>>(async () => null),
  getMyminifactoryApiKey: vi.fn<() => Promise<string | null>>(async () => null),
}));
vi.mock("../src/providers/cults3d/session", () => ({
  getUserCults3dCredentials: vi.fn<(userId: string) => Promise<{ nick: string; apiKey: string } | null>>(
    async (userId) => (userId === "with-key" ? { nick: "n", apiKey: "k" } : null),
  ),
}));

const { getTrending } = await import("../src/services/providerTrendingService");
const printables = await import("../src/services/printablesApi");
const thingiverse = await import("../src/services/thingiverseApi");
const settings = await import("../src/services/settingsService");
const cults3d = await import("../src/providers/cults3d/api");

beforeEach(() => vi.clearAllMocks());

describe("trending lists", () => {
  it("reads a public list once and serves it from the cache after", async () => {
    const first = await getTrending("printables", "u1");
    expect(first).toMatchObject({ status: "ok", kind: "trending", models: [{ id: "p1" }] });
    await getTrending("printables", "u2");
    expect(printables.fetchPrintablesTrending).toHaveBeenCalledTimes(1);
  });

  it("says what to set up for a provider without its token, and reads it once one is added", async () => {
    expect(await getTrending("thingiverse", "u1")).toMatchObject({ status: "needsSetup", setup: "thingiverseToken" });
    expect(thingiverse.fetchThingiversePopular).not.toHaveBeenCalled();
    vi.mocked(settings.getThingiverseAccessToken).mockResolvedValueOnce("token");
    expect(await getTrending("thingiverse", "u1")).toMatchObject({
      status: "ok",
      kind: "popular",
      models: [{ id: "t1" }],
    });
  });

  it("reads Cults3D with each user's own key, and never shares it between users", async () => {
    expect(await getTrending("cults3d", "no-key")).toMatchObject({ status: "needsSetup", setup: "cults3dKey" });
    expect(await getTrending("cults3d", "with-key")).toMatchObject({ status: "ok", models: [{ id: "c1" }] });
    await getTrending("cults3d", "with-key");
    expect(cults3d.fetchCults3dPopular).toHaveBeenCalledTimes(2);
    expect(await getTrending("cults3d", "no-key")).toMatchObject({ status: "needsSetup" });
  });
});
