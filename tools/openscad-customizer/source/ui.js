// The customizer's window: the script's own parameters on the left, what they make on the right.
//
// A model generated from a script can be generated again here with other values -- other text, other sizes,
// other options -- and saved back into the library. Nothing is sent anywhere: the engine runs in this tab.

import {
  changedValues,
  chosenFiles,
  controlFor,
  defaultValues,
  generatedName,
  groupParameters,
  readyScript,
  readableWarnings,
  scriptsAmong,
  uploadName,
} from "./script.js";
import { createViewer } from "./viewer.js";

export default async function mount(thingport) {
  const { root, theme, models, ui, t, labels, library, context } = thingport;
  const $ = (id) => root.querySelector(`#osc-${id}`);
  const shell = root.querySelector(".osc");

  for (const [name, value] of Object.entries({
    bg: theme.background,
    panel: theme.paper,
    divider: theme.divider,
    text: theme.text,
    muted: theme.textSecondary,
    accent: theme.primary,
    "accent-ink": theme.primaryContrast ?? "#ffffff",
    danger: theme.error,
    font: theme.fontFamily,
  })) {
    shell.style.setProperty(`--${name}`, value);
  }
  // The side-by-side layout folds when the window is narrow, which it can be without the page being.
  shell.style.containerType = "inline-size";

  const viewer = createViewer($("view"), { library, theme });

  /** What is loaded: the script's text, where it came from, its parameters and the reader's values. */
  let current = null;
  let generated = null;
  let busy = false;

  // ---- loading a script --------------------------------------------------------------------------------------

  /** Whatever went wrong reading a model's files, said in the window rather than only in the console. */
  const unreadable = (err) => ui.toast(t("error.unreadable", { reason: err.message }), "error");

  async function loadScript({ text: raw, name, from }) {
    setBusy(true, t("busy.reading"));
    try {
      const text = readyScript(raw);
      const openscad = await library("openscad");
      const { parameters } = await openscad.parameters(text);
      // Only a script with a typeface to pick pays for the list of them.
      const fonts = parameters.some((parameter) => parameter.widget === "font") ? (await library("fonts")).list : [];
      current = { text, name, from, parameters, fonts, values: defaultValues(parameters), uploads: new Map() };
      $("name").textContent = name;
      $("where").textContent = from ? t("bar.fromModel", { model: from.name }) : t("bar.fromFile");
      buildForm();
      $("empty").hidden = true;
      enable(true);
      await generate();
    } catch (err) {
      unreadable(err);
      setBusy(false);
    }
  }

  async function loadFromModel(model) {
    const related = await models.relatedFiles(model.id);
    const scripts = scriptsAmong(related);
    if (!scripts.length) {
      ui.toast(t("error.noScript", { model: model.name }), "warning");
      return;
    }
    const picker = $("script");
    picker.hidden = scripts.length < 2;
    picker.replaceChildren(
      ...scripts.map((file) => {
        const option = document.createElement("option");
        option.value = file.id;
        option.textContent = file.name;
        return option;
      }),
    );
    const choose = async (fileId) => {
      const file = scripts.find((s) => s.id === fileId) ?? scripts[0];
      const text = await models.relatedText(model.id, file.id);
      await loadScript({ text, name: file.name, from: model });
    };
    // Reading a file can fail on a network error or a file that went: said out loud rather than left as an
    // unhandled rejection with the window looking as though nothing happened.
    picker.onchange = () => void choose(picker.value).catch(unreadable);
    await choose(scripts[0].id);
  }

  // ---- the form ----------------------------------------------------------------------------------------------

  function buildForm() {
    const side = $("side");
    side.replaceChildren();
    const groups = groupParameters(current.parameters);
    if (!groups.length) {
      const empty = document.createElement("div");
      empty.className = "osc-fields osc-sub";
      empty.textContent = t("form.noParameters");
      side.append(empty);
      return;
    }
    groups.forEach((group, index) => {
      const details = document.createElement("details");
      details.className = "osc-group";
      // The first group open, the rest folded: a script with sixteen groups is otherwise a wall.
      details.open = index === 0 || groups.length <= 3;
      const summary = document.createElement("summary");
      summary.textContent = group.name;
      details.append(summary);
      const fields = document.createElement("div");
      fields.className = "osc-fields";
      for (const parameter of group.parameters) fields.append(fieldFor(parameter));
      details.append(fields);
      side.append(details);
    });
  }

  function fieldFor(parameter) {
    const field = document.createElement("div");
    field.className = "osc-field";

    const label = document.createElement("div");
    label.className = "osc-label";
    const name = document.createElement("span");
    name.className = "osc-name";
    name.textContent = parameter.name;
    label.append(name);

    const shown = document.createElement("span");
    shown.className = "osc-value";
    label.append(shown);

    if (parameter.caption) {
      // Behind a `?` rather than under the control: the explanations are the author's sentences, and a column of
      // them buries the parameters themselves.
      const help = document.createElement("button");
      help.type = "button";
      help.className = "osc-help";
      help.textContent = "?";
      help.title = parameter.caption;
      help.setAttribute("aria-label", parameter.caption);
      label.append(help);
    }
    field.append(label);

    // A typeface and a file say what they hold in the control itself.
    const showsItself = ["font", "file"].includes(controlFor(parameter).kind);
    const set = (value) => {
      current.values[parameter.name] = value;
      shown.textContent = typeof value === "boolean" || showsItself ? "" : String(value);
      $("generate").disabled = busy;
    };
    field.append(controlElement(parameter, set));
    set(current.values[parameter.name]);
    return field;
  }

  function controlElement(parameter, set) {
    const control = controlFor(parameter);
    const value = current.values[parameter.name];

    if (control.kind === "segmented") {
      const group = document.createElement("div");
      group.className = "osc-segmented";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", parameter.name);
      const buttons = control.options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(option.name);
        button.title = String(option.name);
        button.setAttribute("aria-pressed", String(option.value === value));
        button.onclick = () => {
          for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
          set(option.value);
        };
        return button;
      });
      group.append(...buttons);
      return group;
    }

    if (control.kind === "select") {
      const select = document.createElement("select");
      select.setAttribute("aria-label", parameter.name);
      select.replaceChildren(
        ...control.options.map((option) => {
          const element = document.createElement("option");
          element.value = String(option.value);
          element.textContent = String(option.name);
          element.selected = option.value === value;
          return element;
        }),
      );
      select.onchange = () => set(control.options[select.selectedIndex].value);
      return select;
    }

    if (control.kind === "switch") {
      const wrap = document.createElement("label");
      wrap.className = "osc-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      // Compared as text so a boolean value still matches a "true"/"false" choice; anything matching neither
      // reads as off rather than guessing.
      input.checked = String(value) === String(control.on.value);
      input.onchange = () => set(input.checked ? control.on.value : control.off.value);
      wrap.append(input, document.createTextNode(parameter.name));
      wrap.querySelector("input").setAttribute("aria-label", parameter.name);
      return wrap;
    }

    if (control.kind === "slider") {
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.value = String(value);
      input.setAttribute("aria-label", parameter.name);
      // On input while dragging so the number keeps up; the model is only rendered when asked for.
      input.oninput = () => set(Number(input.value));
      return input;
    }

    if (control.kind === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = String(value).toLowerCase();
      input.title = t("form.pickColor");
      input.setAttribute("aria-label", `${parameter.name}: ${t("form.pickColor")}`);
      input.oninput = () => set(input.value);
      return input;
    }

    if (control.kind === "font") return fontElement(parameter, value, set);
    if (control.kind === "file") return fileElement(parameter, control, value, set);

    const input = document.createElement("input");
    input.type = control.kind === "number" ? "number" : "text";
    if (control.kind === "number") input.step = String(control.step);
    input.value = control.kind === "vector" ? JSON.stringify(value) : String(value);
    input.setAttribute("aria-label", parameter.name);
    input.oninput = () => {
      if (control.kind === "number") set(Number(input.value));
      else if (control.kind === "vector") {
        try {
          set(JSON.parse(input.value));
        } catch {
          // Left as it was until the brackets balance again.
        }
      } else set(input.value);
    };
    return input;
  }

  /**
   * A typeface, from the ones Thingport carries. A script may start on one that isn't here: it stays in the list under
   * its own name, saying what it comes out in instead, rather than the field quietly claiming something else.
   */
  function fontElement(parameter, value, set) {
    const fonts = current.fonts;
    const select = document.createElement("select");
    select.setAttribute("aria-label", parameter.name);
    const optionOf = (label, name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = label;
      return option;
    };
    if (!fonts.some((font) => font.name === value)) {
      // A style after the family, "PT Sans:style=Bold", is still that family.
      const family = String(value).split(":")[0].trim();
      const carried = fonts.some((font) => font.name === family);
      select.append(
        optionOf(carried ? value : t("form.fontFallback", { name: value, fallback: fonts[0]?.name }), value),
      );
    }
    const groups = new Map();
    for (const font of fonts) {
      if (!groups.has(font.group)) {
        const group = document.createElement("optgroup");
        group.label = t(`font.${font.group}`);
        groups.set(font.group, group);
        select.append(group);
      }
      groups.get(font.group).append(optionOf(font.name, font.name));
    }
    select.value = String(value);
    select.onchange = () => set(select.value);
    return select;
  }

  /** A file the script reads. Nothing goes anywhere: the bytes stay in the tab and are handed to the engine here. */
  function fileElement(parameter, control, value, set) {
    const row = document.createElement("div");
    row.className = "osc-file";
    const type = control.accept.slice(1).toUpperCase();

    const name = document.createElement("span");
    name.className = "osc-sub osc-file-name";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "osc-file-clear";
    clear.textContent = "×";
    clear.title = t("form.fileClear");
    clear.setAttribute("aria-label", t("form.fileClear"));
    const show = (now) => {
      const chosen = now !== parameter.initial;
      name.textContent = chosen ? now : t("form.fileStandIn");
      name.title = chosen ? now : "";
      clear.hidden = !chosen;
    };
    clear.onclick = () => {
      set(parameter.initial);
      show(parameter.initial);
    };

    const input = document.createElement("input");
    input.type = "file";
    input.accept = control.accept;
    input.hidden = true;
    input.onchange = async () => {
      const file = input.files?.[0];
      // Cleared so choosing the same file again still says something changed.
      input.value = "";
      if (!file) return;
      // The picker's filter is only a suggestion, and the engine reads nothing else.
      if (!file.name.toLowerCase().endsWith(control.accept)) {
        ui.toast(t("form.fileWrongType", { type }), "error");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const unique = uploadName(current.uploads, file.name, bytes);
      current.uploads.set(unique, bytes);
      set(unique);
      show(unique);
    };

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "osc-btn";
    choose.textContent = t("form.chooseFile", { type });
    choose.setAttribute("aria-label", `${parameter.name}: ${t("form.chooseFile", { type })}`);
    choose.onclick = () => input.click();

    show(value);
    row.append(choose, name, clear, input);
    return row;
  }

  // ---- generating --------------------------------------------------------------------------------------------

  function setBusy(on, message) {
    busy = on;
    $("busy").hidden = !on;
    if (on && message) $("busy").lastElementChild.textContent = message;
    for (const id of ["generate", "save", "download", "reset", "pick", "open"]) {
      const button = $(id);
      if (button) button.disabled = on || (!current && id !== "pick" && id !== "open");
    }
    if (!on) enable(Boolean(current));
  }

  function enable(on) {
    $("generate").disabled = !on;
    $("reset").disabled = !on;
    $("save").disabled = !on || !generated;
    $("download").disabled = !on || !generated;
  }

  async function generate() {
    if (!current) return;
    setBusy(true, t("busy.generating"));
    $("status").textContent = "";
    $("saved").hidden = true;
    try {
      const openscad = await library("openscad");
      const values = changedValues(current.parameters, current.values);
      const name = generatedName(current.name, current.from?.name, values);
      const result = await openscad.render(current.text, {
        parameters: values,
        files: chosenFiles(current.uploads, values),
        name,
      });
      generated = { bytes: result.bytes, name };
      viewer.show(result.mesh);
      $("status").textContent = t("status.generated", {
        seconds: result.seconds.toFixed(1),
        size: Math.max(1, Math.round(result.bytes.length / 1024)),
      });
      showNotes(readableWarnings(result.log));
    } catch (err) {
      generated = null;
      viewer.clear();
      showNotes([]);
      $("status").textContent = "";
      ui.toast(t("error.failed"), "error");
      showNotes(String(err.message).split("\n").slice(0, 6));
    } finally {
      setBusy(false);
    }
  }

  function showNotes(lines) {
    const notes = $("notes");
    notes.hidden = !lines.length;
    notes.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
  }

  // ---- saving ------------------------------------------------------------------------------------------------

  async function save() {
    if (!generated) return;
    const file = { name: `${generated.name}.3mf`, data: generated.bytes, type: "model/3mf" };
    setBusy(true, t("busy.saving"));
    try {
      const model = await models.create({
        name: generated.name,
        description: current.from
          ? t("save.description", { model: current.from.name, script: current.name })
          : t("save.descriptionFile", { script: current.name }),
        files: [file],
      });
      ui.toast(t("save.done", { name: model.name }), "success");
      // The toast goes; a button to open what was just saved stays until the next generate.
      const open = $("saved");
      open.hidden = false;
      open.onclick = () => models.open(model.id);
    } catch (err) {
      ui.toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ---- the window --------------------------------------------------------------------------------------------

  $("generate").onclick = () => void generate();
  $("save").onclick = () => void save();
  $("reset").onclick = () => {
    if (!current) return;
    current.values = defaultValues(current.parameters);
    buildForm();
    void generate();
  };
  $("download").onclick = () => {
    if (generated) thingport.download({ name: `${generated.name}.3mf`, data: generated.bytes, type: "model/3mf" });
  };
  $("pick").onclick = () =>
    void (async () => {
      const model = await pickModel();
      if (model) await loadFromModel(model);
    })().catch(unreadable);
  $("open").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".scad,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await loadScript({ text: await file.text(), name: file.name, from: null });
    };
    input.click();
  };

  /**
   * A model to customise.
   *
   * Only the ones that have files beside their plates are offered, which the library's own listing already says,
   * so finding them costs nothing: a script lives beside a model, never as one of its plates.
   */
  async function pickModel() {
    const { models: found } = await models.list({ limit: 200 });
    const candidates = found.filter((model) => model.relatedCount > 0);
    if (!candidates.length) {
      ui.toast(t("error.noneInLibrary"), "info");
      return null;
    }
    return chooseFrom(candidates);
  }

  /** A small list in the window itself; `ui` has a collection picker but none for models. */
  function chooseFrom(candidates) {
    return new Promise((resolve) => {
      const side = $("side");
      const kept = [...side.children];
      side.replaceChildren();

      const panel = document.createElement("div");
      panel.className = "osc-fields";
      const heading = document.createElement("div");
      heading.style.fontWeight = "600";
      heading.textContent = t("pick.title");
      const search = document.createElement("input");
      search.type = "text";
      search.placeholder = t("pick.search");
      search.setAttribute("aria-label", t("pick.search"));
      const list = document.createElement("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "4px";

      const close = (model) => {
        side.replaceChildren(...kept);
        resolve(model);
      };
      const draw = () => {
        const needle = search.value.trim().toLowerCase();
        const shown = candidates.filter((model) => !needle || model.name.toLowerCase().includes(needle));
        list.replaceChildren(
          ...shown.slice(0, 60).map((model) => {
            const button = document.createElement("button");
            button.className = "osc-btn";
            button.style.textAlign = "left";
            button.textContent = model.name;
            button.onclick = () => close(model);
            return button;
          }),
        );
      };
      search.oninput = draw;
      draw();

      const cancel = document.createElement("button");
      cancel.className = "osc-btn";
      cancel.textContent = t("pick.cancel");
      cancel.onclick = () => close(null);

      panel.append(heading, search, list, cancel);
      side.append(panel);
      search.focus();
    });
  }

  labels();
  enable(false);

  // Opened from a model's own menu rather than from the Tools page: that model's script is what to open.
  if (context?.modelId) {
    try {
      await loadFromModel(await models.get(context.modelId));
    } catch (err) {
      unreadable(err);
    }
  }

  return () => viewer.dispose();
}
