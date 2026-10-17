import React from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LanguageIcon from "@mui/icons-material/Language";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import MemoryIcon from "@mui/icons-material/Memory";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import { UnauthorizedError } from "../../api/client";
import {
  adminApi,
  type HealthComponent,
  type HealthReport,
  type HealthResult,
  type HealthStatus,
} from "../../api/admin";
import SectionHeader from "../../components/SectionHeader";
import { formatFileSize } from "../../utils/fileSize";
import { relativeTime } from "../../utils/relativeTime";

type Props = {
  onUnauthorized?: () => void;
};

type Need = "required" | "recommended" | "optional";

/** How much Thingport needs each one, and where it's set up. Order comes from the server: by importance. */
const COMPONENTS: Record<HealthComponent, { icon: React.ReactNode; need: Need; settings?: string }> = {
  database: { icon: <StorageIcon />, need: "required", settings: "/admin-connections?tab=database" },
  storage: { icon: <FolderOutlinedIcon />, need: "required", settings: "/admin-storage" },
  memory: { icon: <MemoryIcon />, need: "required", settings: "/admin-rendering" },
  // Nothing in Thingport to set up: it's the server's network.
  internet: { icon: <LanguageIcon />, need: "recommended" },
  flaresolverr: { icon: <ShieldOutlinedIcon />, need: "recommended", settings: "/admin-connections?tab=flaresolverr" },
  thingiverse: { icon: <CloudOutlinedIcon />, need: "recommended", settings: "/admin-providers" },
  ai: { icon: <AutoAwesomeOutlinedIcon />, need: "optional", settings: "/admin-ai" },
  smtp: { icon: <MailOutlineIcon />, need: "optional", settings: "/admin-connections?tab=smtp" },
};

const STATUS_COLOR: Record<HealthStatus, "success" | "warning" | "error" | "default"> = {
  ok: "success",
  warning: "warning",
  error: "error",
  not_configured: "default",
};

/** The facts worth a glance, in words; the rest stay out of the way. */
function factsLine(result: HealthResult, t: (key: string, options?: Record<string, unknown>) => string): string[] {
  const { facts } = result;
  const lines: string[] = [];
  const bytes = (key: string) => (typeof facts[key] === "number" ? formatFileSize(facts[key] as number) : null);
  if (typeof facts.version === "string" && facts.version) lines.push(facts.version);
  if (typeof facts.model === "string") lines.push(`${facts.model} @ ${facts.host}`);
  if (typeof facts.host === "string" && result.component === "smtp") lines.push(`${facts.host}:${facts.port}`);
  if (typeof facts.host === "string" && result.component === "internet") lines.push(facts.host);
  if (bytes("free_bytes")) {
    lines.push(t("adminSettings.health.facts.diskFree", { free: bytes("free_bytes"), total: bytes("total_bytes") }));
  }
  if (bytes("available_bytes")) {
    lines.push(
      t(facts.container_limited ? "adminSettings.health.facts.memoryContainer" : "adminSettings.health.facts.memory", {
        available: bytes("available_bytes"),
        total: bytes("total_bytes"),
      }),
    );
    lines.push(t("adminSettings.health.facts.process", { used: bytes("process_bytes") }));
  }
  if (result.latency_ms !== null) lines.push(t("adminSettings.health.facts.latency", { ms: result.latency_ms }));
  return lines;
}

