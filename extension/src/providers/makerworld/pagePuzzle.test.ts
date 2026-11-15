import { afterEach, describe, expect, it, vi } from "vitest";
import { openPuzzleInPage, type PuzzleAnswer } from "./pagePuzzle";

const CHALLENGE = { captchaId: "c0ffee", apiServers: ["gcaptcha4.geetest.com"] };
const EVENT = "thingport-grab-puzzle-test";

/** A makerworld.com page: its API client's `onRetry`, when given, and what the page reports on EVENT. */
function page(onRetry?: (error: unknown, request: { headers: Record<string, unknown> }) => unknown) {
  const reported: PuzzleAnswer[] = [];
  const answered = new Promise<void>((resolve) => {
    vi.stubGlobal("document", {
      dispatchEvent: (event: CustomEvent<string>) => {
        if (event.type === EVENT) reported.push(JSON.parse(event.detail) as PuzzleAnswer);
        resolve();
        return true;
      },
    });
  });
  vi.stubGlobal("window", onRetry ? { onRetry: vi.fn(onRetry) } : {});
  return { reported, answered };
}

describe("MakerWorld's puzzle, opened in its page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands MakerWorld's client the refusal it shows a puzzle for, and reports the header it answers in", async () => {
    const { reported, answered } = page(async (_error, request) => {
      request.headers["X-BBL-CAPTCHA-RESULT"] = "eyJsb3QiOiIxIn0=";
      return true;
    });
    expect(openPuzzleInPage(CHALLENGE, EVENT)).toBe(true);
    await answered;
    const onRetry = (window as unknown as { onRetry: ReturnType<typeof vi.fn> }).onRetry;
    expect(onRetry).toHaveBeenCalledWith({ status: 418, body: CHALLENGE }, { headers: expect.any(Object) });
    expect(reported).toEqual([{ header: "X-BBL-CAPTCHA-RESULT", value: "eyJsb3QiOiIxIn0=" }]);
  });

  it("reports no answer for a puzzle closed unsolved", async () => {
    const { reported, answered } = page(async () => false);
    openPuzzleInPage(CHALLENGE, EVENT);
    await answered;
    expect(reported).toEqual([null]);
  });

  it("reports no answer where the puzzle fails, or says solved without adding one", async () => {
    const failed = page(async () => {
      throw new Error("geetest failed to load");
    });
    openPuzzleInPage(CHALLENGE, EVENT);
    await failed.answered;
    expect(failed.reported).toEqual([null]);

    const empty = page(async () => true);
    openPuzzleInPage(CHALLENGE, EVENT);
    await empty.answered;
    expect(empty.reported).toEqual([null]);
  });

  it("says so on a page without MakerWorld's client, and opens nothing", () => {
    const { reported } = page();
    expect(openPuzzleInPage(CHALLENGE, EVENT)).toBe(false);
    expect(reported).toEqual([]);
  });
});
