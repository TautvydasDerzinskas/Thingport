// Something just happened that may have earned an achievement (a download, a model a tool or Studio made, a secret):
// the watcher (AchievementWatcher) looks for new ones a moment later, rather than at its next round.

const EVENT = "thingport:achievement-check";

export function requestAchievementCheck(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Hears every request; returns how to stop. */
export function onAchievementCheck(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// The watcher has just shown badges the user hadn't seen, whatever earned them (an import, a sync, a day's visit):
// My models reads its list again, so it has what the toast names.
const FOUND = "thingport:achievements-found";

export function announceAchievementsFound(): void {
  window.dispatchEvent(new Event(FOUND));
}

/** Hears every announcement; returns how to stop. */
export function onAchievementsFound(listener: () => void): () => void {
  window.addEventListener(FOUND, listener);
  return () => window.removeEventListener(FOUND, listener);
}
