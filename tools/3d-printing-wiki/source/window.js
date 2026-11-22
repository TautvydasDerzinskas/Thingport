import { byId, guides, materials, searchWiki, terms } from "./articles.js";
import { showExam, newExam, updateAward } from "./exam.js";
import { history } from "./history.js";
import { printers } from "./printers.js";
import { issueGroups } from "./troubleshooting.js";
import { button, node, pageTitle } from "./ui.js";

const defectImages = /* build:images */ {};

const shelves = new Map([
  ["Guides", { intro: "Choose a workflow, set up the slicer and make parts easier to print.", entries: guides }],
  [
    "Troubleshooting",
    {
      intro:
        "Start with what you can see, hear or measure. Each case includes a diagnostic check and a way to verify the fix.",
    },
  ],
  [
    "Materials",
    {
      intro: "Choose by use, then start with the filament maker’s printer and plate recommendations.",
      entries: materials,
    },
  ],
  [
    "Printers",
    {
      intro: "Explore familiar makers and models, and compare the choices that affect what you can print.",
      entries: printers,
    },
  ],
  ["History", { intro: "Explore the people, machines, files and habits that shaped FDM printing.", entries: history }],
  ["Glossary", { intro: "Filament printing terms from anisotropy to Z offset.", entries: terms }],
]);

function picture(entry, className, src) {
  const img = node("img", className);
  img.src = src;
  img.alt = entry.imageAlt;
  img.width = 420;
  img.height = 420;
  img.decoding = "async";
  return img;
}

function entryGrid(entries, open, layout = "", image) {
  const grid = node("div", ["wiki-grid", layout].filter(Boolean).join(" "));
  for (const entry of entries) {
    const card = button("", () => open(entry), "wiki-card");
    if (entry.imageAlt && image) {
      const img = image(entry, layout === "wiki-photos" ? "wiki-card-photo" : "wiki-card-thumb");
      img.loading = "lazy";
      card.append(img);
    }
    const content = node("span", "wiki-card-content");
    const title = node("span", "wiki-card-title", entry.title);
    if (layout === "wiki-results") content.append(node("span", "wiki-category", entry.section));
    content.append(title, node("span", "wiki-muted", entry.summary));
    card.append(content, node("span", "wiki-card-arrow", "↗"));
    card.lastChild.setAttribute("aria-hidden", "true");
    grid.append(card);
  }
  return grid;
}

function overview(open, navigate, image) {
  const section = node("div", "wiki-flow");
  const hero = node("section", "wiki-hero");
  const copy = pageTitle(
    "3D printing, from model to part",
    "A practical wiki for FDM filament printing. Set up your next print, choose a material or diagnose a defect.",
  );
  const actions = node("div", "wiki-actions");
  actions.append(
    button("Find a print defect", () => navigate("Troubleshooting"), "wiki-button wiki-primary"),
    button("Read the first-print guide", () => open(byId.get("first-print")), "wiki-button wiki-hero-secondary"),
  );
  copy.append(actions);
  hero.append(copy, image(byId.get("stringing"), "wiki-hero-image"));
  const common = node("section", "wiki-flow");
  common.append(
    node("h2", null, "Common print defects"),
    entryGrid(
      ["first-layer", "warping", "layer-shift"].map((id) => byId.get(id)),
      open,
      "wiki-photos",
      image,
    ),
  );
  const workflow = node("section", "wiki-flow");
  workflow.append(
    node("h2", null, "Prepare a print"),
    entryGrid(
      ["slicers", "cut-prints", "bridging-guide", "cad"].map((id) => byId.get(id)),
      open,
    ),
  );
  const practical = node("section", "wiki-flow");
  practical.append(
    node("h2", null, "Choose settings for your next print"),
    entryGrid(
      ["key-settings", "layer-height", "shell-settings", "filament-drying"].map((id) => byId.get(id)),
      open,
    ),
  );
  const background = node("section", "wiki-flow");
  background.append(
    node("h2", null, "Printers and their history"),
    entryGrid([byId.get("printer-types"), byId.get("reprap-history"), byId.get("benchy-history")], open),
  );
  section.append(hero, practical, common, workflow, background);
  return section;
}

