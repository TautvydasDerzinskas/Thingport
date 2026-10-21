import { useEffect, useState } from "react";
import { settingsApi, type CardPreview } from "../api/settings";

// Saved on the account so every device shows the same pictures. Shared by every card so there's one request, and a
// switch shows everywhere at once.
let cached: CardPreview | undefined;
let inFlight: Promise<CardPreview> | null = null;
// Bumped on sign-in, so an answer still on its way for the previous account is dropped.
let account = 0;
// Saves go one at a time, so the last pick is the one that sticks.
let saving: Promise<unknown> = Promise.resolve();
let latestSave = 0;
const listeners = new Set<(value: CardPreview) => void>();

function load(): Promise<CardPreview> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  const forAccount = account;
  // A switch made while this is in flight is newer than the server's answer, so it wins.
  const request = settingsApi
    .getCardPreview()
    .then((res) => (forAccount === account ? (cached ??= res.preview) : res.preview))
    .catch((): CardPreview => cached ?? "images")
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

function publish(value: CardPreview) {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** Forgets the previous account's choice; call on sign-in. */
export function resetCardPreview() {
  account++;
  cached = undefined;
  inFlight = null;
  saving = Promise.resolve();
}

/** Null until the saved choice is known, so cards don't flash the wrong picture first. The setter shows the switch
 *  straight away, puts it back if the latest save fails, and rejects with that save's error. */
export function useCardPreview(): [CardPreview | null, (preview: CardPreview) => Promise<void>] {
  const [value, setValue] = useState<CardPreview | null>(cached ?? null);

  useEffect(() => {
    let cancelled = false;
    void load().then((v) => {
      if (!cancelled) setValue(cached ?? v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);

  const update = async (preview: CardPreview) => {
    const previous = cached ?? "images";
    const save = ++latestSave;
    const forAccount = account;
    publish(preview);
    const request = saving.then(() => (forAccount === account ? settingsApi.updateCardPreview(preview) : undefined));
    saving = request.catch(() => undefined);
    try {
      await request;
    } catch (err) {
      // A newer pick, or another account, has taken over; this failure is no longer theirs to hear about.
      if (save !== latestSave || forAccount !== account) return;
      publish(previous);
      throw err;
    }
  };

  return [value, update];
}