function ComponentRow({
  component,
  result,
  testing,
  disabled,
  onTest,
}: {
  component: HealthComponent;
  result: HealthResult | null;
  testing: boolean;
  disabled: boolean;
  onTest: () => void;
}) {
  const { t, i18n } = useTranslation("app");
  const info = COMPONENTS[component];
  const base = `adminSettings.health.components.${component}`;
  const problem = result && result.status !== "ok";
  return (
    <Box sx={{ px: 2, py: 1.5, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}>
      {/* Two columns: what it is and how it's doing, as wide as the actions beside it allow. A phone stacks them. */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 2 }} alignItems={{ sm: "flex-start" }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ color: "text.secondary", pt: 0.25, "& svg": { fontSize: 22 } }}>{info.icon}</Box>
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body1" fontWeight={600}>
                {t(`${base}.name`)}
              </Typography>
              <Chip size="small" variant="outlined" label={t(`adminSettings.health.need.${info.need}`)} />
              <Chip
                size="small"
                color={result ? STATUS_COLOR[result.status] : "default"}
                variant={result && result.status !== "not_configured" ? "filled" : "outlined"}
                label={t(`adminSettings.health.status.${result?.status ?? "untested"}`)}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t(`${base}.description`)}
            </Typography>
            {result && result.status !== "not_configured" && factsLine(result, t).length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {factsLine(result, t).join(" · ")}
              </Typography>
            )}
            {problem && (
              <Alert
                severity={result.status === "error" ? "error" : result.status === "warning" ? "warning" : "info"}
                sx={{ py: 0.25 }}
              >
                {t(`${base}.problems.${result.code}`, { defaultValue: t("adminSettings.health.problems.unknown") })}
                {result.detail && (
                  <Typography
                    component="div"
                    variant="caption"
                    sx={{ mt: 0.5, fontFamily: "ui-monospace, Menlo, Consolas, monospace", wordBreak: "break-word" }}
                  >
                    {result.detail}
                  </Typography>
                )}
              </Alert>
            )}
          </Stack>
        </Stack>
        <Stack
          spacing={0.5}
          alignItems={{ xs: "flex-start", sm: "flex-end" }}
          sx={{ flexShrink: 0, pl: { xs: 4.75, sm: 0 } }}
        >
          <Stack direction="row" spacing={1}>
            {info.settings && (
              <Button size="small" component={RouterLink} to={info.settings}>
                {t("adminSettings.health.settings")}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={onTest}
              disabled={disabled}
              startIcon={testing ? <CircularProgress size={14} /> : undefined}
            >
              {t("adminSettings.health.test")}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap>
            {result
              ? t("adminSettings.health.testedAgo", { when: relativeTime(result.checked_at, i18n.language) })
              : t("adminSettings.health.neverTested")}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

/**
 * Everything Thingport relies on, with the last test of each and how to fix what's wrong. Nothing is tested on
 * opening: each component on its own, or all of them in a full test, when the admin asks.
 */
export default function SystemHealthSection({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const [report, setReport] = React.useState<HealthReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The one being tested, or "all" during a full test.
  const [testing, setTesting] = React.useState<HealthComponent | "all" | null>(null);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    },
    [onUnauthorized],
  );

  React.useEffect(() => {
    let active = true;
    adminApi.getHealth().then(
      (loaded) => active && setReport(loaded),
      (err: unknown) => active && fail(err),
    );
    return () => {
      active = false;
    };
  }, [fail]);

  const test = async (component?: HealthComponent) => {
    setTesting(component ?? "all");
    setError(null);
    try {
      setReport(await adminApi.testHealth(component));
    } catch (err) {
      fail(err);
    } finally {
      setTesting(null);
    }
  };

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.health.heading")}
        subtitle={t("adminSettings.health.subtitle")}
        actions={
          <Button
            variant="contained"
            onClick={() => void test()}
            disabled={testing !== null || !report}
            startIcon={testing === "all" ? <CircularProgress size={16} color="inherit" /> : <PlaylistPlayIcon />}
          >
            {t("adminSettings.health.testAll")}
          </Button>
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ borderRadius: "12px", overflow: "hidden" }}>
        {report
          ? report.components.map(({ component, result }) => (
              <ComponentRow
                key={component}
                component={component}
                result={result}
                testing={testing === component || testing === "all"}
                disabled={testing !== null}
                onTest={() => void test(component)}
              />
            ))
          : Array.from({ length: Object.keys(COMPONENTS).length }, (_, index) => (
              <Box key={index} sx={{ p: 2, "&:not(:last-of-type)": { borderBottom: 1, borderColor: "divider" } }}>
                <Skeleton width="40%" />
                <Skeleton width="85%" />
              </Box>
            ))}
      </Paper>
      {report && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
          {report.full_checked_at
            ? t("adminSettings.health.lastFullTest", {
                when: new Date(report.full_checked_at).toLocaleString(i18n.language),
                ago: relativeTime(report.full_checked_at, i18n.language),
              })
            : t("adminSettings.health.neverFullTest")}
        </Typography>
      )}
    </Stack>
  );
}
