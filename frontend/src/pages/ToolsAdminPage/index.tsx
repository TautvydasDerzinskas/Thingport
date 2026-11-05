import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import LaunchIcon from "@mui/icons-material/Launch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import { adminApi, type AdminUser } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import {
  toolsApi,
  type AdminTool,
  type Tool,
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
import { reloadTools, useTools } from "../../hooks/useTools";
import ToolWindow from "../../components/tools/ToolWindow";
import { AppGrid, AppTile } from "../../components/Layout/ConfigurationDialog/AppTiles";
import InstallToolDialog from "./InstallToolDialog";
import ToolDetailsDialog from "./ToolDetailsDialog";
import ToolUpdateBadge from "./ToolUpdateBadge";

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
  // The tools whose install, update or uninstall is in flight, by slug: finishing one tile's work mustn't free
  // another's, now that each tile has an update of its own a click away.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Kept in a ref as well, so a second click in the same tick is turned away before the state has landed.
  const inFlight = useRef(new Set<string>());
  const [menu, setMenu] = useState<{ anchor: HTMLElement; tool: AdminTool } | null>(null);
  // The admin's own copies of the installed tools, so one can be opened from here rather than from the Tools page.
  const mine = useTools();
  const [running, setRunning] = useState<Tool | null>(null);
  // The tool whose details are open, and the one being installed: a tool that brings models asks first.
  const [details, setDetails] = useState<AdminTool | null>(null);
  const [installing, setInstalling] = useState<AdminTool | null>(null);
  const openable = (tool: AdminTool) =>
    tool.installed ? (mine?.tools.find((ours) => ours.source === "repo" && ours.slug === tool.slug) ?? null) : null;

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

  /** A tool that brings models asks whether they are wanted; one that brings none just installs. */
  const startInstall = (tool: AdminTool) => {
    if (tool.manifest.collection?.models.length && !tool.installed) setInstalling(tool);
    // An update takes the models only where the instance already has them: one installed without them, to save the
    // room, isn't handed gigabytes by an update it didn't ask that of, and neither is one whose installed version
    // brought none and whose new one does. The details dialog still offers to import them.
    else void install(tool, tool.installed?.models?.imported === true);
  };

  /** Takes the tool for the work about to start, or says no because that same work is already running. */
  const claim = (slug: string) => {
    if (inFlight.current.has(slug)) return false;
    inFlight.current.add(slug);
    setBusy(new Set(inFlight.current));
    return true;
  };

  const release = (slug: string) => {
    inFlight.current.delete(slug);
    setBusy(new Set(inFlight.current));
  };

  const install = async (tool: AdminTool, withModels: boolean) => {
    if (!claim(tool.slug)) return;
    try {
      await toolsApi.install(tool.slug, withModels);
      toast({
        message: t(tool.installed ? "adminSettings.tools.repo.updated" : "adminSettings.tools.repo.installed", {
          name: tool.manifest.name,
        }),
        severity: "success",
      });
      await Promise.all([loadCatalog(), reloadTools().catch(() => undefined)]);
      setInstalling(null);
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.installFailed"));
    } finally {
      release(tool.slug);
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
    if (!claim(tool.slug)) return;
    try {
      await toolsApi.uninstall(tool.slug);
      setDetails(null);
      toast({ message: t("adminSettings.tools.repo.uninstalled", { name: tool.manifest.name }), severity: "success" });
      await Promise.all([loadCatalog(), reloadTools().catch(() => undefined)]);
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.uninstallFailed"));
    } finally {
      release(tool.slug);
    }
  };

  const importModels = async (tool: AdminTool) => {
    if (!claim(tool.slug)) return;
    try {
      await toolsApi.importModels(tool.slug);
      toast({
        message: t("adminSettings.tools.repo.importingModels", { name: tool.manifest.name }),
        severity: "success",
      });
      await Promise.all([loadCatalog(), reloadTools().catch(() => undefined)]);
    } catch (err) {
      fail(err, t("adminSettings.tools.repo.installFailed"));
    } finally {
      release(tool.slug);
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
  // The open tool as the latest catalogue load has it, not as it was when its tile was opened: the dialog shows
  // that entry, so its buttons act on it too -- models imported while it stood open are in it, and an update
  // mustn't then be taken as one that wants none, which would throw them away again.
  const current = details && (catalog?.tools.find((one) => one.slug === details.slug) ?? details);

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
          <>
            <AppGrid column={104}>
              {catalog.tools.map((tool, index) => (
                <Box
                  key={tool.slug}
                  sx={{
                    display: "grid",
                    // The tile takes the row's spare height, so the badges under a row of tiles line up.
                    gridTemplateRows: "1fr auto",
                    animation: `${appear} 220ms ease-out both`,
                    animationDelay: `${Math.min(index * 40, 240)}ms`,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  }}
                >
                  <AppTile
                    name={tool.manifest.name}
                    subtitle={
                      tool.installed
                        ? t("adminSettings.tools.repo.version", { version: tool.installed.version })
                        : undefined
                    }
                    logo={
                      <Box sx={{ display: "flex", color: "primary.main" }}>
                        <ToolIcon iconUrl={tool.manifest.iconUrl} size={36} />
                      </Box>
                    }
                    size={60}
                    tileBg="background.paper"
                    on={Boolean(tool.installed)}
                    badge={Boolean(tool.installed)}
                    highlighted={details?.slug === tool.slug || menu?.tool.slug === tool.slug}
                    tooltip={tool.manifest.description || undefined}
                    ariaLabel={t("adminSettings.tools.repo.tileLabel", {
                      name: tool.manifest.name,
                      state: t(
                        tool.installed
                          ? "adminSettings.tools.repo.isInstalled"
                          : "adminSettings.tools.repo.notInstalled",
                      ),
                    })}
                    onActivate={() => setDetails(tool)}
                    onClick={(event) => {
                      if ((event.nativeEvent as PointerEvent).pointerType === "touch") setDetails(tool);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (tool.installed) setMenu({ anchor: event.currentTarget, tool });
                    }}
                  />
                  <ToolUpdateBadge
                    tool={tool}
                    busy={busy.has(tool.slug)}
                    repoError={catalog.repoError}
                    onUpdate={() => startInstall(tool)}
                  />
                </Box>
              ))}
            </AppGrid>
            <Typography variant="caption" color="text.secondary">
              {t("adminSettings.tools.repo.shelfHint")}
            </Typography>
          </>
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
        {menu && openable(menu.tool) && (
          <MenuItem
            onClick={() => {
              const open = openable(menu.tool);
              setMenu(null);
              setRunning(open);
            }}
          >
            <ListItemIcon>
              <LaunchIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.tools.repo.open")}</ListItemText>
          </MenuItem>
        )}
        {menu && openable(menu.tool) && <Divider />}
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

      <InstallToolDialog
        tool={installing}
        busy={Boolean(installing && busy.has(installing.slug))}
        onClose={() => setInstalling(null)}
        onInstall={(withModels) => void install(installing!, withModels)}
      />
      <ToolDetailsDialog
        tool={current}
        busy={Boolean(current && busy.has(current.slug))}
        onClose={() => setDetails(null)}
        onInstall={() => current && startInstall(current)}
        onImportModels={() => current && void importModels(current)}
        onRetry={() => current && void retry(current)}
        onUninstall={() => current && void uninstall(current)}
        onOpen={current && openable(current) ? () => setRunning(openable(current)) : undefined}
      />
      <ToolWindow tool={running} onClose={() => setRunning(null)} onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
