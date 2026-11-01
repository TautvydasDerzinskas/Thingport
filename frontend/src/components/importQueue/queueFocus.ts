// A card's action often moves it to another group, where React makes it anew, and focus falls back to the dialog: the
// next Tab would start again from the top. So an action taken by keyboard, or with focus inside its card, takes focus along.

const CARD = "data-queue-card";
const PRIMARY = "data-queue-primary";

/** On a card, so its action can find it again in its new place. */
export const cardMark = (jobId: string) => ({ [CARD]: jobId });
/** On a card's primary button. */
export const primaryMark = { [PRIMARY]: "" };

const cardsIn = (dialog: Element) => Array.from(dialog.querySelectorAll<HTMLElement>(`[${CARD}]`));

function focusCard(card: HTMLElement) {
  (card.querySelector<HTMLElement>(`[${PRIMARY}]`) ?? card).focus();
}

/** Runs what a card's button does, then puts focus on that card's primary button, or on the card when it has none. If
 *  it has left this section, on the card that took its place. Nothing else moves focus, a poll moving a card least of
 *  all, and if focus has gone elsewhere in the dialog by then, it stays there. `detail` is 0 for a click by keyboard. */
export async function keepingFocus(
  event: { detail: number; currentTarget: Element },
  jobId: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = event.currentTarget.closest<HTMLElement>(`[${CARD}]`);
  const dialog = before?.closest('[role="dialog"]');
  if (!before || !dialog || !(event.detail === 0 || before.contains(document.activeElement))) {
    await action();
    return;
  }
  const place = cardsIn(dialog).indexOf(before);
  await action();
  // By the next frame the answer has been drawn.
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && dialog.contains(active) && !before.contains(active)) return;
    const cards = cardsIn(dialog);
    const card = cards.find((other) => other.getAttribute(CARD) === jobId) ?? cards[Math.min(place, cards.length - 1)];
    if (card) focusCard(card);
  });
}
