// Writes the SDK reference from the SDK's own types, so it can't drift from the code. frontend/src/sdk/types.ts declares
// the `thingport` object a widget's and a tool's script get, with a comment on every member, and buildWidgetSdk and
// buildToolSdk are declared to return those types. From it this writes:
//
//   - the reference in docs/developers/sdk-reference.md, between its sdk:reference markers;
//   - backend/src/services/sdkReference.generated.ts, the same reference for a widget and for a tool, which the guides
//     the MCP tools widget_guide and tool_guide hand an AI assistant are built from;
//   - docs/developers/examples/thingport.d.ts, the types for a script's author to check against;
//   - each example under docs/developers/examples/, inlined into the docs between sdk:example markers.
//
// It also type-checks the examples against thingport.d.ts. All of it is committed:
//
//   npm run sdk:sync    rewrite them
//   npm run sdk:check   fail when one is out of date or an example doesn't type-check (CI)

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = "frontend/src/sdk/types.ts";
const THEME = "frontend/src/sdk/theme.ts";
const DOCS = "docs/developers";
const REFERENCE = `${DOCS}/sdk-reference.md`;
const EXAMPLES = `${DOCS}/examples`;
const DTS = `${EXAMPLES}/thingport.d.ts`;
const BACKEND = "backend/src/services/sdkReference.generated.ts";

/** The reference's sections, in order: every member of the root interfaces names one with `@group`. */
const GROUPS = ["Basics", "Words", "Your library", "Network", "Interface", "Libraries", "Tool only"];
/** What a script gets, by kind. */
const ROOTS = { widget: "WidgetSdk", tool: "ToolSdk" };
/** The interfaces that are the object itself, rather than a type it hands over. */
const ROOT_INTERFACES = new Set(["SdkBase", ...Object.values(ROOTS)]);
const LIBRARIES = "SdkLibraries";
const TAGS = new Set(["group", "param", "returns", "example"]);
const GENERATED_NOTE = `<!-- Written by scripts/sync-sdk-docs.mjs from ${TYPES}: change it there. -->`;

// --- Reading the types ---------------------------------------------------------------------------------------------

const program = ts.createProgram([path.join(ROOT, TYPES)], {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  types: [],
});
const source = program.getSourceFile(path.join(ROOT, TYPES));
const checker = program.getTypeChecker();
const problems = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
if (problems.length) throw new Error(`${TYPES} doesn't compile on its own:\n  ${problems.join("\n  ")}`);

/** Every interface and type alias in the file, by name. */
const declarations = new Map();
for (const statement of source.statements) {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    declarations.set(statement.name.text, statement);
  } else if (!ts.isExportDeclaration(statement)) {
    throw new Error(`${TYPES} holds types only, and ${ts.SyntaxKind[statement.kind]} isn't one`);
  }
}

const text = (node) => node.getText(source).replace(/\s+/g, " ").trim();

/** A node's doc comment: its prose, and its tags in the order written. */
function docOf(node) {
  const jsDoc = node.jsDoc?.at(-1);
  if (!jsDoc) return { text: "", tags: [] };
  const lines = source.text
    .slice(jsDoc.pos, jsDoc.end)
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\* ?/, "")
        .replace(/\*\\\//g, "*/")
        .trimEnd(),
    );
  const prose = [];
  const tags = [];
  for (const line of lines) {
    const tag = /^@(\w+)\s*(.*)$/.exec(line.trim());
    if (tag) {
      if (!TAGS.has(tag[1])) throw new Error(`${TYPES}: @${tag[1]} isn't a tag the reference knows`);
      tags.push({ name: tag[1], lines: [tag[2]] });
    } else if (tags.length) tags.at(-1).lines.push(line);
    else prose.push(line);
  }
  const tagText = (tag) =>
    tag.name === "example" ? tag.lines.join("\n").trim() : paragraphs(tag.lines.map((l) => l.trim()));
  return {
    text: paragraphs(prose.map((l) => l.trim())),
    tags: tags.map((tag) => {
      if (tag.name !== "param") return { name: tag.name, text: tagText(tag) };
      const [, param, rest] = /^(\S+)\s*([\s\S]*)$/.exec(tagText(tag)) ?? [];
      return { name: "param", param, text: rest };
    }),
  };
}

