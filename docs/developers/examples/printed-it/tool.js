// @ts-check

// One shared entry per model a user has printed, keyed by the model's id and tied to it, so that the model's copies
// find it too: the same original, or imported from the same page.
const PREFIX = "printed:";

/**
 * Marks models as printed by the user. The name goes with each, so the window can list them without asking for each.
 *
 * @param {import("../thingport").ToolSdk} thingport
 * @param {{ id: string; name: string }[]} models
 */
async function mark(thingport, models) {
  const at = new Date().toISOString();
  for (const { id, name } of models) await thingport.shared.set(`${PREFIX}${id}`, { name, at }, { model: id });
}

/**
 * Both commands: "Mark as printed" under Tools on a model's page, and in a grid's toolbar for the models selected.
 * They have `"window": false` in the metadata, so Thingport calls this instead of opening the window.
 *
 * @param {string} command
 * @param {import("../thingport").ToolSdk} thingport
 */
export async function run(command, thingport) {
  const { context, models, ui, t } = thingport;
  const ids = command === "mark-selection" ? (context.modelIds ?? []) : context.modelId ? [context.modelId] : [];
  const picked = await Promise.all(ids.map((id) => models.get(id)));
  await mark(thingport, picked);
  ui.toast(t("marked", { count: picked.length }), "success", { openWindow: t("open") });
}

/**
 * The part of every model's page, in its info box: a chip saying how many people have printed it, on this copy or
 * another, and a popover saying who and when. It draws nothing while nobody has, so it takes no room.
 *
 * @param {import("../thingport").ToolSdk} thingport
 */
export function modelInfo(thingport) {
  const { root, context, shared, ui, t, language } = thingport;
  const modelId = context.modelId;
  if (!modelId) return;
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
  const chip = document.createElement("button");
  chip.type = "button";
  chip.style.cssText =
    "padding: 2px 10px; border: 1px solid var(--tp-divider); border-radius: 999px; background: var(--tp-paper);" +
    "color: var(--tp-text); font: 12px var(--tp-font); cursor: pointer";
  /** @type {import("../thingport").SdkSharedEntry[]} */
  let entries = [];

  chip.addEventListener("click", () =>
    ui.popover(chip, (box) => {
      box.style.cssText = "padding: 12px; font: 13px var(--tp-font); color: var(--tp-text)";
      box.replaceChildren(
        ...entries.map((entry) => {
          const line = document.createElement("div");
          const who = entry.mine ? t("you") : (entry.user?.name ?? t("someone"));
          const at = new Date(entry.value?.at);
          line.textContent = Number.isNaN(at.getTime()) ? who : `${who} · ${dates.format(at)}`;
          return line;
        }),
      );
    }),
  );

  const draw = async () => {
    entries = await shared.list({ prefix: PREFIX, model: modelId });
    chip.textContent = t("chip", { count: entries.length });
    root.replaceChildren(...(entries.length ? [chip] : []));
  };
  // A command or the window marking the model on this page redraws the chip at once.
  const stop = shared.onChange(() => void draw());
  void draw();
  return stop;
}

/**
 * The window: what the user has marked, to open or unmark, more to add, and whom theirs reach.
 *
 * @param {import("../thingport").ToolSdk} thingport
 */
export default async function mount(thingport) {
  const { root, shared, ui, t, labels } = thingport;
  labels();
  const audience = root.querySelector("button.audience");
  const status = root.querySelector(".status");
  const list = root.querySelector("ul");

  async function showAudience() {
    const { everyone, people } = await shared.audience();
    audience.textContent = everyone ? t("everyone") : t("people", { count: people.length });
  }

  async function showList() {
    const mine = (await shared.list({ prefix: PREFIX })).filter((entry) => entry.mine);
    status.textContent = mine.length ? "" : t("none");
    list.replaceChildren(
      ...mine.map((entry) => {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "name";
        open.textContent = entry.value?.name ?? entry.key;
        open.addEventListener("click", () => ui.openModel(entry.key.slice(PREFIX.length)));
        const unmark = document.createElement("button");
        unmark.type = "button";
        unmark.textContent = t("unmark");
        unmark.addEventListener("click", () => void shared.remove(entry.key));
        const item = document.createElement("li");
        item.append(open, unmark);
        return item;
      }),
    );
  }

  // `share()` is Thingport's own dialog for whom the user's entries reach, and null when they close it.
  audience.addEventListener("click", async () => {
    if (await shared.share()) await showAudience();
  });
  root.querySelector("button.add").addEventListener("click", async () => {
    const picked = await ui.pickModels({ title: t("add"), confirmLabel: t("addConfirm") });
    if (picked.length) await mark(thingport, picked);
  });

  const stop = shared.onChange(() => void showList());
  await Promise.all([showAudience(), showList()]);
  return stop;
}
