import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAchievementCheck } from "../components/achievements/achievementEvents";
import { buildAchievements } from "./achievements";

vi.mock("../components/achievements/achievementEvents", () => ({
  requestAchievementCheck: vi.fn<typeof requestAchievementCheck>(),
}));

const fetchMock = vi.fn<typeof fetch>();
const tool = buildAchievements("3d-printing-wiki");

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(requestAchievementCheck).mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("script achievement claims", () => {
  it.each(["achievements_off", "no_such_secret"])("reports %s as unavailable", async (code) => {
    fetchMock.mockImplementation(async () => Response.json({ code }, { status: 404 }));
    await expect(tool.unlockWithStatus("fundamentals")).resolves.toBe("unavailable");
    await expect(tool.unlock("fundamentals")).resolves.toBe(false);
    expect(requestAchievementCheck).not.toHaveBeenCalled();
  });

  it("can repeat an unconfirmed request and keeps the boolean API", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(tool.unlockWithStatus("fundamentals")).resolves.toBe("retry");
    expect(requestAchievementCheck).not.toHaveBeenCalled();
    await expect(tool.unlockWithStatus("fundamentals")).resolves.toBe("earned");
    await expect(tool.unlock("fundamentals")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/me/achievements/secret",
      expect.objectContaining({ body: '{"secret":"3d-printing-wiki/fundamentals"}' }),
    );
    expect(requestAchievementCheck).toHaveBeenCalledTimes(2);
  });

  it("treats an unrecognized 404 as an unconfirmed claim", async () => {
    fetchMock.mockResolvedValue(new Response("Proxy could not find the route", { status: 404 }));
    await expect(tool.unlockWithStatus("fundamentals")).resolves.toBe("retry");
    expect(requestAchievementCheck).not.toHaveBeenCalled();
  });

  it("keeps unsaved drafts and empty keys unavailable", async () => {
    await expect(buildAchievements(null).unlockWithStatus("fundamentals")).resolves.toBe("unavailable");
    await expect(tool.unlockWithStatus("")).resolves.toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
