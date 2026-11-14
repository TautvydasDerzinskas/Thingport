// MakerWorld's own puzzle, opened in its page. puzzleBackground.ts runs openPuzzleInPage there with chrome.scripting
// (world: "MAIN"), so it must stand on its own: no imports, nothing from outside it but its arguments.

/** What MakerWorld's HTTP 418 names: the Geetest puzzle to show, and where Geetest's servers are. */
export type PuzzleChallenge = { captchaId: string; apiServers?: string[]; staticServers?: string[] };
/** The header MakerWorld puts a solved puzzle's answer in, for the refused request to be sent again with. Null where
 *  the puzzle was closed or failed. */
export type PuzzleAnswer = { header: string; value: string } | null;

/**
 * Runs in the page itself (world: "MAIN"), where MakerWorld's script is. Opens the puzzle the way the site's own API
 * client does for a refused request: `window.onRetry` takes the refusal and the request, shows the Geetest puzzle, and
 * once it's solved puts the answer in one of the request's headers. The answer is reported on `eventName` as a JSON
 * string, so this returns straight away and nothing waits on the user in the background. False where the page has no
 * onRetry.
 */
export function openPuzzleInPage(challenge: PuzzleChallenge, eventName: string): boolean {
  type Request = { headers: Record<string, unknown> };
  const onRetry = (window as unknown as { onRetry?: (error: unknown, request: Request) => unknown }).onRetry;
  if (typeof onRetry !== "function") return false;
  const request: Request = { headers: {} };
  const report = (answer: PuzzleAnswer) =>
    document.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(answer) }));
  Promise.resolve()
    .then(() => onRetry({ status: 418, body: challenge }, request))
    .then(
      (solved) => {
        // Whichever header it added: the request started with none.
        const added = Object.entries(request.headers).find(([, value]) => typeof value === "string" && value);
        report(solved && added ? { header: added[0], value: added[1] as string } : null);
      },
      () => report(null),
    );
  return true;
}
