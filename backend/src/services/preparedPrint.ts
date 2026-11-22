import { LEGACY } from "../files/kinds";
import fs from "node:fs/promises";
import path from "node:path";
import { listZipEntries, readZipEntry } from "../utils/zipReader";

const TEXT_LIMIT = 2 * 1024 * 1024;
const PREPARED_SUFFIXES = LEGACY.prepared;

export type PreparedMetadata = {
  printer: string | null;
  material: string | null;
  nozzle_mm: number | null;
  layer_height_mm: number | null;
  estimated_seconds: number | null;
  format: string;
};

export function isPreparedPrintFilename(filename: string): boolean {
  const lower = (filename || "").toLowerCase();
  return PREPARED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function preparedFormat(filename: string): string {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".gcode.3mf")) return "gcode_3mf";
  if (lower.endsWith(".bgcode")) return "bgcode";
  return "gcode";
}

function firstFloat(value: string | undefined | null): number | null {
  const match = (value || "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationSeconds(value: string | undefined | null): number | null {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(d|days?|h|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    found = true;
    const amount = Number.parseFloat(match[1]);
    const unit = match[2];
    const multiplier = unit.startsWith("d") ? 86400 : unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
    total += amount * multiplier;
  }
  return found ? Math.trunc(total) : null;
}

const PROFILE_ALIASES: Record<string, string> = {
  p1s: "Bambu Lab P1S",
  p1p: "Bambu Lab P1P",
  x1c: "Bambu Lab X1 Carbon",
  "x1 carbon": "Bambu Lab X1 Carbon",
  a1: "Bambu Lab A1",
  "a1 mini": "Bambu Lab A1 mini",
};

function cleanProfile(value: string | undefined | null): string | null {
  let cleaned = (value || "").trim();
  cleaned = cleaned.replace(/\s*@\s*[^;]+$/, "");
  cleaned = cleaned.split(";")[0].trim();
  cleaned = cleaned.replace(/\s+\d+(?:\.\d+)?\s*(?:mm\s*)?nozzle$/i, "");
  if (!cleaned) return null;
  return PROFILE_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

type MutableMetadata = {
  printer: string | null;
  material: string | null;
  nozzle_mm: number | null;
  layer_height_mm: number | null;
  estimated_seconds: number | null;
};

function mergeTextMetadata(metadata: MutableMetadata, text: string): void {
  const attributeValues: Record<string, string> = {};
  for (const tagMatch of text.matchAll(/<[^>]+>/g)) {
    const tag = tagMatch[0];
    const attrs: Record<string, string> = {};
    for (const attrMatch of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    const key = (attrs.key || attrs.name || "").toLowerCase();
    const value = attrs.value;
    if (key && value !== undefined) attributeValues[key] = value;
    if (metadata.material === null && /filament/i.test(tag) && attrs.type) {
      metadata.material = attrs.type.split(";")[0].trim() || null;
    }
  }

  for (const [key, value] of Object.entries(attributeValues)) {
    if (metadata.printer === null && ["printer_model", "printer_settings_id", "machine_name"].includes(key)) {
      metadata.printer = cleanProfile(value);
    } else if (metadata.material === null && ["filament_type", "material_type"].includes(key)) {
      metadata.material = value.split(";")[0].trim() || null;
    } else if (metadata.nozzle_mm === null && key === "nozzle_diameter") {
      metadata.nozzle_mm = firstFloat(value);
    } else if (metadata.layer_height_mm === null && key === "layer_height") {
      metadata.layer_height_mm = firstFloat(value);
    } else if (metadata.estimated_seconds === null && ["prediction", "estimated_time", "print_time"].includes(key)) {
      metadata.estimated_seconds = durationSeconds(value);
    }
  }

  const patterns: Record<keyof MutableMetadata, RegExp[]> = {
    printer: [
      /^\s*;?\s*printer_settings_id\s*[:=]\s*([^\r\n]+)/im,
      /^\s*;?\s*printer_model\s*[:=]\s*([^\r\n]+)/im,
      /^\s*;?\s*machine_name\s*[:=]\s*([^\r\n]+)/im,
    ],
    material: [/^\s*;?\s*(?:filament_type|material_type)\s*[:=]\s*([^\r\n]+)/im],
    nozzle_mm: [/^\s*;?\s*nozzle_diameter\s*[:=]\s*([^\r\n]+)/im],
    layer_height_mm: [/^\s*;?\s*layer_height\s*[:=]\s*([^\r\n]+)/im],
    estimated_seconds: [
      /^\s*;?\s*(?:total estimated time|model printing time|estimated printing time[^:=]*|time)\s*[:=]\s*([^\r\n]+)/im,
    ],
  };
  for (const key of Object.keys(patterns) as (keyof MutableMetadata)[]) {
    if (metadata[key] !== null) continue;
    for (const pattern of patterns[key]) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = match[1].trim();
      if (key === "printer") metadata.printer = cleanProfile(value);
      else if (key === "material") metadata.material = value.split(";")[0].trim() || null;
      else if (key === "nozzle_mm" || key === "layer_height_mm") metadata[key] = firstFloat(value);
      else metadata.estimated_seconds = durationSeconds(value);
      if (metadata[key] !== null) break;
    }
  }
}

function visitJson(node: unknown, prefix: string, flattened: Record<string, unknown>): void {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      visitJson(child, prefix ? `${prefix}.${key}` : key, flattened);
    }
  } else if (Array.isArray(node)) {
    node.slice(0, 20).forEach((child, index) => visitJson(child, `${prefix}.${index}`, flattened));
  } else {
    flattened[prefix.toLowerCase()] = node;
  }
}