/** Wrapped lines as paragraphs: a blank line starts a new one. */
function paragraphs(lines) {
  return lines
    .join("\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split("\n").join(" "))
    .join("\n\n");
}

/** The first sentence, for a table: a full stop inside backticks doesn't end one. */
function firstSentence(prose) {
  let code = false;
  for (let i = 0; i < prose.length; i++) {
    if (prose[i] === "`") code = !code;
    if (!code && prose[i] === "." && (i === prose.length - 1 || /\s/.test(prose[i + 1]))) return prose.slice(0, i + 1);
  }
  return prose.split("\n\n")[0];
}

/** The interface a member's type names, when it's one of the file's own. */
function namedInterface(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) return null;
  const declaration = declarations.get(typeNode.typeName.text);
  return declaration && ts.isInterfaceDeclaration(declaration) ? declaration : null;
}

/** An interface's members, its bases' included, in the order they're declared in the file. */
function membersOf(declaration) {
  const type = checker.getTypeAtLocation(declaration.name);
  return checker
    .getPropertiesOfType(type)
    .map((symbol) => symbol.declarations[0])
    .toSorted((a, b) => a.pos - b.pos);
}

/** An interface that does things, rather than holding data: its members are listed one by one. */
const isNamespace = (declaration) => membersOf(declaration).some((member) => ts.isMethodSignature(member));

/** A member as the reference shows it, under the path it's reached by. */
function entry(member, prefix) {
  const name = member.name.getText(source);
  const doc = docOf(member);
  const isMethod = ts.isMethodSignature(member);
  const typeParameters = member.typeParameters ? `<${member.typeParameters.map(text).join(", ")}>` : "";
  const signature = isMethod
    ? `${prefix}${name}${typeParameters}(${member.parameters.map(text).join(", ")}): ${text(member.type)}`
    : `${prefix}${name}${member.questionToken ? "?" : ""}: ${member.type.getText(source)}`;
  const params = isMethod ? member.parameters.map((p) => (p.questionToken ? `${text(p.name)}?` : text(p.name))) : [];
  const namespace = !isMethod && namedInterface(member.type);
  return {
    path: prefix.replace(/^thingport\./, "") + name,
    heading: isMethod
      ? `${prefix.replace(/^thingport\./, "")}${name}(${params.join(", ")})`
      : prefix.replace(/^thingport\./, "") + name,
    member,
    doc,
    signature,
    children: namespace && isNamespace(namespace) ? membersOf(namespace).map((m) => entry(m, `${prefix}${name}.`)) : [],
  };
}

/** The object a kind of script gets, member by member. */
function tree(kind) {
  return membersOf(declarations.get(ROOTS[kind])).map((member) => {
    const item = entry(member, "thingport.");
    const group = item.doc.tags.find((tag) => tag.name === "group")?.text;
    if (!GROUPS.includes(group)) throw new Error(`${TYPES}: ${item.path} needs @group, one of: ${GROUPS.join(", ")}`);
    return { ...item, group };
  });
}

/** Both trees as one, each member saying which kinds have it, and in what form where they differ. */
function merge(trees) {
  const merged = [];
  const add = (list, kind, items) => {
    for (const item of items) {
      let at = list.find((other) => other.path === item.path);
      if (!at) {
        at = { path: item.path, group: item.group, pos: item.member.pos, variants: [], children: [] };
        list.push(at);
      }
      at.pos = Math.min(at.pos, item.member.pos);
      const same = at.variants.find((variant) => variant.item.member === item.member);
      if (same) same.kinds.push(kind);
      else at.variants.push({ kinds: [kind], item });
      add(at.children, kind, item.children);
    }
    list.sort((a, b) => a.pos - b.pos);
  };
  for (const [kind, items] of Object.entries(trees)) add(merged, kind, items);
  return merged;
}

