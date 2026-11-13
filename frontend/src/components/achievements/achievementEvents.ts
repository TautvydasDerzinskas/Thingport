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