function mergeJsonMetadata(metadata: MutableMetadata, raw: Buffer): void {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf-8"));
  } catch {
    return;
  }
  const flattened: Record<string, unknown> = {};
  visitJson(value, "", flattened);
  for (const [key, rawValue] of Object.entries(flattened)) {
    const text = String(rawValue);
    if (metadata.printer === null && (key.includes("printer_model") || key.includes("machine_name"))) {
      metadata.printer = cleanProfile(text);
    } else if (metadata.material === null && (key.includes("filament_type") || key.includes("material_type"))) {
      metadata.material = text.split(";")[0].trim() || null;
    } else if (metadata.nozzle_mm === null && key.includes("nozzle_diameter")) {
      metadata.nozzle_mm = firstFloat(text);
    } else if (metadata.layer_height_mm === null && key.includes("layer_height")) {
      metadata.layer_height_mm = firstFloat(text);
    } else if (
      metadata.estimated_seconds === null &&
      (key.includes("prediction") || key.includes("estimated_time") || key.includes("print_time"))
    ) {
      metadata.estimated_seconds = durationSeconds(text);
    }
  }
}

async function readTextSample(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const half = TEXT_LIMIT / 2;
    const handle = await fs.open(filePath, "r");
    try {
      const firstBuf = Buffer.alloc(Math.min(half, stat.size));
      await handle.read(firstBuf, 0, firstBuf.length, 0);
      let lastBuf = Buffer.alloc(0);
      if (stat.size > firstBuf.length) {
        const start = Math.max(0, stat.size - half);
        lastBuf = Buffer.alloc(stat.size - start);
        await handle.read(lastBuf, 0, lastBuf.length, start);
      }
      return Buffer.concat([firstBuf, Buffer.from("\n"), lastBuf]).toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export async function inspectPreparedPrint(filePath: string, filename?: string): Promise<PreparedMetadata | null> {
  const displayName = filename || path.basename(filePath);
  const metadata: PreparedMetadata = {
    printer: null,
    material: null,
    nozzle_mm: null,
    layer_height_mm: null,
    estimated_seconds: null,
    format: preparedFormat(displayName),
  };

  const is3mf = displayName.toLowerCase().endsWith(".3mf");
  if (!is3mf) {
    if (!isPreparedPrintFilename(displayName)) return null;
    mergeTextMetadata(metadata, await readTextSample(filePath));
    return metadata;
  }

  try {
    const names = (await listZipEntries(filePath)).filter((e) => !e.isDirectory).map((e) => e.name);
    const preparedMembers = names.filter((name) => /\.(gcode|gco|bgcode)$/i.test(name));
    if (preparedMembers.length === 0 && !displayName.toLowerCase().endsWith(".gcode.3mf")) {
      return null;
    }
    metadata.format = "gcode_3mf";

    for (const name of names) {
      const lower = name.toLowerCase();
      const isMetadataArea = lower.includes("metadata/") || lower.includes("slice") || lower.includes("plate");
      if (lower.endsWith(".json") && isMetadataArea) {
        const buf = await readZipEntry(filePath, name, TEXT_LIMIT);
        if (buf) mergeJsonMetadata(metadata, buf);
      } else if (/\.(config|xml|txt)$/i.test(lower) && (lower.includes("metadata/") || lower.includes("slice"))) {
        const buf = await readZipEntry(filePath, name, TEXT_LIMIT);
        if (buf) mergeTextMetadata(metadata, buf.toString("utf-8"));
      }
    }

    if (preparedMembers[0]) {
      const buf = await readZipEntry(filePath, preparedMembers[0], TEXT_LIMIT);
      if (buf) mergeTextMetadata(metadata, buf.toString("utf-8"));
    }
  } catch {
    return null;
  }
  return metadata;
}

export function preparedFilename(modelName: string, metadata: Pick<PreparedMetadata, "format"> | null): string {
  const fmt = metadata?.format;
  const suffix = fmt === "gcode_3mf" ? ".gcode.3mf" : fmt === "bgcode" ? ".bgcode" : ".gcode";
  let safe = (modelName || "prepared-print")
    .trim()
    // oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[ .]+$/, "");
  return `${safe || "prepared-print"}${suffix}`;
}
