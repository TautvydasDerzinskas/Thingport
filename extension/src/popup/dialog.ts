// A click beside a modal <dialog> lands on the dialog itself, but so does one on its padding, so only a press outside
// its box counts. It has to start outside too: a text selection dragged out of the dialog ends in a click on it.

type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

const isOutside = (box: Box, { clientX: x, clientY: y }: MouseEvent) =>
  x < box.left || x > box.right || y < box.top || y > box.bottom;

/** Calls `close` when a press both starts and ends on `dialog`'s backdrop. */
export function closeOnBackdrop(dialog: HTMLDialogElement, close: () => void): void {
  const onBackdrop = (event: MouseEvent) => event.target === dialog && isOutside(dialog.getBoundingClientRect(), event);
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = onBackdrop(event);
  });
  dialog.addEventListener("click", (event) => {
    if (pressedOutside && onBackdrop(event)) close();
    pressedOutside = false;
  });
}
