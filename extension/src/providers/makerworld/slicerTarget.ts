// The instance's slicer for the "Download normalized" button, asked for once per mounted button. The button shows
// before the answer and its explanation uses whatever is known, but a click waits for it: the slicer decides which copy
// is made, and taking the flat one just because the answer hadn't come yet would hand a Snapmaker Orca user the wrong
// file. The wait is capped at SLICER_ANSWER_TIMEOUT_MS: an instance that never answers counts as no slicer (the
// flat copy), so the local download never hangs on it.

import { normalizeTargetFor } from "../../shared/slicers";

const SLICER_ANSWER_TIMEOUT_MS = 5000;

let known: string | null = null;
let pending: Promise<string | null> = Promise.resolve(null);
// Bumped on every lookup and reset, so an answer for a button that's gone doesn't land on the next one.
let generation = 0;

/** Starts asking; a failed answer counts as no slicer. */
export function lookUpSlicer(ask: () => Promise<string | null>): Promise<string | null> {
  const mine = ++generation;
  known = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SLICER_ANSWER_TIMEOUT_MS);
  });
  pending = Promise.race([ask().catch(() => null), timedOut])
    .finally(() => clearTimeout(timer))
    .then((slicer) => {
      // Only the shared state is guarded: a click already waiting on this answer still gets it.
      if (mine === generation) known = slicer;
      return slicer;
    });
  return pending;
}

/** The slicer as far as it's known right now, null until the instance has answered. */
export function knownSlicer(): string | null {
  return known;
}

/** Which copy a download makes, once the instance has answered. */
export async function downloadTarget(): Promise<"flat" | "orca"> {
  return normalizeTargetFor(await pending);
}

export function forgetSlicer(): void {
  generation++;
  known = null;
  pending = Promise.resolve(null);
}
