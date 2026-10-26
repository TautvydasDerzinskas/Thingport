import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import RefreshIcon from "@mui/icons-material/Refresh";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import { adminApi, type AdminUser } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import {
  toolsApi,
  type AdminTool,
  type ToolCatalog,
  type OwnToolInUse,
  type ToolsAccessSettings,
} from "../../api/tools";
import { useConfirm } from "../../components/ConfirmProvider";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import SectionHeader from "../../components/SectionHeader";
import { useToast } from "../../components/ToastProvider";
import ToolIcon from "../../components/tools/ToolIcon";
import ToolScreenshots from "../../components/tools/ToolScreenshots";
import { reloadTools } from "../../hooks/useTools";

// While a tool's models are being fetched, the page asks how far it's got this often.
const POLL_MS = 3000;

const appear = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;

type Props = { onUnauthorized?: () => void };

function Heading({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center" }}>
      {children}
      {help && <HelpTip text={help} />}
    </Typography>
  );
}

/** Tools for the instance: which are installed from the repository, who may use them, and the ones users made. */
export default function ToolsAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const confirm = useConfirm();
  const [access, setAccess] = useState<ToolsAccessSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [own, setOwn] = useState<OwnToolInUse[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; tool: AdminTool } | null>(null);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : fallback, severity: "error" });
    },
    [onUnauthorized, toast],
  );

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await toolsApi.catalog());
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.failed"));
      setCatalog((prev) => prev ?? { tools: [], repoError: err instanceof Error ? err.message : String(err) });
    }
  }, [fail, t]);

  useEffect(() => {
    void toolsApi.getAccess().then(setAccess, (err: unknown) => fail(err, t("adminSettings.tools.access.failed")));
    void adminApi.listUsers().then(setUsers, () => undefined);
    void toolsApi.ownInUse().then(setOwn, () => setOwn([]));
    void loadCatalog();
  }, [fail, loadCatalog, t]);

  // Following a fetch of models as it goes.
  const fetching = catalog?.tools.some((tool) => tool.installed?.models?.fetching) ?? false;
  useEffect(() => {
    if (!fetching) return;
    const timer = window.setInterval(() => void loadCatalog(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetching, loadCatalog]);

  const changeAccess = async (patch: Partial<ToolsAccessSettings>) => {
    if (!access) return;
    const previous = access;
    setAccess({ ...access, ...patch });
    try {
      setAccess(await toolsApi.setAccess(patch));
      await reloadTools().catch(() => undefined);
    } catch (err) {
      setAccess(previous);
      fail(err, t("adminSettings.tools.access.failed"));
    }
  };

  const install = async (tool: AdminTool) => {
    setBusy(tool.slug);
    try {
      await toolsApi.install(tool.slug);
      toast({
        message: t(tool.installed ? "adminSettings.tools.repo.updated" : "adminSettings.tools.repo.installed", {
          name: tool.manifest.name,
        }),
        severity: "success",
      });
      await Promise.all([loadCatalog(), reloadTools().catch(() => undefined)]);
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.installFailed"));
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (tool: AdminTool) => {
    const ok = await confirm({
      title: t("adminSettings.tools.repo.uninstallTitle", { name: tool.manifest.name }),
      message: tool.manifest.collection
        ? t("adminSettings.tools.repo.uninstallWithModels", { name: tool.manifest.name })
        : t("adminSettings.tools.repo.uninstallMessage", { name: tool.manifest.name }),
      confirmLabel: t("adminSettings.tools.repo.uninstall"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(tool.slug);
    try {
      await toolsApi.uninstall(tool.slug);
      toast({ message: t("adminSettings.tools.repo.uninstalled", { name: tool.manifest.name }), severity: "success" });
      await Promise.all([loadCatalog(), reloadTools().catch(() => undefined)]);
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.uninstallFailed"));
    } finally {
      setBusy(null);
    }
  };

  const retry = async (tool: AdminTool) => {
    try {
      await toolsApi.fetchModels(tool.slug);
      await loadCatalog();
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.installFailed"));
    }
  };

  const selected = users.filter((user) => access?.userIds.includes(user.id));

  return (
    <Stack spacing={4}>
      <SectionHeader title={t("adminSettings.tools.heading")} subtitle={t("adminSettings.tools.subtitle")} />

      <Stack spacing={1.5}>
        <Heading help={t("adminSettings.tools.access.help")}>{t("adminSettings.tools.access.heading")}</Heading>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, maxWidth: 720 }}>
          <Stack spacing={2}>
            <Box>
              {access ? (
                <Segmented
                  label={t("adminSettings.tools.access.audience")}
                  value={access.audience}
                  onChange={(audience) => void changeAccess({ audience })}
                  options={[
                    { value: "admins", label: t("adminSettings.tools.access.admins") },
                    { value: "everyone", label: t("adminSettings.tools.access.everyone") },
                    { value: "selected", label: t("adminSettings.tools.access.selected") },
                  ]}
                />
              ) : (
                <CircularProgress size={20} />
              )}
            </Box>
            {access?.audience === "selected" && (
              <Box
                sx={{
                  animation: `${appear} 200ms ease-out`,
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                <Autocomplete
                  multiple
                  size="small"
                  options={users.filter((user) => user.role !== "ADMIN")}
                  value={selected}
                  onChange={(_event, value) => void changeAccess({ userIds: value.map((user) => user.id) })}
                  getOptionLabel={(user) => user.display_name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderOption={(props, user) => (
                    <li {...props} key={user.id}>
                      <ListItemText primary={user.display_name} secondary={user.email} />
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t("adminSettings.tools.access.users")}
                      helperText={t("adminSettings.tools.access.usersHint")}
                    />
                  )}
                />
              </Box>
            )}
            <Divider />
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={600} id="user-tools-label">
                  {t("adminSettings.tools.access.userTools")}
                  <HelpTip text={t("adminSettings.tools.access.userToolsHelp")} />
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {access?.userTools
                    ? t("adminSettings.tools.access.userToolsOn")
                    : t("adminSettings.tools.access.userToolsOff")}
                </Typography>
              </Box>
              <Switch
                checked={access?.userTools ?? false}
                disabled={!access}
                onChange={(event) => void changeAccess({ userTools: event.target.checked })}
                slotProps={{ input: { "aria-labelledby": "user-tools-label" } }}
              />
            </Stack>
          </Stack>
        </Paper>
      </Stack>

      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Heading help={t("adminSettings.tools.repo.help")}>{t("adminSettings.tools.repo.heading")}</Heading>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t("adminSettings.tools.repo.refresh")}>
            <IconButton
              size="small"
              aria-label={t("adminSettings.tools.repo.refresh")}
              onClick={() => void loadCatalog()}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        {catalog?.source && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: -0.75,
              wordBreak: "break-all",
              fontFamily: catalog.source.kind === "folder" ? "monospace" : undefined,
            }}
          >
            {catalog.source.kind === "folder"
              ? t("adminSettings.tools.repo.fromFolder", { location: catalog.source.location })
              : t("adminSettings.tools.repo.fromRepository", { location: catalog.source.location })}
          </Typography>
        )}
        {catalog?.repoError && (
          <Alert severity="warning">{t("adminSettings.tools.repo.unreachable", { error: catalog.repoError })}</Alert>
        )}
        {catalog === null ? (
          <ListRowSkeletons count={3} leadSize={44} twoLines trailing />
        ) : catalog.tools.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("adminSettings.tools.repo.empty")}
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {catalog.tools.map((tool, index) => (
              <RepoToolRow
                key={tool.slug}
                tool={tool}
                index={index}
                busy={busy === tool.slug}
                onInstall={() => void install(tool)}
                onRetry={() => void retry(tool)}
                onMenu={(anchor) => setMenu({ anchor, tool })}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("adminSettings.tools.own.help")}>{t("adminSettings.tools.own.heading")}</Heading>
        {own === null ? (
          <ListRowSkeletons count={2} leadSize={32} twoLines />
        ) : own.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {access?.userTools ? t("adminSettings.tools.own.empty") : t("adminSettings.tools.own.off")}
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ maxWidth: 720 }}>
            {own.map((tool) => (
              <Stack key={tool.id} direction="row" alignItems="center" spacing={1.5} sx={{ px: 1 }}>
                <Box sx={{ display: "flex", color: "primary.main" }}>
                  <ToolIcon iconUrl={tool.manifest.iconUrl} size={22} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {tool.manifest.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {t("adminSettings.tools.own.by", { name: tool.owner.displayName, email: tool.owner.email })}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu?.tool.installed?.models && menu.tool.installed.models.ready < menu.tool.installed.models.total && (
          <MenuItem
            disabled={menu.tool.installed.models.fetching}
            onClick={() => {
              const tool = menu.tool;
              setMenu(null);
              void retry(tool);
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.tools.repo.retry")}</ListItemText>
          </MenuItem>
        )}
        {menu?.tool.installed?.models && <Divider />}
        <MenuItem
          onClick={() => {
            const tool = menu!.tool;
            setMenu(null);
            void uninstall(tool);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("adminSettings.tools.repo.uninstall")}</ListItemText>
        </MenuItem>
      </Menu>
    </Stack>
  );
}

type RowProps = {
  tool: AdminTool;
  index: number;
  busy: boolean;
  onInstall: () => void;
  onRetry: () => void;
  onMenu: (anchor: HTMLElement) => void;
};

/** One of the repository's tools: what it is, whether it's installed, and how far its models have come. */
function RepoToolRow({ tool, index, busy, onInstall, onRetry, onMenu }: RowProps) {
  const { t } = useTranslation("app");
  const { manifest, installed } = tool;
  const models = installed?.models ?? null;
  const missing = models ? models.total - models.ready : 0;

  const status = !installed
    ? null
    : !tool.inRepo
      ? { label: t("adminSettings.tools.repo.gone"), color: "warning" as const }
      : installed.updateAvailable
        ? {
            // Its files changed without a new version number: there's still an update to take.
            label:
              installed.version === manifest.version
                ? t("adminSettings.tools.repo.updateAvailable")
                : t("adminSettings.tools.repo.updateTo", { version: manifest.version }),
            color: "info" as const,
          }
        : {
            label: t("adminSettings.tools.repo.installedVersion", { version: installed.version }),
            color: "success" as const,
          };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        borderRadius: 2,
        maxWidth: 720,
        animation: `${appear} 220ms ease-out both`,
        animationDelay: `${Math.min(index * 40, 240)}ms`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: "12px",
            border: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "primary.main",
          }}
        >
          <ToolIcon iconUrl={manifest.iconUrl} size={26} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Typography variant="body2" fontWeight={600}>
              {manifest.name}
            </Typography>
            {status && <Chip size="small" variant="outlined" color={status.color} label={status.label} />}
          </Stack>
          {manifest.description && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
              {manifest.description}
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled" component="div">
            {[
              manifest.author && t("adminSettings.tools.repo.by", { name: manifest.author }),
              manifest.collection && t("adminSettings.tools.repo.brings", { count: manifest.collection.models.length }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
          <ToolScreenshots slug={tool.slug} name={manifest.name} screenshots={manifest.screenshots ?? []} />
          {models && (missing > 0 || models.fetching) && (
            <Box sx={{ mt: 1.25 }} aria-live="polite">
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {models.fetching
                    ? t("adminSettings.tools.repo.fetching", { ready: models.ready, total: models.total })
                    : t("adminSettings.tools.repo.missing", { count: missing, total: models.total })}
                </Typography>
                {!models.fetching && (
                  <Button size="small" startIcon={<DownloadIcon fontSize="small" />} onClick={onRetry}>
                    {t("adminSettings.tools.repo.retry")}
                  </Button>
                )}
              </Stack>
              <LinearProgress
                variant="determinate"
                value={models.total ? (models.ready / models.total) * 100 : 0}
                sx={{ mt: 0.5, borderRadius: 1, height: 6 }}
              />
              {!models.fetching && models.failed.length > 0 && (
                <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                  {t("adminSettings.tools.repo.lastError", { error: models.failed[0].reason })}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
          {(!installed || (installed.updateAvailable && tool.inRepo)) && (
            <Button
              size="small"
              variant={installed ? "outlined" : "contained"}
              startIcon={
                busy ? (
                  <CircularProgress size={14} color="inherit" />
                ) : installed ? (
                  <SystemUpdateAltIcon fontSize="small" />
                ) : (
                  <DownloadIcon fontSize="small" />
                )
              }
              disabled={busy || !tool.inRepo}
              onClick={onInstall}
            >
              {installed ? t("adminSettings.tools.repo.update") : t("adminSettings.tools.repo.install")}
            </Button>
          )}
          {installed && (
            <Tooltip title={t("adminSettings.tools.repo.more")}>
              <IconButton
                size="small"
                aria-label={t("adminSettings.tools.repo.moreFor", { name: manifest.name })}
                disabled={busy}
                onClick={(event) => onMenu(event.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
