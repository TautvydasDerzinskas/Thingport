// A card's action often moves it to another group, where React makes it anew, and focus falls back to the dialog: the
// next Tab would start again from the top. So an action taken by keyboard, or with focus inside its card, takes focus
// along.

const CARD = "data-queue-card";
const PRIMARY = "data-queue-primary";
const HEADING = "data-queue-heading";

/** On a card, so its action can find it again in its new place. */
export const cardMark = (jobId: string) => ({ [CARD]: jobId });
/** On a card's primary button. */
export const primaryMark = { [PRIMARY]: "" };
/** On the panel's heading, for when nothing else is left to go to. */
export const headingMark = { [HEADING]: "", tabIndex: -1 };

const cardsIn = (dialog: Element) => Array.from(dialog.querySelectorAll<HTMLElement>(`[${CARD}]`));

function focusCard(card: HTMLElement) {
  (card.querySelector<HTMLElement>(`[${PRIMARY}]`) ?? card).focus();
}

function focusHeading(dialog: Element) {
  dialog.querySelector<HTMLElement>(`[${HEADING}]`)?.focus();
}

/** The card now at `place`, or the last one if that's past the end. */
function focusPlace(dialog: Element, place: number) {
  const cards = cardsIn(dialog);
  const card = cards[Math.min(place, cards.length - 1)];
  if (card) focusCard(card);
  else focusHeading(dialog);
}

/** Fallen back to what's around the dialog, the page's body at most. */
function focusFellFrom(dialog: Element) {
  const active = document.activeElement;
  return !active || active.contains(dialog);
}

/** Runs what a card's button does, then puts focus on that card's primary button, or on the card when it has none. If
 *  it has left this section, on the card that took its place, or the panel's heading with no card left. Nothing else
 *  moves focus, a poll moving a card least of all, and if focus has gone anywhere else by then, a menu or another card,
 *  it stays there. `detail` is 0 for a click by keyboard. */
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
    if (!focusFellFrom(dialog) && !before.contains(document.activeElement)) return;
    const card = cardsIn(dialog).find((other) => other.getAttribute(CARD) === jobId);
    if (card) focusCard(card);
    else focusPlace(dialog, place);
  });
}

/** For Delete, whose menu and confirmation are portaled out of the card, so nothing they're clicked on can find it. The
 *  card that takes its place gets focus, if it has fallen back by then. */
export async function focusingCardAfter(card: Element | null, action: () => Promise<unknown>): Promise<void> {
  const dialog = card?.closest('[role="dialog"]');
  if (!card || !dialog) {
    await action();
    return;
  }
  const place = cardsIn(dialog).indexOf(card as HTMLElement);
  await action();
  requestAnimationFrame(() => {
    if (focusFellFrom(dialog)) focusPlace(dialog, place);
  });
}

/** For a panel's bulk button, which goes away or turns off once its section has nothing left for it. Focus comes back to
 *  it if it's still there to press, and otherwise goes to the panel's heading. */
export async function keepingPanelFocus(event: { currentTarget: Element }, action: () => Promise<unknown>) {
  const button = event.currentTarget as HTMLButtonElement;
  const dialog = button.closest('[role="dialog"]');
  await action();
  if (!dialog) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== button && !focusFellFrom(dialog)) return;
    if (button.isConnected && !button.disabled) button.focus();
    else focusHeading(dialog);
  });
}