const byKind = (a, b) => Object.keys(ROOTS).indexOf(a) - Object.keys(ROOTS).indexOf(b);
const kindsOf = (node) => [...new Set(node.variants.flatMap((variant) => variant.kinds))].toSorted(byKind);

// --- Writing it ----------------------------------------------------------------------------------------------------

/** The CSS variable each theme colour is on `root` as, from theme.ts's THEME_VARIABLES. */
function themeVariables() {
  const file = ts.createSourceFile(THEME, readFileSync(path.join(ROOT, THEME), "utf8"), ts.ScriptTarget.ES2022, true);
  let found = null;
  file.forEachChild(function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "THEME_VARIABLES") {
      found = Object.fromEntries(
        node.initializer.properties.map((p) => [
          p.name.getText(file),
          ts.isStringLiteral(p.initializer) ? p.initializer.text : null,
        ]),
      );
    }
    node.forEachChild(visit);
  });
  if (!found) throw new Error(`${THEME} has no THEME_VARIABLES`);
  return found;
}

/** The data types the reference links to, in the order the file declares them. */
const dataTypes = [...declarations.values()].filter(
  (d) =>
    !ROOT_INTERFACES.has(d.name.text) && d.name.text !== LIBRARIES && !(ts.isInterfaceDeclaration(d) && isNamespace(d)),
);
const dataTypeNames = new Set(dataTypes.map((d) => d.name.text));
/** A heading's anchor, as GitHub and the site make it: lowercase, punctuation dropped, spaces as dashes. */
const anchor = (heading) =>
  `#${heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-")}`;
const cell = (value) => value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const code = (value) => `\`${cell(value)}\``;
const AVAILABLE = { "widget,tool": "Widgets and tools", widget: "Widgets only", tool: "Tools only" };

