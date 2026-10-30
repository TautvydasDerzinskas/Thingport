// @ts-check

// How far it looks: the library is read a page at a time, and a big one doesn't need reading to the end at once.
const PAGE = 200;
const MOST = 2000;

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, models, storage, ui, t, labels } = thingport;
  labels();

  const form = root.querySelector("form");
  const input = form.querySelector("input");
  const recent = root.querySelector(".recent");
  const status = root.querySelector(".status");
  const list = root.querySelector("ul");
  let closed = false;

  /** @type {string[]} */
  let recentTags = (await storage.get("recent")) ?? [];
  showRecent();

  /** @type {import("../thingport").SdkModel[]} */
  const untagged = [];
  // Not awaited: the cleanup below has to be returned while this is still reading, or closing the window
  // couldn't stop it.
  (async () => {
    for (let offset = 0; offset < MOST && !closed; offset += PAGE) {
      const page = await models.list({ limit: PAGE, offset });
      untagged.push(...page.models.filter((model) => !model.tags.length && !model.toolOwned));
      if (!page.hasMore) break;
    }
    if (!closed) showList();
  })().catch((error) => {
    status.textContent = t("failed", { reason: error.message });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tags = input.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const ticked = [...list.querySelectorAll("input:checked")].map((box) => box.getAttribute("value"));
    if (!tags.length || !ticked.length) {
      ui.toast(t("nothing"), "info");
      return;
    }
    if (ticked.length > 10) {
      const sure = await ui.confirm({
        title: t("confirmTitle"),
        message: t("confirmMessage", { count: ticked.length, tags: tags.join(", ") }),
        confirmLabel: t("apply"),
      });
      if (!sure) return;
    }
    for (const id of ticked) await models.update(id, { tags });
    ui.toast(t("done", { count: ticked.length }), "success");
    recentTags = [...new Set([...tags, ...recentTags])].slice(0, 12);
    await storage.set("recent", recentTags);
    untagged.splice(0, untagged.length, ...untagged.filter((model) => !ticked.includes(model.id)));
    input.value = "";
    showRecent();
    showList();
  });

  function showList() {
    status.textContent = untagged.length ? t("found", { count: untagged.length }) : t("allTagged");
    list.replaceChildren(
      ...untagged.map((model) => {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = model.id;
        const label = document.createElement("label");
        label.append(box, model.name);
        const item = document.createElement("li");
        item.append(label);
        return item;
      }),
    );
  }

  function showRecent() {
    recent.replaceChildren(
      ...recentTags.map((tag) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = tag;
        button.title = t("add", { tag });
        button.addEventListener("click", () => {
          input.value = input.value.trim() ? `${input.value}, ${tag}` : tag;
          input.focus();
        });
        return button;
      }),
    );
  }

  return () => {
    closed = true;
  };
}
