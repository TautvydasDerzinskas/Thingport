// The History tab's "Recently viewed": the last model pages opened on any site Grab runs on.

import { send } from "../shared/messages";
import { clearError, els, showError } from "./dom";
import { providerLogo, providerName } from "./sites";
import { thumbLink } from "./thumbs";

export async function loadRecentlyViewed(): Promise<void> {
  const res = await send("GET_RECENTLY_VIEWED");
  const models = res?.ok ? res.data : [];
  els.viewedGrid.replaceChildren(
    ...models.map((model) => {
      const logo = providerLogo(model.provider);
      logo.setAttribute("aria-hidden", "true");
      const link = thumbLink({
        url: model.url,
        title: model.title,
        image: model.image,
        label: `Model on ${providerName(model.provider)}`,
        badge: logo,
      });
      link.title = `${model.title ?? "Model"} · ${providerName(model.provider)}`;
      return link;
    }),
  );
  els.viewedGrid.hidden = !models.length;
  els.viewedEmpty.hidden = Boolean(models.length);
  els.viewedClearWrap.hidden = !models.length;
}

els.viewedClear.addEventListener("click", async () => {
  clearError(els.historyError);
  const res = await send("CLEAR_RECENTLY_VIEWED");
  if (!res?.ok) showError(res?.error ?? "Couldn't clear", els.historyError);
  await loadRecentlyViewed();
});
