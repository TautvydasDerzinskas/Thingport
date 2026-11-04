import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialStatus } from "../api/social";

const status = vi.fn<() => Promise<SocialStatus>>();
vi.mock("../api/social", () => ({ socialApi: { status: () => status() } }));

const ON: SocialStatus = { enabled: true, explore: true };
const OFF: SocialStatus = { enabled: false, explore: false };

// The status is kept for the whole page, so each test gets the module afresh.
async function freshModule() {
  vi.resetModules();
  return import("./useSocialStatus");
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  status.mockReset();
  vi.useRealTimers();
});

describe("social status", () => {
  it("drops an answer asked for before an admin changed the setting", async () => {
    const { refreshSocialStatus, subscribeSocialStatus } = await freshModule();
    let answerOld: (value: SocialStatus) => void = () => undefined;
    status.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve))).mockResolvedValueOnce(ON);
    const heard: SocialStatus[] = [];
    subscribeSocialStatus((value) => heard.push(value));

    refreshSocialStatus();
    answerOld(OFF);
    await settle();

    expect(status).toHaveBeenCalledTimes(2);
    expect(heard).not.toContainEqual(OFF);
    expect(heard.at(-1)).toEqual(ON);
  });

  it("asks again a little after a failed answer, and tells everyone", async () => {
    vi.useFakeTimers();
    const { subscribeSocialStatus } = await freshModule();
    status.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(ON);
    const heard: SocialStatus[] = [];
    subscribeSocialStatus((value) => heard.push(value));

    await vi.advanceTimersByTimeAsync(0);
    expect(heard.at(-1)).toEqual(OFF);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heard.at(-1)).toEqual(ON);
  });
  it("stops asking again once nothing shows it", async () => {
    vi.useFakeTimers();
    const { subscribeSocialStatus } = await freshModule();
    status.mockRejectedValue(new Error("down"));
    const stop = subscribeSocialStatus(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(status).toHaveBeenCalledTimes(1);
  });
  it("doesn't ask again for a failure a refresh has already answered", async () => {
    vi.useFakeTimers();
    const { refreshSocialStatus, subscribeSocialStatus } = await freshModule();
    status.mockRejectedValueOnce(new Error("down")).mockResolvedValue(ON);
    subscribeSocialStatus(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    refreshSocialStatus();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status).toHaveBeenCalledTimes(2);
  });
});
