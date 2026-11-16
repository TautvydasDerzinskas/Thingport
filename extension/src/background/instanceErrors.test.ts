import { afterEach, describe, expect, it, vi } from "vitest";
import { instanceErrorText } from "./instanceErrors";
import { loginAndStoreToken, LoginRejectedError } from "./api";

const html = (status: number) =>
  new Response(`<html><body><center><h1>${status}</h1></center><hr><center>openresty</center></body></html>`, {
    status,
    headers: { "Content-Type": "text/html" },
  });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const signIn = (res: Response) => {
  vi.stubGlobal("fetch", async () => res);
  return loginAndStoreToken({ instanceUrl: "https://thingport.example", email: "a@example.test", password: "x" });
};

describe("instanceErrorText", () => {
  it("passes Thingport's own message on", async () => {
    await expect(instanceErrorText(json(500, { detail: "Internal server error" }))).resolves.toBe(
      "Internal server error",
    );
  });

  it("says a proxy answered when the error isn't Thingport's", async () => {
    // A reverse proxy's 500 for an import's body, as Nginx Proxy Manager answered one in issue #333.
    await expect(instanceErrorText(html(500))).resolves.toMatch(
      /^A proxy in front of your Thingport instance answered with HTTP 500, and no message from Thingport came through/,
    );
    await expect(instanceErrorText(json(403, { error: "Forbidden" }))).resolves.toMatch(/HTTP 403/);
    await expect(instanceErrorText(new Response(null, { status: 502 }))).resolves.toMatch(
      /isn't answering \(HTTP 502\)/,
    );
  });

  it("names what the proxy's status means", async () => {
    await expect(instanceErrorText(html(413))).resolves.toMatch(/too large .*body size limit/);
    await expect(instanceErrorText(html(504))).resolves.toMatch(/gave up \(HTTP 504\)/);
  });
});

describe("signing in behind a proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes Thingport's 401 as the credentials turned down", async () => {
    await expect(signIn(json(401, { detail: "Invalid email or password" }))).rejects.toBeInstanceOf(LoginRejectedError);
  });

  it("doesn't blame the credentials for a sign-in page in front of the instance", async () => {
    const err = await signIn(html(401)).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LoginRejectedError);
    expect((err as Error).message).toMatch(/HTTP 401/);
  });
});
