// The window: the household's prints on a board, Queued, Printing, Printed and Failed, each person's own to drag
// between columns; and "Add to print queue" from a model's page, which runs without the window.

import {
  ABOUT,
  JOB,
  STATUSES,
  clashes,
  columns,
  isJob,
  listNames,
  moved,
  newId,
  newJob,
  people,
  statusDate,
  summaryOf,
  writesInTurn,
} from "./queue.js";

const MORE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';

const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** A person's colour, from their id, so they look the same on every card. */
function personColour(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 45%)`;
}

function avatar(user) {
  const name = user?.name ?? "?";
  const style = `--pq-person: ${personColour(user?.id ?? name)}`;
  const inner = user?.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" alt="">`
    : escapeHtml(name.trim().slice(0, 1).toUpperCase() || "?");
  return `<span class="pq-av" style="${style}" aria-hidden="true">${inner}</span>`;
}

// Writes to one entry go one after another, so the last change made is the one stored.
const inTurn = writesInTurn();

/** Saved with the model it's about, so others' copies of it find it; without, once that model is gone. */
function saveJob(shared, key, job) {
  return inTurn(key, async () => {
    try {
      await shared.set(key, job, { model: job.modelId });
    } catch (error) {
      if (!/no such model/i.test(error?.message ?? "")) throw error;
      await shared.set(key, job);
    }
  });
}

/**
 * Tells the model's page, and everyone's copies of it, what the user's jobs on it come to: one chip, or none. `read`
 * gives the jobs when it's this one's turn, so the last of several quick changes is what the page shows.
 */
function tellModelPage(shared, modelId, read) {
  return inTurn(`${ABOUT}${modelId}`, async () => summarise(shared, modelId, await read()));
}

async function summarise(shared, modelId, entries) {
  const jobs = entries
    .filter((entry) => entry.mine && entry.key.startsWith(JOB) && isJob(entry.value) && entry.value.modelId === modelId)
    .map((entry) => entry.value);
  const info = summaryOf(jobs);
  const key = `${ABOUT}${modelId}`;
  if (!info) return shared.remove(key);
  try {
    await shared.set(key, { jobs: jobs.length }, { model: modelId, info });
  } catch (error) {
    // A model deleted since has no page to tell.
    if (!/no such model/i.test(error?.message ?? "")) throw error;
    await shared.remove(key);
  }
}

/** "Add to print queue", from a model's page: asks first when someone has the model waiting or printing already. */
export async function run(command, thingport) {
  if (command !== "queue") return;
  const { models, shared, ui, t, context } = thingport;
  const model = await models.get(context.modelId);
  const { others, mine } = clashes(await shared.list({ prefix: JOB, model: model.id }));
  if (others.length || mine.length) {
    const printing = others.filter((entry) => entry.value.status === "printing");
    const title = printing.length
      ? t("dup.printing", { names: listNames(printing, t("and")) })
      : others.length
        ? t("dup.queued", { names: listNames(others, t("and")) })
        : t("dup.mine");
    const message = t(others.length ? "dup.message" : "dup.again", { name: model.name });
    if (!(await ui.confirm({ title, message, confirmLabel: t("dup.add") }))) return;
  }
  const file = model.files.find((candidate) => candidate.id === context.fileId) ?? null;
  await saveJob(shared, `${JOB}${newId()}`, newJob(model, file));
  await tellModelPage(shared, model.id, () => shared.list({ prefix: JOB }));
  ui.toast(t("toast.queued", { name: model.name }), "success");
}

