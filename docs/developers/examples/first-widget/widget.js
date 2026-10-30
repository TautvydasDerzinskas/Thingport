// @ts-check

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, settings, models, ui, t, labels } = thingport;
  labels(); // every data-t in widget.html, in the user's language

  const status = root.querySelector(".status");
  const list = root.querySelector("ul");
  // The panel can be redrawn before the list arrives (a setting changed, the theme switched): then it's not ours.
  let stopped = false;

  /** @param {import("../thingport").SdkModel} model */
  function card(model) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = model.name;
    button.addEventListener("click", () => ui.openModel(model.id));
    if (model.thumbnail) {
      const picture = document.createElement("img");
      picture.src = model.thumbnail;
      picture.alt = "";
      button.append(picture);
    }
    const name = document.createElement("span");
    name.textContent = model.name;
    button.append(name);
    const item = document.createElement("li");
    item.append(button);
    return item;
  }

  async function show() {
    try {
      const page = await models.list({
        tags: settings.tag ? [settings.tag] : undefined,
        limit: Number(settings.count),
      });
      if (stopped) return;
      status.textContent = page.models.length ? "" : t("empty");
      list.replaceChildren(...page.models.map(card));
    } catch (error) {
      if (!stopped) status.textContent = t("failed", { reason: error.message });
    }
  }

  show();
  return () => {
    stopped = true;
  };
}
