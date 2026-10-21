import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MakerworldCaptchaError,
  makerworldCaptchaCooloffActive,
  MakerworldDownloadLimitError,
  resolveMakerworldViaCloudApi,
} from "../src/services/makerworldCloudApi";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const VALID_DESIGN = {
  modelId: "model-1",
  instances: [{ id: "1", profileId: "profile-1" }],
  defaultInstanceId: "1",
};

const VALID_DOWNLOAD = { message: "success", url: "https://example.com/signed-download.3mf" };

describe("resolveMakerworldViaCloudApi", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retries once on a bare 418 (not yet confirmed as the CAPTCHA shape) instead of giving up immediately", async () => {
    let designCalls = 0;
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/design-service/design/")) {
        designCalls++;
        if (designCalls === 1) return jsonResponse(418, { error: "temporary" });
        return jsonResponse(200, VALID_DESIGN);
      }
      if (url.includes("/iot-service/api/user/profile/")) {
        return jsonResponse(200, VALID_DOWNLOAD);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;

    const result = await resolveMakerworldViaCloudApi("123", null, "test-token");

    expect(designCalls).toBe(2);
    expect(result?.downloadUrl).toBe(VALID_DOWNLOAD.url);
    expect(makerworldCaptchaCooloffActive()).toBe(false);
  });

  it("downloads the raw files of a model with no print profiles, as one zip", async () => {
    const fetched: string[] = [];
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url.endsWith("/design-service/design/777")) {
        return jsonResponse(200, { id: 777, title: "Paint holder", modelId: "", instances: [], defaultInstanceId: 0 });
      }
      if (url.includes("/design-service/design/777/model?modelType=all&type=download")) {
        return jsonResponse(200, { name: "", url: "https://makerworld.bblmw.com/model/777/all.zip?key=k" });
      }
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const result = await resolveMakerworldViaCloudApi("777", null, "test-token");

    expect(result?.downloadUrl).toBe("https://makerworld.bblmw.com/model/777/all.zip?key=k");
    expect(result?.meta.title).toBe("Paint holder");
    expect(result?.meta.makerworldProfile?.instanceId).toBeNull();
    expect(fetched.some((url) => url.includes("/iot-service/"))).toBe(false);
  });

  it("throws MakerworldDownloadLimitError on the daily download limit reply", async () => {
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/design-service/design/")) return jsonResponse(200, VALID_DESIGN);
      if (url.includes("/iot-service/api/user/profile/")) {
        return jsonResponse(400, { code: -1, error: "You've reached your daily download limit." });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;

    await expect(resolveMakerworldViaCloudApi("321", null, "test-token")).rejects.toBeInstanceOf(
      MakerworldDownloadLimitError,
    );
    expect(makerworldCaptchaCooloffActive()).toBe(false);
  });

  it("throws MakerworldCaptchaError and starts the cooloff on a real CAPTCHA challenge, then short-circuits further calls without hitting the network again", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.includes("/design-service/design/")) {
        return jsonResponse(418, { captchaId: "abc123", error: "We need you to confirm you are not a robot" });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(resolveMakerworldViaCloudApi("456", null, "test-token")).rejects.toBeInstanceOf(
      MakerworldCaptchaError,
    );
    expect(makerworldCaptchaCooloffActive()).toBe(true);

    const callsAfterFirstChallenge = fetchMock.mock.calls.length;
    await expect(resolveMakerworldViaCloudApi("789", null, "test-token")).rejects.toBeInstanceOf(
      MakerworldCaptchaError,
    );
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstChallenge);
  });
});