function render({ kinds, level, links }) {
  const out = [];
  const h = (depth, title) => out.push(`${"#".repeat(level + depth)} ${title}`, "");
  const both = kinds.length > 1;

  /** A member's signature, words, parameters and examples; `available` says which kinds have it. */
  const body = (item, available) => {
    if (both && available) out.push(`_${AVAILABLE[available.join(",")]}_`, "");
    out.push("```ts", item.signature, "```", "");
    if (item.doc.text) out.push(item.doc.text, "");
    const params = item.doc.tags.filter((tag) => tag.name === "param");
    if (params.length) {
      out.push("| Parameter | What it is |", "| --- | --- |");
      for (const param of params) out.push(`| ${code(param.param)} | ${cell(param.text)} |`);
      out.push("");
    }
    const returns = item.doc.tags.find((tag) => tag.name === "returns");
    if (returns) out.push(`**Returns:** ${returns.text}`, "");
    if (links) {
      const named = [...new Set(item.signature.match(/\b[A-Z]\w+\b/g) ?? [])].filter((n) => dataTypeNames.has(n));
      if (named.length) out.push(`See ${named.map((n) => `[\`${n}\`](${anchor(n)})`).join(", ")}.`, "");
    }
    for (const example of item.doc.tags.filter((tag) => tag.name === "example")) {
      out.push("```js", example.text, "```", "");
    }
  };

  // A member says which kinds have it where that's news: at the top level, and below it only where it narrows.
  const node = (n, depth, parentKinds) => {
    const variants = n.variants
      .map((variant) => ({ ...variant, kinds: variant.kinds.filter((kind) => kinds.includes(kind)) }))
      .filter((variant) => variant.kinds.length);
    if (!variants.length) return;
    const has = [...new Set(variants.flatMap((variant) => variant.kinds))].toSorted(byKind);
    h(depth, `\`${variants[0].item.heading}\``);
    if (variants.length === 1) body(variants[0].item, has.length < parentKinds.length || depth === 1 ? has : null);
    else
      for (const variant of variants) {
        out.push(`**In a ${variant.kinds.join(" and a ")}:**`, "");
        body(variant.item, null);
      }
    for (const child of n.children) node(child, depth + 1, has);
    if (n.path === "library") libraries(depth);
  };

  const libraries = (depth) => {
    for (const member of membersOf(declarations.get(LIBRARIES))) {
      const name = member.name.getText(source);
      const doc = docOf(member);
      h(depth + 1, `\`library("${name}")\``);
      // A library with members of its own is described where they're declared; the rest, here.
      const namespace = namedInterface(member.type);
      const members = namespace && isNamespace(namespace) ? membersOf(namespace) : [];
      const about = (members.length && docOf(namespace).text) || doc.text;
      if (about) out.push(about, "");
      for (const example of doc.tags.filter((tag) => tag.name === "example"))
        out.push("```js", example.text, "```", "");
      for (const child of members) {
        const item = entry(child, `${name}.`);
        h(depth + 2, `\`${item.heading}\``);
        body(item, null);
      }
    }
  };

  const trees = Object.fromEntries(kinds.map((kind) => [kind, tree(kind)]));
  const merged = merge(trees);

  if (both) {
    h(0, "At a glance");
    out.push("| Member | Widget | Tool | What it is |", "| --- | :-: | :-: | --- |");
    for (const group of GROUPS)
      for (const n of merged.filter((m) => m.group === group)) {
        const has = kindsOf(n);
        // Where the kinds differ, what they share: the declaration both start from comes first in the file.
        const base = n.variants.toSorted((a, b) => a.item.member.pos - b.item.member.pos)[0];
        const about = firstSentence(base.item.doc.text);
        const tick = (kind) => (has.includes(kind) ? "✓" : "");
        const link = `[\`${n.path}\`](${anchor(n.variants[0].item.heading)})`;
        out.push(`| ${link} | ${tick("widget")} | ${tick("tool")} | ${cell(about)} |`);
      }
    out.push("");
  }

  for (const group of GROUPS) {
    const members = merged.filter(
      (n) => n.group === group && n.variants.some((v) => v.kinds.some((k) => kinds.includes(k))),
    );
    if (!members.length) continue;
    h(0, group);
    for (const n of members) node(n, 1, kinds);
  }

  h(0, "Types");
  const variables = themeVariables();
  for (const declaration of dataTypes) {
    const name = declaration.name.text;
    h(1, `\`${name}\``);
    const about = docOf(declaration).text;
    if (about) out.push(about, "");
    if (ts.isTypeAliasDeclaration(declaration)) {
      out.push("```ts", `type ${name} = ${declaration.type.getText(source)}`, "```", "");
      continue;
    }
    const theme = name === "SdkTheme";
    out.push(
      theme ? "| Field | Type | CSS variable | What it is |" : "| Field | Type | What it is |",
      theme ? "| --- | --- | --- | --- |" : "| --- | --- | --- |",
    );
    for (const member of membersOf(declaration)) {
      const field = member.name.getText(source) + (member.questionToken ? "?" : "");
      const variable = theme
        ? ` ${variables[member.name.getText(source)] ? code(variables[member.name.getText(source)]) : ""} |`
        : "";
      out.push(`| ${code(field)} | ${code(member.type.getText(source))} |${variable} ${cell(docOf(member).text)} |`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

// --- The files ----------------------------------------------------------------------------------------------------

const header = `// GENERATED from ${TYPES} by scripts/sync-sdk-docs.mjs. Don't edit it here:\n// change that file and run npm run sdk:sync.\n`;

/** The page with `body` between its `<!-- name -->` and `<!-- /name -->` markers. */
function fill(text, file, name, body) {
  const [open, close] = [`<!-- ${name} -->`, `<!-- /${name} -->`];
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1) throw new Error(`${file} has no ${open} ... ${close}`);
  return `${text.slice(0, start + open.length)}\n${body}\n${text.slice(end)}`;
}

/** The examples' code, inlined wherever a page asks for one. */
function inlineExamples(text, file) {
  return text.replace(/(<!-- sdk:example ([^\s]+) -->)[\s\S]*?(<!-- \/sdk:example -->)/g, (_, open, example, close) => {
    const at = path.join(ROOT, EXAMPLES, example);
    if (!existsSync(at)) throw new Error(`${file} inlines ${EXAMPLES}/${example}, which isn't there`);
    const language = { ".js": "js", ".json": "json", ".html": "html", ".yml": "yaml" }[path.extname(example)] ?? "";
    const link = `[\`${example}\`](${path
      .relative(path.dirname(path.join(ROOT, file)), at)
      .split(path.sep)
      .join("/")})`;
    return `${open}\n\n${link}\n\n\`\`\`${language}\n${readFileSync(at, "utf8").trimEnd()}\n\`\`\`\n\n${close}`;
  });
}

async function outputs() {
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  const format = (file, value) => prettier.format(value, { ...config, filepath: file });
  const files = new Map();

  const typesText = readFileSync(path.join(ROOT, TYPES), "utf8");
  const firstCode = typesText.search(/^(\/\*\*|\/\/ ---|export )/m);
  files.set(
    DTS,
    await format(
      DTS,
      `${header}//\n// The \`thingport\` object a Thingport widget's or tool's script is called with. Check a script against it with\n// \`// @ts-check\` and \`/** @param {import("./thingport").WidgetSdk} thingport */\` (or ToolSdk) on its default export.\n\n${typesText.slice(firstCode)}`,
    ),
  );

  files.set(
    BACKEND,
    await format(
      BACKEND,
      `${header}
/** What a widget's script gets, as the widget guide hands it to an AI assistant. */
export const WIDGET_SDK_REFERENCE = ${JSON.stringify(render({ kinds: ["widget"], level: 3, links: false }))};

/** What a tool's script gets, as the tool guide hands it to an AI assistant. */
export const TOOL_SDK_REFERENCE = ${JSON.stringify(render({ kinds: ["tool"], level: 3, links: false }))};
`,
    ),
  );

  for (const name of readdirSync(path.join(ROOT, DOCS)).filter((name) => name.endsWith(".md"))) {
    const file = `${DOCS}/${name}`;
    let page = readFileSync(path.join(ROOT, file), "utf8");
    if (file === REFERENCE)
      page = fill(
        page,
        file,
        "sdk:reference",
        `${GENERATED_NOTE}\n\n${render({ kinds: ["widget", "tool"], level: 2, links: true })}\n`,
      );
    page = inlineExamples(page, file);
    files.set(file, await format(file, page));
  }
  return files;
}

/** Type-checks every example against thingport.d.ts, as a script's author would with `// @ts-check`. */
function checkExamples() {
  const scripts = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith(".js")) scripts.push(at);
    }
  };
  walk(path.join(ROOT, EXAMPLES));
  const unchecked = scripts.filter((file) => !readFileSync(file, "utf8").startsWith("// @ts-check"));
  if (unchecked.length)
    throw new Error(
      `Examples start with // @ts-check, and these don't:\n  ${unchecked.map((f) => path.relative(ROOT, f)).join("\n  ")}`,
    );
  const examples = ts.createProgram(scripts, {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
  });
  return ts.getPreEmitDiagnostics(examples).map((d) => {
    const where = d.file
      ? `${path.relative(ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
      : "";
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

const check = process.argv.includes("--check");
const stale = [];
for (const [file, value] of await outputs()) {
  const out = path.join(ROOT, file);
  if (existsSync(out) && readFileSync(out, "utf8") === value) continue;
  stale.push(file);
  if (!check) writeFileSync(out, value);
}
// After writing, so a sync checks the examples against the thingport.d.ts it just wrote.
const errors = checkExamples();
if (check && stale.length) {
  console.error(`Out of date with ${TYPES} or ${EXAMPLES} (run npm run sdk:sync):\n  ${stale.join("\n  ")}`);
}
if (errors.length) console.error(`The examples don't type-check against ${DTS}:\n  ${errors.join("\n  ")}`);
if (errors.length || (check && stale.length)) process.exit(1);
if (!check) console.log(stale.length ? `Updated:\n  ${stale.join("\n  ")}` : "Up to date.");
