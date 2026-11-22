import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Long enough to read one, short enough that a run of a few minutes shows several.
const PHRASE_MS = 3500;

type Options = {
  /** Starts anywhere and jumps to another phrase each time, never the same one twice in a row. */
  random?: boolean;
  intervalMs?: number;
};

/** A phrase other than `current`, picked at random from `count`. */
export function nextRandomIndex(current: number, count: number, random: () => number = Math.random): number {
  if (count < 2) return 0;
  const pick = Math.floor(random() * (count - 1));
  return pick >= current % count ? pick + 1 : pick;
}

/** One of the `app` namespace's `key` phrases, moving to the next every few seconds while `running`. */
export function useRotatingPhrase(
  key: string,
  running: boolean,
  { random = false, intervalMs = PHRASE_MS }: Options = {},
) {
  const { t } = useTranslation("app");
  const phrases = t(key, { returnObjects: true }) as string[];
  const count = Array.isArray(phrases) ? phrases.length : 0;
  const [index, setIndex] = useState(() => (random && count > 1 ? Math.floor(Math.random() * count) : 0));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setIndex((current) => (random ? nextRandomIndex(current, count) : current + 1)),
      intervalMs,
    );
    return () => window.clearInterval(timer);
  }, [count, intervalMs, random, running]);

  return count ? phrases[index % count] : "";
}