function troubleshooting(selected, select, open, image) {
  const page = node("section", "wiki-flow");
  const filters = node("div", "wiki-actions");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter by symptom");
  const labels = ["All cases", ...issueGroups.map(({ title }) => title)];
  for (const [index, label] of labels.entries()) {
    const filter = button(label, () => select(index), "wiki-button wiki-filter");
    filter.setAttribute("aria-pressed", String(index === selected));
    filters.append(filter);
  }
  page.append(pageTitle("Troubleshooting", shelves.get("Troubleshooting").intro), filters);
  for (const [index, { title, entries }] of issueGroups.entries()) {
    if (selected && selected !== index + 1) continue;
    const group = node("section", "wiki-flow");
    group.append(node("h2", null, title), entryGrid(entries, open, "wiki-case-grid", image));
    page.append(group);
  }
  return page;
}

function articleBlock(title, content) {
  if (typeof content === "string") return node("p", null, content);
  const block = node("div", "wiki-flow wiki-table-block");
  if (content.text) block.append(node("p", null, content.text));
  const scroll = node("div", "wiki-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", title);
  const table = node("table", "wiki-table");
  table.setAttribute("aria-label", title);
  const head = table.createTHead().insertRow();
  for (const name of content.columns) {
    const label = node("th", null, name);
    label.scope = "col";
    head.append(label);
  }
  const rows = table.createTBody();
  for (const row of content.rows) {
    const tr = rows.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  scroll.append(table);
  block.append(scroll);
  if (content.note) block.append(node("p", "wiki-muted", content.note));
  return block;
}

function detail(entry, open, back, image) {
  const page = node("article", "wiki-flow");
  const heading = pageTitle(entry.title, entry.summary);
  const section = entry.category ? `${entry.section} / ${entry.category}` : entry.section;
  heading.prepend(button("← Back", back, "wiki-button wiki-back"), node("p", "wiki-category", section));
  page.append(heading);

  const body = node("div", entry.imageAlt ? "wiki-detail wiki-has-photo" : "wiki-detail");
  const text = node("div", "wiki-article-copy wiki-flow");

  function addBlock(title, content) {
    const block = node("section");
    block.append(node("h2", null, title), content);
    text.append(block);
  }

  if (entry.fixes) {
    addBlock("How to tell", node("p", null, entry.check));
    addBlock("Why it happens", node("p", null, entry.causes));
    const list = node("ol", "wiki-steps");
    for (const step of entry.fixes) list.append(node("li", null, step));
    addBlock("What to try", list);
    addBlock("Confirm the fix", node("p", null, entry.verify));
  }
  if (entry.uses) {
    addBlock("Where to use it", node("p", null, entry.uses));
    addBlock("How to print it", node("p", null, entry.setup));
    addBlock("Trade-offs", node("p", null, entry.limits));
  }
  for (const [title, description] of entry.blocks ?? []) addBlock(title, articleBlock(title, description));
  body.append(text);

  if (entry.imageAlt) {
    const figure = node("figure", "wiki-figure");
    figure.append(
      image(entry, "wiki-detail-image"),
      node("figcaption", "wiki-muted", "AI-generated example of this print defect."),
    );
    body.prepend(figure);
  }
  if (text.childElementCount) page.append(body);

  if (entry.related.length) {
    const related = node("section", "wiki-flow");
    const links = node("div", "wiki-actions");
    for (const id of entry.related) {
      const target = byId.get(id);
      links.append(button(target.title, () => open(target), "wiki-button wiki-chip"));
    }
    related.append(node("h2", null, "Related reading"), links);
    page.append(related);
  }

  const sources = entry.sources ?? (entry.source ? [["Read the source guide", entry.source]] : []);
  if (sources.length) {
    const references = node("section", "wiki-flow wiki-references");
    const list = node("ul");
    for (const [name, url] of sources) {
      const link = node("a", null, name);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const row = node("li");
      row.append(link);
      list.append(row);
    }
    references.append(node("h2", null, "References"), list);
    page.append(references);
  }
  return page;
}

export default function mount(thingport) {
  const { root } = thingport;
  const input = root.querySelector("[data-wiki-search]");
  const clear = root.querySelector("[data-wiki-clear]");
  const status = root.querySelector("[data-wiki-status]");
  const nav = root.querySelector("[data-wiki-nav]");
  const pane = root.querySelector("[data-wiki-pane]");
  const scroller = root.querySelector("[data-wiki-scroll]");
  if (!input || !clear || !status || !nav || !pane || !scroller) return;
  const template = root.querySelector("[data-wiki-images]");
  const markupImages = new Map(
    Array.from(template?.content.querySelectorAll("img") ?? [], (img) => [img.dataset.case, img.getAttribute("src")]),
  );
  const image = (entry, className) => picture(entry, className, defectImages[entry.id] ?? markupImages.get(entry.id));

  const activity = new AbortController();
  const { signal } = activity;
  const exam = newExam();
  const history = [];
  let shelf = "Overview";
  let entry = null;
  let query = "";
  let issueGroup = 0;

  const navigation = new Map(
    ["Overview", ...shelves.keys(), "Quiz"].map((name) => [name, button(name, () => navigate(name), "wiki-tab")]),
  );
  nav.append(...navigation.values());

  function navigate(name) {
    shelf = name;
    entry = null;
    history.length = 0;
    updateQuery("");
    render(true);
  }

  function open(target, reviewIndex) {
    history.push({ entry, query, reviewIndex });
    entry = target;
    updateQuery("");
    render(true);
  }

  function back() {
    const previous = history.pop();
    entry = previous?.entry ?? null;
    updateQuery(previous?.query ?? "");
    render(true, previous?.reviewIndex);
  }

  function updateQuery(value) {
    input.value = value;
    query = value.trim();
    clear.hidden = !value;
  }

  function selectIssueGroup(group) {
    issueGroup = group;
    render();
    pane.querySelector(".wiki-filter[aria-pressed='true']")?.focus({ preventScroll: true });
  }

  function render(focus = false, reviewIndex) {
    const current = query ? "" : (entry?.section ?? shelf);
    for (const [name, link] of navigation) {
      if (name === current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    let display;
    if (query) {
      const results = searchWiki(query);
      const count = results.length;
      const label = count ? `${count} ${count === 1 ? "result" : "results"}` : "No results";
      status.textContent = label;
      display = node("section", "wiki-flow");
      display.append(
        pageTitle("Search results", `${label} for “${query}”`),
        count
          ? entryGrid(results, open, "wiki-results")
          : node("p", "wiki-empty", "Try a material, a symptom or a shorter term, such as PETG, layer shift or brim."),
      );
    } else {
      status.textContent = "";
      if (entry) display = detail(entry, open, back, image);
      else if (shelf === "Overview") display = overview(open, navigate, image);
      else if (shelf === "Quiz") display = showExam(exam, { open, render, unlock, navigate, image });
      else if (shelf === "Troubleshooting") display = troubleshooting(issueGroup, selectIssueGroup, open, image);
      else {
        const { intro, entries } = shelves.get(shelf);
        display = node("section", "wiki-flow");
        display.append(pageTitle(shelf, intro), entryGrid(entries, open));
      }
    }
    pane.replaceChildren(display);
    scroller.scrollTop = 0;
    if (reviewIndex !== undefined) {
      const article = pane.querySelector(`[data-wiki-review-article="${reviewIndex}"]`);
      if (article) {
        const row = article.closest("details");
        if (row) row.open = true;
        article.focus({ preventScroll: true });
        scroller.scrollTop =
          article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
        return;
      }
    }
    if (focus) pane.querySelector("h1")?.focus({ preventScroll: true });
  }

  async function unlock(result) {
    const { achievements } = thingport;
    if (
      !achievements ||
      signal.aborted ||
      exam.result !== result ||
      exam.awardStatus === "pending" ||
      exam.awardStatus === "earned"
    )
      return;
    setAwardStatus("pending");
    let outcome;
    try {
      outcome = achievements.unlockWithStatus
        ? await achievements.unlockWithStatus("fundamentals")
        : (await achievements.unlock("fundamentals"))
          ? "earned"
          : "unavailable";
    } catch {
      outcome = "retry";
    }
    if (!signal.aborted && exam.result === result) setAwardStatus(outcome);
  }

  function setAwardStatus(outcome) {
    exam.awardStatus = outcome;
    const award = pane.querySelector("[data-wiki-award]");
    if (award) updateAward(award, outcome);
  }

  input.addEventListener(
    "input",
    () => {
      updateQuery(input.value);
      render();
    },
    { signal },
  );
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
      }
      if (event.key === "Enter" && query) {
        event.preventDefault();
        pane.querySelector("h1")?.focus();
      }
    },
    { signal },
  );
  clear.addEventListener("click", clearSearch, { signal });

  function clearSearch() {
    updateQuery("");
    render();
    input.focus();
  }

  render();
  return () => activity.abort();
}
