// MakerOnline's download call, made in its own page: only its script there makes the Risk-Token the call needs.
// background.ts runs signInPage there with chrome.scripting (world: "MAIN"), so it must stand on its own: no imports,
// nothing from outside it but its arguments.

/** `supporting`: a file the model keeps beside its own, which the import does without: no puzzle is shown for it, and
 *  one not handed over is passed by. */
export type DownloadRequest = {
  payload: Record<string, unknown>;
  name: string;
  profile_id: string | null;
  supporting?: boolean;
};
/** `unsolved` where MakerOnline's puzzle was shown and not solved in time. */
export type SignAnswer = { code: number | null; message: string | null; data: unknown; unsolved?: boolean };

/** Runs in the page itself (world: "MAIN"), where MakerOnline's script is, so it must stand on its own. Asks the
 *  site's download call for each file, as its Download button does: the sign-in from its cookie, a fresh Risk-Token
 *  from its anti-bot script. Where the site asks for a puzzle first and `puzzleMs` allows, it shows the site's own,
 *  as its Download does, and asks again with the answer; `puzzleMs` is how long the user has to solve it. Ends at the
 *  first file it doesn't hand over, whose answer is the last one returned, bar a supporting file, which is passed by,
 *  as one still unanswered after `supportingMs` is, and every one once the supporting files have taken
 *  `supportingTotalMs` in all, gaps included. */
export async function signInPage(
  requests: DownloadRequest[],
  gapMs: number,
  cookieName: string,
  allowedHosts: readonly string[],
  puzzleMs: number,
  messages: { notOnSite: string; requestFailed: string } = {
    notOnSite: "Not on MakerOnline",
    requestFailed: "Request failed",
  },
  supportingMs = 30_000,
  supportingTotalMs = 60_000,
): Promise<SignAnswer[]> {
  type Neg = { getToken: () => Promise<{ token?: string } | null> };
  const nuxt = (
    window as unknown as {
      $nuxt?: { $ensureNeg?: () => Promise<Neg>; $initCaptcha?: (level: number) => Promise<unknown> };
    }
  ).$nuxt;
  // Its answer when it hands a file over, when it wants a puzzle solved first, and how many it may show for one file.
  const OK = 0;
  const PUZZLE = 1003;
  const MAX_PUZZLES = 2;
  let neg: Neg | null = null;
  try {
    neg = nuxt?.$ensureNeg ? await nuxt.$ensureNeg() : null;
  } catch {
    neg = null;
  }
  const cookie = document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const auth = cookie ? decodeURIComponent(cookie) : "";
  /** One ask, with a fresh Risk-Token, and a solved puzzle's answer where there is one. */
  const askOnce = async (
    request: DownloadRequest,
    puzzle: { validate: string; level: number } | null,
    signal?: AbortSignal,
  ): Promise<SignAnswer> => {
    let risk: string | undefined;
    try {
      risk = (await neg?.getToken())?.token;
    } catch {
      risk = undefined;
    }
    try {
      if (location.protocol !== "https:" || location.port || !allowedHosts.includes(location.hostname)) {
        throw new Error(messages.notOnSite);
      }
      const res = await fetch(new URL("/api/file/download", location.origin).href, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: auth,
          lang: "en",
          ...(risk ? { "Risk-Token": risk } : {}),
          ...(puzzle ? { "Captcha-Validate": puzzle.validate, "Captcha-Level": String(puzzle.level) } : {}),
        },
        body: JSON.stringify(request.payload),
        signal,
      });
      const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown; data?: unknown } | null;
      return {
        code: typeof body?.code === "number" ? body.code : null,
        message: typeof body?.message === "string" ? body.message : null,
        data: body?.data ?? null,
      };
    } catch (err) {
      return { code: null, message: err instanceof Error ? err.message : messages.requestFailed, data: null };
    }
  };
  /** A file beside the model's own is done without, so its ask has a deadline: one the site never answers mustn't hold
   *  up the model's files, which are only handed back once every ask is done. Theirs wait as long as the site takes. */
  const ask = async (
    request: DownloadRequest,
    puzzle: { validate: string; level: number } | null,
    deadlineMs = supportingMs,
  ): Promise<SignAnswer> => {
    if (!request.supporting) return askOnce(request, puzzle);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<SignAnswer>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ code: null, message: messages.requestFailed, data: null });
      }, deadlineMs);
    });
    try {
      return await Promise.race([askOnce(request, puzzle, controller.signal), late]);
    } finally {
      clearTimeout(timer);
    }
  };
  /** The site's own puzzle at `level`, solved: its answer, or null once `puzzleMs` is up. The site never says when
   *  the user closes it, so the wait is all there is. */
  const solve = async (level: number): Promise<string | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), puzzleMs);
    });
    try {
      const answer = await Promise.race([nuxt!.$initCaptcha!(level), late]);
      return typeof answer === "string" && answer ? answer : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const answers: SignAnswer[] = [];
  // Each supporting ask has its own deadline, and all of them one more: twenty the site never answers would otherwise
  // hold up the model's files for ten minutes. One it has no time left for, the gap before it waited out, is passed by
  // unasked, its place kept: asked with no time, it would still reach the site.
  let supportingLeft = supportingTotalMs;
  const passedBy = (): SignAnswer => ({ code: null, message: messages.requestFailed, data: null });
  for (const [index, request] of requests.entries()) {
    if (request.supporting && supportingLeft <= (index > 0 ? gapMs : 0)) {
      answers.push(passedBy());
      continue;
    }
    const started = Date.now();
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const left = supportingLeft - (Date.now() - started);
    if (request.supporting && left <= 0) {
      supportingLeft = 0;
      answers.push(passedBy());
      continue;
    }
    let answer: SignAnswer = await ask(request, null, Math.min(supportingMs, left));
    if (request.supporting) supportingLeft -= Date.now() - started;
    for (let shown = 0; answer.code === PUZZLE && !request.supporting && shown < MAX_PUZZLES; shown++) {
      const level = Number((answer.data as { captchaLevel?: unknown } | null)?.captchaLevel);
      if (!puzzleMs || typeof nuxt?.$initCaptcha !== "function" || !(level > 0)) break;
      const validate = await solve(level);
      if (!validate) {
        answer.unsolved = true;
        break;
      }
      answer = await ask(request, { validate, level });
    }
    answers.push(answer);
    // The import stops at the first file it can't get, so the rest aren't asked for, nor puzzles shown for them. A file
    // beside the model's own is done without.
    if (answer.code !== OK && !request.supporting) break;
  }
  return answers;
}
