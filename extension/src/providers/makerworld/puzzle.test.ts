import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PuzzleAnswer, PuzzleChallenge } from "./pagePuzzle";
import { makerworldModelUrl } from "./urls.generated";

// Clearing MakerWorld's CAPTCHA from its page: its puzzle opened for the request it refused, and that request sent
// again with the answer. The page's puzzle and MakerWorld's API are stand-ins.
const MODEL = makerworldModelUrl("100");
const REFUSED_URL = "https://makerworld.com/api/v1/design-service/instance/10/f3mf?type=download&fileType=";
const CHALLENGE: PuzzleChallenge = { captchaId: "cid-1", apiServers: ["gcaptcha4.geetest.com"] };
const TARGET = { instanceId: "10", design: { id: 100 } };
const FILE = "https://makerworld.bblmw.com/makerworld/model/100/10/file.3mf";
const ANSWER = { header: "X-BBL-CAPTCHA-RESULT", value: "eyJsb3RfbnVtYmVyIjoiMSJ9" };

/** The puzzles the page was asked to open, and how each one goes: the answer it gives, in turn. */
let opened: PuzzleChallenge[] = [];
let answers: (PuzzleAnswer | { header: string; value: string })[] = [];
let pageShowsPuzzles = true;

vi.mock("../../shared/messages", () => ({
  send: vi.fn(async (type: string, payload: { challenge: PuzzleChallenge; eventName: string }) => {
    if (type !== "SHOW_MAKERWORLD_PUZZLE") return { ok: true, data: null };
    if (!pageShowsPuzzles) return { ok: true, data: false };
    opened.push(payload.challenge);
    const answer = answers.shift() ?? null;
    setTimeout(() => document.dispatchEvent(new CustomEvent(payload.eventName, { detail: JSON.stringify(answer) })));
    return { ok: true, data: true };
  }),
}));

/** MakerWorld's API: each answer in turn, the headers of each ask kept. */
let asks: { url: string; headers: Record<string, string> }[] = [];
function api(...replies: { status: number; body: unknown }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers?: Record<string, string> }) => {
      asks.push({ url, headers: init.headers ?? {} });
      const reply = replies[Math.min(asks.length - 1, replies.length - 1)] ?? { status: 500, body: null };
      return { status: reply.status, ok: reply.status < 300, json: async () => reply.body, text: async () => "" };
    }),
  );
}

const { MakerworldCaptchaError } = await import("./downloadResolver");
const { notePuzzle, solveMakerworldPuzzle, solvePausedStep, withMakerworldPuzzle } = await import("./puzzle");

const refusal = (challenge = CHALLENGE) =>
  new MakerworldCaptchaError({ refused: { url: REFUSED_URL, nonce: null, challenge }, target: TARGET });

