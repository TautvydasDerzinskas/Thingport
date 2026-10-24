import { send } from "../shared/messages";
import { els } from "./dom";
import { providerLogo, providerName } from "./sites";
import { thumbLink } from "./thumbs";

export async function loadRecentImports(): Promise<void> {
  const res = await send("GET_RECENT_IMPORTS");
  if (!res?.ok || !res.data.length) {
    els.recentSection.hidden = true;
    return;
  }
  els.recentGrid.replaceChildren(
    ...res.data.map((item) => {
      const link = thumbLink({
        url: item.url,
        title: item.title,
        image: item.image,
        label: "Imported model",
        badge: item.provider ? providerLogo(item.provider) : undefined,
      });
      if (item.provider) link.title = `${item.title ?? "Model"} · from ${providerName(item.provider)}`;
      return link;
    }),
  );
  els.recentSection.hidden = false;
}
