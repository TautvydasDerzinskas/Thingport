import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import { readCodedError, readErrorMessage } from "./client";

const page = (status: number) =>
  new Response(`<html><head><title>${status}</title></head><body><center>nginx</center></body></html>`, { status });

describe("readErrorMessage", () => {
  beforeAll(async () => {
    // As the app's (i18n/index.ts): messages are text, not HTML.
    await i18next.init({
      lng: "en",
      ns: ["common"],
      resources: { en: { common: en.common } },
      interpolation: { escapeValue: false },
    });
  });

  it("passes the backend's own message on", async () => {
    const res = new Response(JSON.stringify({ detail: "Model not found" }), { status: 404 });
    expect(await readErrorMessage(res, "Request failed")).toBe("Model not found");
  });

  it("says a proxy answered, and where its settings are, when the error isn't the backend's", async () => {
    const message = await readErrorMessage(page(500), "Request failed (500)");
    expect(message).toMatch(
      /^A proxy in front of this Thingport instance answered with HTTP 500, and no message from Thingport came through/,
    );
    expect(message).toContain("https://thingport.net/docs/guides/reverse-proxy/");
    expect(await readErrorMessage(new Response("Bad Request", { status: 400 }), "x")).toMatch(/HTTP 400/);
    expect(await readErrorMessage(new Response(JSON.stringify({ error: "no" }), { status: 403 }), "x")).toMatch(
      /HTTP 403/,
    );
  });

  it("names what the proxy's status means", async () => {
    expect(await readErrorMessage(page(413), "x")).toMatch(/too large .*body size limit/);
    expect(await readErrorMessage(new Response(null, { status: 502 }), "x")).toMatch(/isn't answering \(HTTP 502\)/);
    expect(await readErrorMessage(page(504), "x")).toMatch(/gave up \(HTTP 504\)/);
  });

  it("keeps the fallback for a success it was handed", async () => {
    expect(await readErrorMessage(new Response("{}", { status: 200 }), "Couldn't read it")).toBe("Couldn't read it");
  });
});

describe("readCodedError", () => {
  it("reads a coded error and one sent as detail, as a route sends both", async () => {
    const coded = new Response(JSON.stringify({ error: "Accept it first", code: "suggestion_pending" }), {
      status: 409,
    });
    expect(await readCodedError(coded, "x")).toEqual({ message: "Accept it first", code: "suggestion_pending" });
    const plain = new Response(JSON.stringify({ detail: 'A print named "Twin" already exists' }), { status: 409 });
    expect(await readCodedError(plain, "x")).toEqual({ message: 'A print named "Twin" already exists', code: null });
  });
});
