import path from "node:path";
import type { Plate, Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  QUALITY_CHECK_OF_ISSUE,
  QUALITY_CHECK_VERSION,
  QUALITY_SEVERITY,
  type QualityCheckKey,
  type QualityIssue,
  type QualityReport,
  type QualitySeverity,
} from "./meshQuality";
import { checkPlateQuality } from "./modelPreviewCache";
import { resolvePlateFilePath } from "./printCreation";
import { getQualityChecks, getQualityChecksOff } from "./settingsService";

// Printability checks run when a model is opened, never on import: each file is checked once, the first time its
// model is viewed with checks switched on, and again only when the rules change (QUALITY_CHECK_VERSION).

export const QUALITY_CHECK_EXTS = new Set([".stl", ".obj", ".3mf"]);

type SkippedCheck = { version: number; status: "skipped"; reason: string };
type StoredCheck = QualityReport | SkippedCheck;

export type FileQualityStatus = "unchecked" | "checking" | "good" | "issues" | "skipped";
export type FileQualityOut = {
  plate_id: string;
  filename: string;
  status: FileQualityStatus;
  issues: (QualityIssue & { severity: QualitySeverity })[];
  triangles: number | null;
  shells: number | null;
  size: [number, number, number] | null;
};
export type PrintQualityOut = {
  enabled: boolean;
  /** "none" when the model has no file the check reads. */
  status: FileQualityStatus | "none";
  files: FileQualityOut[];
};

const checking = new Set<string>();

function isCheckable(plate: Pick<Plate, "filename">): boolean {
  return QUALITY_CHECK_EXTS.has(path.extname(plate.filename).toLowerCase());
}

function storedCheck(plate: Pick<Plate, "qualityCheck">): StoredCheck | null {
  const value = plate.qualityCheck as StoredCheck | null;
  return value && typeof value === "object" && value.version === QUALITY_CHECK_VERSION ? value : null;
}

const SEVERITY_RANK: Record<QualitySeverity, number> = { critical: 0, major: 1, minor: 2 };

/** Checks run in full whatever is switched off; what those find is left out here, so switching one back on needs no
 * new check. */
function toFileQualityOut(plate: Plate, checksOff: ReadonlySet<QualityCheckKey>): FileQualityOut {
  const check = checking.has(plate.id) ? null : storedCheck(plate);
  const report = check && check.status !== "skipped" ? check : null;
  const issues = (report?.issues ?? [])
    .filter((issue) => !checksOff.has(QUALITY_CHECK_OF_ISSUE[issue.code]))
    .map(({ code, count }) => {
      const severity = QUALITY_SEVERITY[QUALITY_CHECK_OF_ISSUE[code]];
      return count === undefined ? { code, severity } : { code, count, severity };
    })
    .toSorted((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const status: FileQualityStatus = checking.has(plate.id)
    ? "checking"
    : report
      ? issues.length
        ? "issues"
        : "good"
      : (check?.status ?? "unchecked");
  return {
    plate_id: plate.id,
    filename: plate.filename,
    status,
    issues,
    triangles: report?.triangles ?? null,
    shells: report?.shells ?? null,
    size: report?.size ?? null,
  };
}

// The model's state is its most pressing file's: one still running, then one not yet checked, then one with issues.
const STATUS_ORDER: FileQualityStatus[] = ["checking", "unchecked", "issues", "good", "skipped"];

async function toPrintQualityOut(plates: Plate[]): Promise<PrintQualityOut> {
  const checksOff = new Set(await getQualityChecksOff());
  const files = plates
    .filter(isCheckable)
    .toSorted((a, b) => a.position - b.position)
    .map((plate) => toFileQualityOut(plate, checksOff));
  const status = STATUS_ORDER.find((candidate) => files.some((file) => file.status === candidate)) ?? "none";
  return { enabled: true, status, files };
}

async function ownedPlates(userId: string, printId: string): Promise<Plate[] | null> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, include: { plates: true } });
  return print ? print.plates : null;
}

/** Null when the model isn't the user's. */
export async function printQuality(userId: string, printId: string): Promise<PrintQualityOut | null> {
  const plates = await ownedPlates(userId, printId);
  if (!plates) return null;
  const enabled = await getQualityChecks();
  return enabled ? toPrintQualityOut(plates) : { enabled: false, status: "none", files: [] };
}

/** Starts checking each of the model's files not checked yet, and returns at once with them "checking". */
export async function startPrintQualityCheck(userId: string, printId: string): Promise<PrintQualityOut | null> {
  const plates = await ownedPlates(userId, printId);
  if (!plates) return null;
  if (!(await getQualityChecks())) return { enabled: false, status: "none", files: [] };
  for (const plate of plates) {
    if (!isCheckable(plate) || checking.has(plate.id) || storedCheck(plate)) continue;
    checking.add(plate.id);
    void checkPlate(plate);
  }
  return toPrintQualityOut(plates);
}

async function checkPlate(plate: Plate): Promise<void> {
  let result: StoredCheck;
  try {
    const srcPath = resolvePlateFilePath(plate);
    if (!srcPath) {
      result = { version: QUALITY_CHECK_VERSION, status: "skipped", reason: "missing-file" };
    } else {
      const outcome = await checkPlateQuality(plate.id, srcPath, path.extname(plate.filename).toLowerCase());
      if (outcome.status === "checked") result = outcome.report;
      else {
        if (outcome.status === "error") console.error(`Quality check failed for plate ${plate.id}:`, outcome.error);
        else if (outcome.status === "limit")
          console.warn(`Quality check for plate ${plate.id} stopped: ${outcome.reason}`);
        // Recorded either way, so a file that can't be checked isn't retried on every open.
        result = { version: QUALITY_CHECK_VERSION, status: "skipped", reason: outcome.status };
      }
    }
    await prisma.plate.update({
      where: { id: plate.id },
      data: { qualityCheck: result as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    // Most likely the plate was deleted mid-check.
    console.warn(`Quality check for plate ${plate.id} not saved:`, err);
  } finally {
    checking.delete(plate.id);
  }
}
