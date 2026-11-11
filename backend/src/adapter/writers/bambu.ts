// A Bambu layout project for Bambu Studio or a slicer built on it, kept as it is -- parts, plates, painting and the
// designer's settings -- with only what that slicer would question changed: the Application tag it checks, the
// `OrcaSlicer` tag, and the names of settings it knows by other names.

import JSZip from "jszip";
import type { AdaptPlan } from "../plan";
import type { BambuPackage } from "../readers/bambuProject";
import { settingsIn, verticalShellIn } from "../settings";
import { pathKey } from "../xml";
import type { Written } from "./types";

type BambuPlan = Extract<AdaptPlan, { output: "bambu" }>;

const APPLICATION_RE = /(<metadata\b[^>]*\bname\s*=\s*"Application"[^>]*>)([^<]*)(<\/metadata>)/i;
const ORCA_TAG_RE = /[ \t]*<metadata\b[^>]*\bname\s*=\s*"OrcaSlicer"[^>]*>[^<]*<\/metadata>[ \t]*\r?\n?/i;
const SHELL_RE = /(<metadata key="ensure_vertical_shell_thickness" value=")([^"]*)(")/g;
// The metadata tags sit before <resources>; this is far more than they ever take.
const HEAD_BYTES = 256 * 1024;

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

/** The model file with its head rewritten, its meshes copied as bytes. */
function rewriteHead(bytes: Uint8Array, rewrite: (head: string) => string): Uint8Array {
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, HEAD_BYTES)));
  const at = text.search(/<resources[\s>]/i);
  if (at < 0) return new TextEncoder().encode(rewrite(new TextDecoder().decode(bytes)));
  const head = text.slice(0, at);
  const headLength = new TextEncoder().encode(head).length;
  const newHead = new TextEncoder().encode(rewrite(head));
  const out = new Uint8Array(newHead.length + bytes.length - headLength);
  out.set(newHead, 0);
  out.set(bytes.subarray(headLength), newHead.length);
  return out;
}

export async function writeBambu(pkg: BambuPackage, plan: BambuPlan): Promise<Written> {
  const rootKey = pathKey(pkg.root.relativePath);
  const out = new JSZip();
  for (const [key, rec] of Object.entries(pkg.filesByKey)) {
    if (key === rootKey && (plan.tag || plan.dropOrcaTag)) {
      const bytes = await rec.entry.async("uint8array");
      out.file(
        rec.relativePath,
        rewriteHead(bytes, (head) => retagModelHead(head, plan.tag, plan.dropOrcaTag)),
      );
      continue;
    }
    if (plan.dialect && key === "metadata/project_settings.config" && pkg.config) {
      out.file(rec.relativePath, JSON.stringify(settingsIn(plan.dialect, pkg.config), null, 4));
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
    }),
  };
}
