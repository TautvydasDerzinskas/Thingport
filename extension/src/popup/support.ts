// The footer's "Show your love": a dialog with the ways to support Thingport, Buy Me a Coffee first, as the
// repository's README lists them. A native <dialog>, as the confirmation is: focus starts on its close button and
// stays in it, and Esc or a click beside it closes it. Each way opens in a tab of its own.

import { els, opensInTab } from "./dom";

els.loveBtn.addEventListener("click", () => els.loveDialog.showModal());

const close = () => els.loveDialog.close();
els.loveClose.addEventListener("click", close);
els.loveLater.addEventListener("click", close);
// A click on the backdrop lands on the dialog itself, outside its box.
els.loveDialog.addEventListener("click", (event) => {
  if (event.target === els.loveDialog) close();
});

opensInTab(els.loveCoffee);
opensInTab(els.loveSponsors);
