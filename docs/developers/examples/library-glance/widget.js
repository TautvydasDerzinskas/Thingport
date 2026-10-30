// @ts-check

const COUNTS = ["model_count", "collection_count", "author_count", "category_count"];

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, api, t, onResize } = thingport;
  const grid = root.querySelector(".glance");

  // Four across where the panel is wide enough, two by two where it isn't.
  /** @param {import("../thingport").WidgetSize} size */
  const fit = ({ cols }) => grid.setAttribute("style", `--columns: ${cols >= 4 ? 4 : 2}`);
  fit(thingport.size);
  const stopResizing = onResize(fit);

  let stopped = false;
  (async () => {
    const res = await api("/dashboard/summary");
    if (stopped) return;
    if (!res.ok) {
      grid.innerHTML = `<p class="failed">${t("failed")}</p>`;
      return;
    }
    const summary = await res.json();
    if (stopped) return;
    grid.replaceChildren(
      ...COUNTS.map((key) => {
        const tile = document.createElement("div");
        const value = document.createElement("strong");
        value.textContent = Number(summary[key]).toLocaleString(thingport.language);
        const label = document.createElement("span");
        label.textContent = t(key);
        tile.append(value, label);
        return tile;
      }),
    );
  })();

  return () => {
    stopped = true;
    stopResizing();
  };
}
