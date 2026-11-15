// Clears MakerWorld's CAPTCHA with its own puzzle, for imports someone started on the page: the guided collection run
// (overlays.ts) and the panel's import (panels/single.ts). Imports Grab sends by itself never open one.

import type { ResolvedDownload } from "../../shared/messages";
import { send } from "../../shared/messages";
import { parseMakerworldModelUrl } from "./urls.generated";
import {
  answerRefusal,
  MakerworldCaptchaError,
  type MakerworldPuzzle,
  resolveMakerworldViaApi,
} from "./downloadResolver";
import type { PuzzleAnswer, PuzzleChallenge } from "./pagePuzzle";
import { puzzleGone } from "./puzzleBox";

// A puzzle solved whose answer MakerWorld still refuses gets one more go before it counts as not solved.
const MAX_PUZZLES = 2;
// How long one the page shows already may keep ours waiting.
const PAGE_PUZZLE_MS = 10 * 60 * 1000;
// Only a header of MakerWorld's own kind is sent on: the answer comes from its page.
const ANSWER_HEADER = /^x-[\w-]+$/i;

/** `solved`: the file the answer got, or null where MakerWorld handed none over. `clear`: no puzzle was needed after
 *  all. `unavailable`: there's none to show, so the user is left to do it by hand. */
export type PuzzleOutcome =
  | { kind: "solved"; resolved: ResolvedDownload | null }
  | { kind: "clear"; resolved: ResolvedDownload | null }
  | { kind: "closed" }
  | { kind: "unavailable" };

function parseAnswer(detail: unknown): PuzzleAnswer {
  try {
    const answer = typeof detail === "string" ? (JSON.parse(detail) as unknown) : null;
    if (!answer || typeof answer !== "object") return null;
    const { header, value } = answer as Record<string, unknown>;
    return typeof header === "string" && ANSWER_HEADER.test(header) && typeof value === "string" && value
      ? { header, value }
      : null;
  } catch {
    return null;
  }
}

/** Opens MakerWorld's puzzle in this page and waits for it: its answer, null once it's closed, or "unavailable" where
 *  the page can't show it. */
async function openPuzzle(challenge: PuzzleChallenge): Promise<PuzzleAnswer | "unavailable"> {
  const eventName = `thingport-grab-puzzle-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const answer = new Promise<PuzzleAnswer>((resolve) => {
    document.addEventListener(eventName, (event) => resolve(parseAnswer((event as CustomEvent).detail)), {
      once: true,
    });
  });
  const opened = await send("SHOW_MAKERWORLD_PUZZLE", { challenge, eventName }).catch(() => undefined);
  return opened?.ok && opened.data ? answer : "unavailable";
}

/** Shows the puzzle that clears `puzzle` and goes on with the file once it's solved. A puzzle the page shows already,
 *  for a request of its own or a download someone clicked, isn't this one: its file would be another's, so this opens
 *  once that's gone, rather than over it. */
export async function solveMakerworldPuzzle(puzzle: MakerworldPuzzle): Promise<PuzzleOutcome> {
  let current: MakerworldPuzzle | null = puzzle;
  for (let shown = 0; current && shown < MAX_PUZZLES; shown++) {
    if ("onPage" in current) {
      const downloadUrl = await current.onPage;
      return downloadUrl ? { kind: "solved", resolved: { ...current.target, downloadUrl } } : { kind: "closed" };
    }
    const { refused, target } = current;
    await puzzleGone(PAGE_PUZZLE_MS);
    const answer = await openPuzzle(refused.challenge);
    if (answer === "unavailable") return { kind: "unavailable" };
    if (!answer) return { kind: "closed" };
    try {
      return { kind: "solved", resolved: await answerRefusal(refused, target, answer) };
    } catch (err) {
      if (!(err instanceof MakerworldCaptchaError)) throw err;
      current = err.puzzle;
    }
  }
  return current ? { kind: "closed" } : { kind: "unavailable" };
}

/** For an import started from the panel: opens the puzzle where MakerWorld wants one solved, and goes on with the file
 *  once it is. Where it's closed, or there's none to show, the refusal is thrown as before. */
export async function withMakerworldPuzzle(
  resolve: () => Promise<ResolvedDownload | null>,
  { onOpen, onSolved }: { onOpen: () => void; onSolved: () => void },
): Promise<ResolvedDownload | null> {
  try {
    return await resolve();
  } catch (err) {
    if (!(err instanceof MakerworldCaptchaError) || !err.puzzle) throw err;
    onOpen();
    const outcome = await solveMakerworldPuzzle(err.puzzle);
    if (outcome.kind !== "solved" && outcome.kind !== "clear") throw err;
    onSolved();
    return outcome.resolved;
  }
}

/** The refusal the guided run's last step met on this page, for its paused card to clear. */
let pending: { designId: string | undefined; puzzle: MakerworldPuzzle } | null = null;

/** Kept when a step's resolution on this page is refused with a puzzle. */
export function notePuzzle(pageUrl: string, err: unknown): void {
  if (err instanceof MakerworldCaptchaError && err.puzzle) {
    pending = { designId: parseMakerworldModelUrl(pageUrl)?.designId, puzzle: err.puzzle };
  }
}

/** For the run paused on this page: clears the block its step met, with the puzzle that step was refused with, or,
 *  where none was kept (the instance met it, or the page was loaded again), by asking MakerWorld for the step's file
 *  as its download does, which names the puzzle while the block lasts. `instanceId` is the profile the step is on,
 *  null for the page's own. */
export async function solvePausedStep(pageUrl: string, instanceId: string | null): Promise<PuzzleOutcome> {
  const designId = parseMakerworldModelUrl(pageUrl)?.designId;
  const kept = pending;
  pending = null;
  let puzzle =
    kept && kept.designId === designId && (!instanceId || kept.puzzle.target.instanceId === instanceId)
      ? kept.puzzle
      : null;
  if (!puzzle) {
    try {
      // A file straight away: the block has gone, on its own or solved in another tab. None at all says nothing, and
      // resuming on it could pause again for good: the instance's own cooldown answers as a CAPTCHA.
      const resolved = await resolveMakerworldViaApi(pageUrl, instanceId);
      return resolved ? { kind: "clear", resolved } : { kind: "unavailable" };
    } catch (err) {
      // The daily download limit, say: the step meets it again and stops the run with its own message.
      if (!(err instanceof MakerworldCaptchaError)) return { kind: "clear", resolved: null };
      if (!err.puzzle) return { kind: "unavailable" };
      puzzle = err.puzzle;
    }
  }
  try {
    return await solveMakerworldPuzzle(puzzle);
  } catch {
    return { kind: "clear", resolved: null };
  }
}