describe("clearing MakerWorld's CAPTCHA with its own puzzle", () => {
  beforeEach(() => {
    opened = [];
    answers = [];
    asks = [];
    pageShowsPuzzles = true;
    // The page with no puzzle of MakerWorld's own showing, and no page data of its own to read.
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { querySelectorAll: () => [], getElementById: () => null }),
    );
    vi.stubGlobal("location", { href: MODEL });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the puzzle the refusal names and sends the refused request again with its answer", async () => {
    answers = [ANSWER];
    api({ status: 200, body: { name: "file.3mf", url: FILE } });

    const outcome = await solveMakerworldPuzzle(refusal().puzzle!);

    expect(opened).toEqual([CHALLENGE]);
    expect(asks).toHaveLength(1);
    expect(asks[0].url).toBe(REFUSED_URL);
    expect(asks[0].headers).toMatchObject({ "X-BBL-CAPTCHA-RESULT": ANSWER.value });
    expect(outcome).toEqual({ kind: "solved", resolved: { ...TARGET, downloadUrl: FILE } });
  });

  it("asks nothing more of MakerWorld for a puzzle closed unsolved", async () => {
    api({ status: 200, body: { url: FILE } });
    expect(await solveMakerworldPuzzle(refusal().puzzle!)).toEqual({ kind: "closed" });
    expect(asks).toEqual([]);
  });

  it("sends on only a header of MakerWorld's own kind", async () => {
    answers = [{ header: "Cookie", value: "session=stolen" }];
    api({ status: 200, body: { url: FILE } });
    expect(await solveMakerworldPuzzle(refusal().puzzle!)).toEqual({ kind: "closed" });
    expect(asks).toEqual([]);
  });

  it("opens the next puzzle where MakerWorld refuses the answer, and gives up after the second", async () => {
    answers = [ANSWER, ANSWER];
    const again = { captchaId: "cid-2" };
    api({ status: 418, body: again });

    expect(await solveMakerworldPuzzle(refusal().puzzle!)).toEqual({ kind: "closed" });
    expect(opened).toEqual([CHALLENGE, { captchaId: "cid-2", apiServers: undefined, staticServers: undefined }]);
    expect(asks).toHaveLength(2);
  });

  it("waits for a puzzle the page shows already, which isn't this one, then opens its own", async () => {
    answers = [ANSWER];
    api({ status: 200, body: { name: "file.3mf", url: FILE } });
    // One MakerWorld opened itself, for another of its requests or a download clicked by hand.
    let pageShowsOne = true;
    const box = { getBoundingClientRect: () => ({ width: 340, height: 390 }) };
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), {
        querySelectorAll: () => (pageShowsOne ? [box] : []),
        getElementById: () => null,
      }),
    );
    vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible", opacity: "1" }));

    const outcome = solveMakerworldPuzzle(refusal().puzzle!);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(opened).toEqual([]);
    pageShowsOne = false;

    expect(await outcome).toEqual({ kind: "solved", resolved: { ...TARGET, downloadUrl: FILE } });
    expect(opened).toEqual([CHALLENGE]);
    expect(asks.map((ask) => ask.url)).toEqual([REFUSED_URL]);
  });

  it("leaves it to the user where the page can't open MakerWorld's puzzle", async () => {
    pageShowsPuzzles = false;
    expect(await solveMakerworldPuzzle(refusal().puzzle!)).toEqual({ kind: "unavailable" });
  });

  it("takes the file MakerWorld's own puzzle got, where its page opened one", async () => {
    const solved = await solveMakerworldPuzzle({ onPage: Promise.resolve(FILE), target: TARGET });
    expect(solved).toEqual({ kind: "solved", resolved: { ...TARGET, downloadUrl: FILE } });
    expect(await solveMakerworldPuzzle({ onPage: Promise.resolve(null), target: TARGET })).toEqual({
      kind: "closed",
    });
    expect(opened).toEqual([]);
  });

  it("clears a paused step with the refusal that step met on this page", async () => {
    answers = [ANSWER];
    api({ status: 200, body: { url: FILE } });
    notePuzzle(MODEL, refusal());

    expect(await solvePausedStep(MODEL, "10")).toEqual({ kind: "solved", resolved: { ...TARGET, downloadUrl: FILE } });
    expect(opened).toEqual([CHALLENGE]);
  });

  it("doesn't resume on nothing where no refusal was kept and MakerWorld says nothing either", async () => {
    // Kept for another model's page: not this step's.
    notePuzzle(makerworldModelUrl("200"), refusal());
    api({ status: 404, body: null });

    expect(await solvePausedStep(MODEL, "10")).toEqual({ kind: "unavailable" });
    expect(opened).toEqual([]);
  });

  it("goes on with a panel's import once the puzzle is solved, and stops on the refusal where it's closed", async () => {
    answers = [ANSWER];
    api({ status: 200, body: { url: FILE } });
    const onOpen = vi.fn();
    const onSolved = vi.fn();
    const err = refusal();
    const resolve = async () => {
      throw err;
    };

    expect(await withMakerworldPuzzle(resolve, { onOpen, onSolved })).toEqual({ ...TARGET, downloadUrl: FILE });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onSolved).toHaveBeenCalledOnce();

    await expect(withMakerworldPuzzle(resolve, { onOpen, onSolved })).rejects.toBe(err);
    expect(onSolved).toHaveBeenCalledOnce();
  });
});
