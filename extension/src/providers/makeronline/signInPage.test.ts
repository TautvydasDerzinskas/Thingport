import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DownloadRequest, signInPage } from "./signInPage";

const HOSTS = ["makeronline.com", "www.makeronline.com"];
const REQUEST: DownloadRequest = {
  payload: { key: "k1", file_type: 2, is_batch_down: 0, print_profile_id: 7 },
  name: "Ace overhead 2.3mf",
  profile_id: "7",
};

/** A makeronline.com page: its sign-in cookie, its anti-bot script handing out tokens, and its own puzzle. */
function page(initCaptcha?: (level: number) => Promise<unknown>) {
  let tokens = 0;
  const nuxt: Record<string, unknown> = {
    $ensureNeg: async () => ({ getToken: async () => ({ token: `risk-${++tokens}` }) }),
  };
  if (initCaptcha) nuxt.$initCaptcha = vi.fn(initCaptcha);
  vi.stubGlobal("window", { $nuxt: nuxt });
  vi.stubGlobal("document", { cookie: "lang=en; mo_access_token=jwt.token" });
  vi.stubGlobal("location", {
    protocol: "https:",
    port: "",
    hostname: "www.makeronline.com",
    origin: "https://www.makeronline.com",
  });
  return nuxt;
}

/** Its download call: each answer in turn, the headers of each ask kept. */
function api(...answers: Record<string, unknown>[]) {
  const asks: Record<string, string>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      asks.push(init.headers);
      const answer = answers[Math.min(asks.length - 1, answers.length - 1)];
      return { json: async () => answer };
    }),
  );
  return asks;
}

const PUZZLE = { code: 1003, message: "Please verify", data: { captchaLevel: 1 } };
const SIGNED = { code: 0, message: "ok", data: "https://acop-prod-private.s3.us-east-2.amazonaws.com/f.3mf?X-Amz=1" };

describe("MakerOnline's download call, made in its page", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllGlobals());

  it("asks once with the sign-in and a fresh token", async () => {
    page();
    const asks = api(SIGNED);
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 1000);
    expect(answer).toEqual({ code: 0, message: "ok", data: SIGNED.data });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ Authorization: "jwt.token", "Risk-Token": "risk-1" });
    expect(asks[0]).not.toHaveProperty("Captcha-Validate");
  });

  it("shows the site's own puzzle when it wants one, and asks again with its answer, as its Download does", async () => {
    const nuxt = page(async (level) => `solved-${level}`);
    const asks = api(PUZZLE, SIGNED);
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 1000);
    expect(nuxt.$initCaptcha).toHaveBeenCalledWith(1);
    expect(answer.code).toBe(0);
    expect(asks).toHaveLength(2);
    expect(asks[1]).toMatchObject({ "Captcha-Validate": "solved-1", "Captcha-Level": "1", "Risk-Token": "risk-2" });
  });

  it("gives up on a puzzle not solved in time, and says so", async () => {
    page(() => new Promise(() => undefined));
    const asks = api(PUZZLE, SIGNED);
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 20);
    expect(answer).toMatchObject({ code: 1003, unsolved: true });
    expect(asks).toHaveLength(1);
  });

  it("shows no puzzle where none was asked for, as for imports waiting on the instance", async () => {
    const nuxt = page(async () => "solved");
    api(PUZZLE, SIGNED);
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 0);
    expect(nuxt.$initCaptcha).not.toHaveBeenCalled();
    expect(answer.code).toBe(1003);
    expect(answer.unsolved).toBeUndefined();
  });

  it("shows no puzzle on a page without one", async () => {
    page();
    api(PUZZLE, SIGNED);
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 1000);
    expect(answer.code).toBe(1003);
    expect(answer.unsolved).toBeUndefined();
  });

  it("shows two puzzles at most for one file", async () => {
    const nuxt = page(async (level) => `solved-${level}`);
    const asks = api(PUZZLE, { ...PUZZLE, data: { captchaLevel: 2 } }, { ...PUZZLE, data: { captchaLevel: 3 } });
    const [answer] = await signInPage([REQUEST], 0, "mo_access_token", HOSTS, 1000);
    expect(nuxt.$initCaptcha).toHaveBeenCalledTimes(2);
    expect(asks).toHaveLength(3);
    expect(answer.code).toBe(1003);
  });

  const SECOND: DownloadRequest = { ...REQUEST, name: "Ace overhead 3.3mf", profile_id: "8" };

  it("asks for each file in turn", async () => {
    page();
    const asks = api(SIGNED);
    const answers = await signInPage([REQUEST, SECOND], 0, "mo_access_token", HOSTS, 1000);
    expect(answers.map((answer) => answer.code)).toEqual([0, 0]);
    expect(asks).toHaveLength(2);
  });

  it("stops at a file whose puzzle wasn't solved, asking for no more files and showing no more puzzles", async () => {
    const nuxt = page(() => new Promise(() => undefined));
    const asks = api(PUZZLE, SIGNED);
    const answers = await signInPage([REQUEST, SECOND], 0, "mo_access_token", HOSTS, 20);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ code: 1003, unsolved: true });
    expect(nuxt.$initCaptcha).toHaveBeenCalledTimes(1);
    expect(asks).toHaveLength(1);
  });

  it("stops at a file still wanting a puzzle after two", async () => {
    const nuxt = page(async (level) => `solved-${level}`);
    const asks = api(PUZZLE);
    const answers = await signInPage([REQUEST, SECOND], 0, "mo_access_token", HOSTS, 1000);
    expect(answers).toHaveLength(1);
    expect(nuxt.$initCaptcha).toHaveBeenCalledTimes(2);
    expect(asks).toHaveLength(3);
  });

  it("stops at a file it isn't handed, as when signed out", async () => {
    page();
    const asks = api({ code: -1, message: "Please sign in", data: null }, SIGNED);
    const answers = await signInPage([REQUEST, SECOND], 0, "mo_access_token", HOSTS, 1000);
    expect(answers).toEqual([{ code: -1, message: "Please sign in", data: null }]);
    expect(asks).toHaveLength(1);
  });
});
