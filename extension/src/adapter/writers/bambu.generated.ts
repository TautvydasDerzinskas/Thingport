// GENERATED from backend/src/adapter/writers/bambu.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A Bambu layout project for Bambu Studio or a slicer built on it, kept as it is -- parts, plates, painting and the
// designer's settings -- with only what that slicer would question changed: the Application tag it checks, the
// `OrcaSlicer` tag, and the names of settings it knows by other names. A copy for the user's printer (printer.ts)
// also names that printer's presets and moves the plates onto its bed.

import JSZip from "jszip";
import type { AdaptPlan } from "../plan.generated";
import {
  moveBuildItems,
  plateMoves,
  retargetSettings,
  type PrinterRecipe,
  type RetargetResult,
} from "../printer.generated";
import type { BambuPackage } from "../readers/bambuProject.generated";
import { settingsIn, verticalShellIn } from "../settings.generated";
import { pathKey } from "../xml.generated";
import type { Written } from "./types.generated";

type BambuPlan = Extract<AdaptPlan, { output: "bambu" }>;

const APPLICATION_RE = /(<metadata\b[^>]*\bname\s*=\s*"Application"[^>]*>)([^<]*)(<\/metadata>)/i;
const ORCA_TAG_RE = /[ \t]*<metadata\b[^>]*\bname\s*=\s*"OrcaSlicer"[^>]*>[^<]*<\/metadata>[ \t]*\r?\n?/i;
const SHELL_RE = /(<metadata key="ensure_vertical_shell_thickness" value=")([^"]*)(")/g;
// The metadata tags sit before <resources>; this is far more than they ever take.
const HEAD_BYTES = 256 * 1024;
// Presets a project carries of its own, which the slicers install beside theirs (bbs_3mf.cpp): a copy for a printer
// names the slicer's, so the designer's would only be in the way. With the designer's slice results, which are for
// their printer.
const DESIGNER_ONLY = [
  /^metadata\/print_setting_/,
  /^metadata\/process_settings_/,
  /^metadata\/filament_settings_/,
  /^metadata\/machine_settings_/,
  /^metadata\/slice_info\.config$/,
];

/** The model's head with its Application set to `tag` (null: left) and its `OrcaSlicer` tag dropped if asked. */
export function retagModelHead(head: string, tag: string | null, dropOrcaTag: boolean): string {
  let out = dropOrcaTag ? head.replace(ORCA_TAG_RE, "") : head;
  if (tag) {
    out = APPLICATION_RE.test(out)
      ? out.replace(APPLICATION_RE, (_all, open: string, _old: string, close: string) => open + tag + close)
      : out.replace(/<model\b[^>]*>/i, (open) => `${open}\n <metadata name="Application">${tag}</metadata>`);
  }
  return out;
}

const BUILD_TAG = new TextEncoder().encode("<build");
// After "<build": whitespace, ">" or "/", so "<buildings" isn't taken for it.
const BUILD_END = new Set([0x09, 0x0a, 0x0d, 0x20, 0x2f, 0x3e]);

/** Where the last `<build` starts, as a byte offset; searched from the end, where it is. */
function buildOffset(bytes: Uint8Array): number {
  outer: for (let i = bytes.length - BUILD_TAG.length - 1; i >= 0; i--) {
    for (let j = 0; j < BUILD_TAG.length; j++) if (bytes[i + j] !== BUILD_TAG[j]) continue outer;
    if (BUILD_END.has(bytes[i + BUILD_TAG.length])) return i;
  }
  return -1;
}

/** The model file with its head (before <resources>) and build section (from <build) rewritten, its meshes copied as
 *  bytes. A rewrite returning null leaves its part as it was. */
function rewriteModel(
  bytes: Uint8Array,
  head: ((text: string) => string) | null,
  build: ((text: string) => string | null) | null,
): Uint8Array {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let headEnd = 0;
  let newHead: Uint8Array | null = null;
  if (head) {
    const text = decoder.decode(bytes.subarray(0, Math.min(bytes.length, HEAD_BYTES)));
    const at = text.search(/<resources[\s>]/i);
    if (at < 0) {
      const whole = head(decoder.decode(bytes));
      const buildAt = whole.lastIndexOf("<build");
      const rebuilt = build && buildAt >= 0 ? build(whole.slice(buildAt)) : null;
      return encoder.encode(rebuilt === null ? whole : whole.slice(0, buildAt) + rebuilt);
    }
    headEnd = encoder.encode(text.slice(0, at)).length;
    newHead = encoder.encode(head(text.slice(0, at)));
  }
  let tailStart = bytes.length;
  let newTail: Uint8Array | null = null;
  if (build) {
    const at = buildOffset(bytes);
    if (at >= headEnd) {
      const rebuilt = build(decoder.decode(bytes.subarray(at)));
      if (rebuilt !== null) {
        tailStart = at;
        newTail = encoder.encode(rebuilt);
      }
    }
  }
  if (!newHead && !newTail) return bytes;
  const parts = [
    newHead ?? bytes.subarray(0, headEnd),
    bytes.subarray(headEnd, tailStart),
    newTail ?? new Uint8Array(),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `recipe` is the catalogue's word on `plan.printer`, without which the copy isn't made for a printer. */
export async function writeBambu(pkg: BambuPackage, plan: BambuPlan, recipe?: PrinterRecipe | null): Promise<Written> {
  const rootKey = pathKey(pkg.root.relativePath);
  const settings = pkg.config && plan.dialect ? settingsIn(plan.dialect, pkg.config) : pkg.config;
  const retarget: RetargetResult | null =
    plan.printer && recipe && settings ? retargetSettings(settings, recipe) : null;
  const moves = retarget?.from && recipe?.bed ? plateMoves(pkg.plates, retarget.from, recipe.bed) : null;
  const retags = Boolean(plan.tag || plan.dropOrcaTag);

  const out = new JSZip();
  for (const [key, rec] of Object.entries(pkg.filesByKey)) {
    if (retarget && DESIGNER_ONLY.some((re) => re.test(key))) continue;
    if (key === rootKey && (retags || moves?.size)) {
      const bytes = await rec.entry.async("uint8array");
      out.file(
        rec.relativePath,
        rewriteModel(
          bytes,
          retags ? (head) => retagModelHead(head, plan.tag, plan.dropOrcaTag) : null,
          moves?.size ? (build) => moveBuildItems(build, moves) : null,
        ),
      );
      continue;
    }
    if (key === "metadata/project_settings.config" && settings && (plan.dialect || retarget)) {
      out.file(rec.relativePath, JSON.stringify(retarget?.settings ?? settings, null, 4));
      continue;
    }
    if (plan.dialect && key === "metadata/model_settings.config" && pkg.modelSettingsXml !== null) {
      const dialect = plan.dialect;
      out.file(
        rec.relativePath,
        pkg.modelSettingsXml.replace(SHELL_RE, (_all, open: string, value: string, close: string) => {
          return open + verticalShellIn(dialect, value) + close;
        }),
      );
      continue;
    }
    out.file(rec.relativePath, await rec.entry.async("uint8array"));
  }
  return {
    zip: out,
    report: () => ({
      output: "bambu",
      retagged: Boolean(plan.tag),
      droppedOrcaTag: plan.dropOrcaTag,
      translated: Boolean(plan.dialect),
      ...(retarget
        ? { printer: recipe?.preset ?? null, process: retarget.process, filaments: retarget.filaments }
        : {}),
    }),
  };
}