export default function mount(thingport) {
  const { root, shared, models, ui, t, labels, language, context } = thingport;
  const shell = root.querySelector(".pq");
  const board = root.querySelector("#pq-board");
  const empty = root.querySelector("#pq-empty");
  const peopleBar = root.querySelector(".pq-people");
  const shareLabel = root.querySelector("#pq-share-label");

  let entries = null;
  let who = null;
  let here = new Set();
  let editing = null;
  // The note being written, kept apart from the textarea so drawing the board again doesn't lose it.
  let draft = "";
  let menu = null;
  let dragKey = null;
  let scrolled = false;
  let closed = false;
  // Changes made here and saves of them still going: a read of the board one of them may postdate is dropped, as
  // it would put back what was there before.
  let changes = 0;
  let saving = 0;
  let saveFailed = false;
  // Each model's thumbnail and whether the user may open it, read as the user: the address carries their session,
  // so it's never stored in what's shared.
  const looks = new Map();
  const look = (modelId) => {
    if (!looks.has(modelId))
      looks.set(
        modelId,
        models.get(modelId).then(
          (model) => ({ thumbnail: model.thumbnail, readable: true }),
          () => ({ thumbnail: null, readable: false }),
        ),
      );
    return looks.get(modelId);
  };

  const safely =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (error) {
        if (!closed) ui.toast(t("toast.failed", { error: error?.message || String(error) }), "error");
      }
    };

  const dateText = (iso) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return "";
    return at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })
      : at.toLocaleDateString(language, { day: "numeric", month: "short" });
  };

  async function load() {
    const at = changes;
    const [all, about] = await Promise.all([
      shared.list({ prefix: JOB }),
      context.modelId ? shared.list({ prefix: JOB, model: context.modelId }).catch(() => []) : [],
    ]);
    if (closed || saving || at !== changes) return;
    entries = all;
    here = new Set(about.map((entry) => `${entry.user?.id}:${entry.key}`));
    render();
  }
  const refresh = safely(load);

  function renderPeople() {
    const everyone = people(entries ?? []);
    const chip = (id, label, user) =>
      `<button type="button" class="pq-chip${user ? "" : " pq-plain"}" data-who="${escapeHtml(id ?? "")}" aria-pressed="${who === id}">${user ? avatar(user) : ""}<span>${escapeHtml(label)}</span></button>`;
    peopleBar.innerHTML = [
      chip(null, t("board.everyone")),
      ...everyone.map((person) => chip(person.id, person.mine ? t("board.you") : person.name, person)),
    ].join("");
  }

  function card(entry) {
    const job = entry.value;
    const li = document.createElement("li");
    li.className = `pq-card${entry.mine ? " pq-mine" : ""}${here.has(`${entry.user?.id}:${entry.key}`) ? " pq-here" : ""}`;
    li.dataset.key = entry.key;
    li.dataset.status = job.status;
    li.draggable = entry.mine;
    const person = entry.mine ? t("board.you") : (entry.user?.name ?? "");
    const editingThis = editing === entry.key;
    li.innerHTML = `
      <span class="pq-thumb" aria-hidden="true">${escapeHtml(job.name.trim().slice(0, 1).toUpperCase())}</span>
      <span class="pq-body">
        <span class="pq-name" title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</span>
        <span class="pq-meta">${avatar(entry.user)}<span>${escapeHtml(person)} · ${escapeHtml(dateText(statusDate(job)))}${job.fileName ? ` · ${escapeHtml(job.fileName)}` : ""}</span></span>
        ${
          editingThis
            ? `<span class="pq-edit"><textarea aria-label="${escapeHtml(t("note.label"))}" placeholder="${escapeHtml(t("note.placeholder"))}" maxlength="2000">${escapeHtml(draft)}</textarea><div><button type="button" class="pq-cancel">${escapeHtml(t("note.cancel"))}</button><button type="button" class="pq-save">${escapeHtml(t("note.save"))}</button></div></span>`
            : job.note
              ? `<span class="pq-note">${escapeHtml(job.note)}</span>`
              : ""
        }
      </span>
      <button type="button" class="pq-more" aria-haspopup="menu" aria-label="${escapeHtml(t("card.more", { name: job.name }))}">${MORE_ICON}</button>`;
    void look(job.modelId).then(({ thumbnail }) => {
      if (!thumbnail || closed) return;
      const box = li.querySelector(".pq-thumb");
      const img = new Image();
      img.alt = "";
      img.onload = () => box.replaceChildren(img);
      img.src = thumbnail;
    });
    if (editingThis) queueMicrotask(() => li.querySelector("textarea")?.focus());
    return li;
  }

  function render() {
    renderPeople();
    if (entries === null) {
      for (const list of board.querySelectorAll(".pq-list")) list.innerHTML = '<li class="pq-skeleton"></li>'.repeat(2);
      return;
    }
    const cols = columns(entries, who);
    const any = STATUSES.some((status) => cols[status].length);
    empty.hidden = any || who !== null;
    board.hidden = !any && who === null;
    for (const col of board.querySelectorAll(".pq-col")) {
      const jobs = cols[col.dataset.status];
      col.querySelector(".pq-count").textContent = jobs.length ? String(jobs.length) : "";
      const list = col.querySelector(".pq-list");
      list.replaceChildren(...jobs.map(card));
      if (!jobs.length) list.innerHTML = `<li class="pq-none">${escapeHtml(t("board.none"))}</li>`;
    }
    // Opened from a model's page: its cards are outlined, and the first is scrolled to once.
    const first = board.querySelector(".pq-here");
    if (first && !scrolled) {
      scrolled = true;
      first.scrollIntoView({ block: "nearest" });
    }
  }

  const find = (key, mine = true) => entries?.find((entry) => entry.key === key && (!mine || entry.mine));
  const tell = (modelId) => tellModelPage(shared, modelId, () => entries ?? []);

  /** Counts a change made here while `write` stores it; once a failed one's done, the board is read again. */
  async function change(write) {
    changes += 1;
    saving += 1;
    try {
      await write();
    } catch (error) {
      saveFailed = true;
      throw error;
    } finally {
      saving -= 1;
      changes += 1;
      if (!saving && saveFailed) {
        saveFailed = false;
        void refresh();
      }
    }
  }

  /** Saves a job already changed on the board; when that fails, the board goes back to what's stored. */
  const keep = (entry, before, after) =>
    change(async () => {
      try {
        await saveJob(shared, entry.key, after);
      } catch (error) {
        // Unless a later change has taken its place, which is saved after it.
        if (entry.value === after) {
          entry.value = before;
          render();
        }
        throw error;
      }
    });

  const move = safely(async (key, status) => {
    const entry = find(key);
    if (!entry || entry.value.status === status) return;
    const before = entry.value;
    entry.value = moved(before, status);
    render();
    await keep(entry, before, entry.value);
    await tell(entry.value.modelId);
  });

  const remove = safely(async (key) => {
    const entry = find(key);
    if (!entry) return;
    const sure = await ui.confirm({
      title: t("remove.title"),
      message: t("remove.message", { name: entry.value.name }),
      confirmLabel: t("remove.confirm"),
      destructive: true,
    });
    if (!sure) return;
    const { modelId } = entry.value;
    await change(() => inTurn(key, () => shared.remove(key)));
    // By key: the board may have been read again while the question was open.
    entries = entries.filter((other) => !(other.mine && other.key === key));
    render();
    await tell(modelId);
  });

  const saveNote = safely(async (key, note) => {
    const entry = find(key);
    if (!entry) return;
    const before = entry.value;
    const after = { ...before, note: note.trim() };
    entry.value = after;
    endEdit();
    await keep(entry, before, after);
  });

  function closeMenu({ restore = false } = {}) {
    if (!menu) return;
    const { element, opener } = menu;
    element.remove();
    menu = null;
    if (restore) opener?.focus();
  }

  async function openMenu(key, opener) {
    closeMenu();
    const entry = find(key, false);
    if (!entry) return;
    const { readable } = await look(entry.value.modelId);
    const items = [];
    if (entry.mine) {
      for (const status of STATUSES)
        if (status !== entry.value.status) items.push({ label: t(`move.${status}`), act: () => move(key, status) });
      items.push({
        label: t("note.edit"),
        act: () => {
          editing = key;
          draft = entry.value.note;
          render();
        },
      });
    }
    if (readable) items.push({ label: t("card.open"), act: () => ui.openModel(entry.value.modelId) });
    if (entry.mine) items.push("hr", { label: t("remove.confirm"), act: () => remove(key), danger: true });
    if (!items.length) return;
    const element = document.createElement("div");
    element.className = "pq-menu";
    element.setAttribute("role", "menu");
    for (const item of items) {
      if (item === "hr") {
        element.append(document.createElement("hr"));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
      if (item.danger) button.className = "pq-danger";
      button.addEventListener("click", () => {
        closeMenu();
        item.act();
      });
      element.append(button);
    }
    shell.append(element);
    const box = opener.getBoundingClientRect();
    const frame = shell.getBoundingClientRect();
    const left = Math.min(box.right - frame.left - element.offsetWidth, frame.width - element.offsetWidth - 8);
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${box.bottom - frame.top + 4}px`;
    menu = { element, opener };
    element.querySelector("button")?.focus();
  }

  // The bar: whose prints, and whom the user's reach.
  peopleBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-who]");
    if (!button) return;
    who = button.dataset.who || null;
    render();
  });

  const showAudience = (audience) => {
    shareLabel.textContent = audience.everyone
      ? t("share.everyone")
      : audience.people.length
        ? t("share.people", { count: audience.people.length })
        : t("share.onlyYou");
  };
  root.querySelector("#pq-share").addEventListener(
    "click",
    safely(async () => {
      const audience = await shared.share();
      if (audience) showAudience(audience);
    }),
  );

  // The cards: their menus, notes, and dragging the user's own between columns.
  board.addEventListener("click", (event) => {
    const li = event.target.closest(".pq-card");
    if (!li) return;
    if (event.target.closest(".pq-more")) return void openMenu(li.dataset.key, event.target.closest(".pq-more"));
    if (event.target.closest(".pq-save")) return void saveNote(li.dataset.key, li.querySelector("textarea").value);
    if (event.target.closest(".pq-cancel")) endEdit();
  });
  board.addEventListener("input", (event) => {
    if (event.target.matches(".pq-edit textarea")) draft = event.target.value;
  });
  board.addEventListener("dragstart", (event) => {
    const li = event.target.closest(".pq-card.pq-mine");
    if (!li) return;
    dragKey = li.dataset.key;
    li.classList.add("pq-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragKey);
  });
  board.addEventListener("dragend", () => {
    dragKey = null;
    for (const node of board.querySelectorAll(".pq-dragging, .pq-over"))
      node.classList.remove("pq-dragging", "pq-over");
  });
  board.addEventListener("dragover", (event) => {
    const col = event.target.closest(".pq-col");
    if (!col || !dragKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    for (const other of board.querySelectorAll(".pq-over")) if (other !== col) other.classList.remove("pq-over");
    col.classList.add("pq-over");
  });
  board.addEventListener("dragleave", (event) => {
    const col = event.target.closest(".pq-col");
    if (col && !col.contains(event.relatedTarget)) col.classList.remove("pq-over");
  });
  board.addEventListener("drop", (event) => {
    const col = event.target.closest(".pq-col");
    if (!col || !dragKey) return;
    event.preventDefault();
    col.classList.remove("pq-over");
    move(dragKey, col.dataset.status);
  });

  const onOutside = (event) => {
    if (menu && !menu.element.contains(event.target) && !menu.opener.contains(event.target)) closeMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape" && menu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restore: true });
    }
  };
  document.addEventListener("pointerdown", onOutside, true);
  shell.addEventListener("keydown", onKey);

  // Others' changes show up while it's open: now and then, and on coming back to the window. Not in the middle of
  // writing a note, using a menu or dragging; a refresh due then comes once the note is done.
  let due = false;
  const refreshWhenIdle = () => {
    due = Boolean(menu || editing || dragKey);
    if (!due) void refresh();
  };
  function endEdit() {
    editing = null;
    render();
    if (due) refreshWhenIdle();
  }
  const timer = setInterval(refreshWhenIdle, 30000);
  window.addEventListener("focus", refreshWhenIdle);

  labels();
  render();
  void refresh();
  void safely(async () => showAudience(await shared.audience()))();

  return () => {
    closed = true;
    closeMenu();
    clearInterval(timer);
    window.removeEventListener("focus", refreshWhenIdle);
    document.removeEventListener("pointerdown", onOutside, true);
    shell.removeEventListener("keydown", onKey);
  };
}
