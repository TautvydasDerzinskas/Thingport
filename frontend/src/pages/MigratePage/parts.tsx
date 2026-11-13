import type { TFunction } from "i18next";
import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import { MigrateApiError, type MigrateRun, type MigrateRunError } from "../../api/migrate";

export const k = (key: string) => `adminSettings.migrate.${key}`;

/** The tile a source leads with: a server for another Thingport instance, a box of models for Manyfold. */
export function SourceTile({ source = "thingport", size = 40 }: { source?: MigrateRun["source"]; size?: number }) {
  const Icon = source === "manyfold" ? Inventory2OutlinedIcon : DnsOutlinedIcon;
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 2,
        display: "grid",
        placeItems: "center",
        color: "primary.main",
        bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.1),
      }}
    >
      <Icon fontSize={size >= 40 ? "medium" : "small"} />
    </Box>
  );
}

const KNOWN_ERRORS = new Set([
  "busy",
  "storage_move",
  "plain_dump",
  "not_a_dump",
  "dump_missing",
  "folder_relative",
  "folder_missing",
  "folder_is_storage",
  "folder_unreadable",
  "outside",
  "no_database",
  "no_rights",
  "no_restore_tool",
  "restore_failed",
  "not_thingport",
  "failed_change",
  "source_newer",
  "upgrade_failed",
  "interrupted",
  "too_big",
  "upload_failed",
  "no_people",
  "not_ready",
  "online_address",
  "online_unreachable",
  "online_token",
  "online_old",
  "online_dump",
  "online_lost",
  "manyfold_address",
  "manyfold_unreachable",
  "manyfold_not_manyfold",
  "manyfold_slow_down",
  "manyfold_key",
  "manyfold_old",
  "manyfold_lost",
  "manyfold_error",
]);

/** The tools' own output, shown under the sentence for what failed. */
const WITH_DETAILS = new Set(["restore_failed", "upgrade_failed", "unexpected"]);

/** What went wrong, translated where it's one of the server's known reasons. */
export function errorText(t: TFunction, error: MigrateRunError | null | undefined): string {
  if (!error) return "";
  if (KNOWN_ERRORS.has(error.code)) return t(k(`errors.${error.code}`), error.values ?? {});
  return t(k("errors.unexpected"));
}

/** The tools' own words, for the errors where they say more than the sentence. */
export function errorDetails(error: MigrateRunError | null | undefined): string | null {
  return error && WITH_DETAILS.has(error.code) && error.message ? error.message : null;
}

export function requestError(err: unknown): MigrateRunError {
  if (err instanceof MigrateApiError)
    return { code: err.code ?? "unexpected", message: err.message, values: err.values };
  return { code: "unexpected", message: err instanceof Error ? err.message : String(err) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Where it came from, as its row and its dialog name it. */
export function runTitle(t: TFunction, run: MigrateRun): string {
  const name = run.plan.address ? hostOf(run.plan.address) : (run.plan.dump?.name ?? run.plan.folder);
  if (run.source === "manyfold") return t(k("manyfold.runTitle"), { name });
  if (run.plan.version) return t(k("runs.fromRelease"), { name, version: run.plan.version });
  return t(k("runs.from"), { name });
}

export const isActive = (run: MigrateRun) => run.status === "preparing" || run.status === "running";

/** An address's host and port, as people name an instance. */
export function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
