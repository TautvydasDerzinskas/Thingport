import { ago, confirmRemove, noteId, onNotesChange, readNotes } from "./notes.js";
import { NOTE_SVG, UI_CSS, el, icon, menuButton, openMenu, themed } from "./ui.js";

// The window: every note the user wrote, as sticky notes in their own colours, to search and tidy up.

const PAGE = 40;

export default function mount(thingport) {
  const { root, labels, models, t, ui, language } = thingport;
  themed(thingport, root.querySelector(".tpn-board"));
  const style = el("style");
  style.textContent = UI_CSS;
  root.prepend(style);
  const search = root.querySelector("input");
  const count = root.querySelector(".tpn-count");
  const cards = root.querySelector(".tpn-cards");
  const state = root.querySelector(".tpn-state");
  const more = root.querySelector(".tpn-more");
  const modelsById = new Map();
  let alive = true;
  let revision = 0;
  let shown = PAGE;
  let notes = [];
  let loading = true;
  let failed = false;

  labels();

  function showState(kind) {
    state.hidden = !kind;
    if (!kind) return state.replaceChildren();
    const message = el("p", "", t("board." + kind));
    if (kind === "loading") message.className = "tpn-sr";
    if (kind === "empty") {
      const picture = el("span", "tpn-state-picture");
      picture.innerHTML = NOTE_SVG;
      picture.setAttribute("aria-hidden", "true");
      return state.replaceChildren(picture, message);
    }
    if (kind === "error") {
      const retry = el("button", "tpn-btn", t("board.retry"));
      retry.addEventListener("click", load);
      return state.replaceChildren(message, retry);
    }
    state.replaceChildren(message);
  }

  async function remove(note) {
    try {
      if (!(await confirmRemove(thingport, note)) || !alive) return;
      notes = notes.filter((other) => noteId(other) !== noteId(note));
      render();
    } catch {
      if (alive) ui.toast(t("board.deleteFailed"), "error");
    }
  }

  function card(note) {
    const model = modelsById.get(note.modelId);
    const article = el("article", "tpn-card tpn-c-" + note.value.color);
    const head = el("div", "tpn-card-head");
    const link = el("button", "tpn-model");
    const thumbnail = el("span", "tpn-thumb");
    thumbnail.setAttribute("aria-hidden", "true");
    const name = model?.name ?? t("board.unavailable");
    if (model?.thumbnail) {
      const image = el("img");
      image.src = model.thumbnail;
      image.alt = "";
      image.loading = "lazy";
      thumbnail.append(image);
    } else thumbnail.textContent = Array.from(name)[0] ?? "–";
    link.append(thumbnail, el("span", "tpn-model-name", name));
    link.disabled = !model;
    if (model) link.addEventListener("click", () => models.open(model.id));
    const actions = el("button", "tpn-icon-btn");
    actions.append(icon("more"));
    actions.setAttribute("aria-label", t("note.actions"));
    actions.title = t("note.actions");
    const { wrap, anchor } = menuButton(actions);
    const menu = () =>
      openMenu(thingport, actions, anchor, [
        {
          icon: "open",
          label: t("board.openModel"),
          action: () => models.open(model.id),
          disabled: !model,
          title: model ? undefined : t("board.unavailable"),
        },
        { divider: true },
        { icon: "delete", label: t("note.delete"), danger: true, action: () => remove(note) },
      ]);
    actions.addEventListener("click", menu);
    article.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      menu();
    });
    head.append(link, wrap);
    const foot = el("footer", "tpn-card-foot");
    foot.append(
      icon(note.public ? "globe" : "lock"),
      el("span", "", t(note.public ? "visibility.public" : "visibility.personal")),
    );
    const when = note.updatedAt && ago(note.updatedAt, language, t("time.now"));
    if (when) foot.append(el("span", "", "· " + when));
    article.append(head, el("p", "tpn-card-text", note.value.text), foot);
    return article;
  }

  function render() {
    more.hidden = true;
    count.hidden = loading || failed;
    count.textContent = String(notes.length);
    cards.setAttribute("aria-busy", String(loading));
    if (loading) {
      cards.replaceChildren(
        ...Array.from({ length: 6 }, () => {
          const placeholder = el("div", "tpn-card tpn-skeleton");
          placeholder.setAttribute("aria-hidden", "true");
          return placeholder;
        }),
      );
      return showState("loading");
    }
    if (failed) {
      cards.replaceChildren();
      return showState("error");
    }
    const query = search.value.trim().toLocaleLowerCase(language);
    const filtered = notes.filter((note) =>
      [note.value.text, modelsById.get(note.modelId)?.name].some((text) =>
        text?.toLocaleLowerCase(language).includes(query),
      ),
    );
    cards.replaceChildren(...filtered.slice(0, shown).map(card));
    showState(filtered.length ? null : query ? "noMatches" : "empty");
    more.hidden = shown >= filtered.length;
  }

  async function load() {
    const run = ++revision;
    const first = !notes.length;
    loading = first;
    failed = false;
    render();
    try {
      const incoming = await readNotes(thingport);
      const missing = [...new Set(incoming.map((note) => note.modelId))].filter((id) => id && !modelsById.has(id));
      for (let i = 0; i < missing.length && alive && revision === run; i += 8) {
        await Promise.all(
          missing.slice(i, i + 8).map(async (id) => {
            try {
              modelsById.set(id, await models.get(id));
            } catch {
              // Leave failed lookups uncached so the next load can try again.
            }
          }),
        );
      }
      if (!alive || revision !== run) return;
      notes = incoming;
      loading = false;
      // Cards rise in on the first fill only, not on every keystroke of a search.
      if (first) {
        cards.classList.add("tpn-entering");
        setTimeout(() => cards.classList.remove("tpn-entering"), 400);
      }
      render();
    } catch {
      if (!alive || revision !== run) return;
      loading = false;
      failed = !notes.length;
      if (failed) render();
      else ui.toast(t("board.error"), "error");
    }
  }

  search.addEventListener("input", () => {
    shown = PAGE;
    render();
  });
  more.addEventListener("click", () => {
    shown += PAGE;
    render();
  });
  const stop = onNotesChange(thingport, load);
  void load();
  return () => {
    alive = false;
    stop();
  };
}
