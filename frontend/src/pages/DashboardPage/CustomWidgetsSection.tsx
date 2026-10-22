import { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi, type CommunityWidget, type CustomWidget, type WidgetManifest } from "../../api/widgets";
import Segmented from "../../components/controls/Segmented";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import McpConnectDialog from "../../components/mcp/McpConnectDialog";
import { useCustomWidgets } from "../../hooks/useCustomWidgets";
import { readUser } from "../../utils/auth";
import { WidgetIcon } from "./CustomWidgetCard";
import WidgetEditorDialog from "./WidgetEditorDialog";

type Tab = "mine" | "community" | "share";

const GUIDE_URL = "https://github.com/TautvydasDerzinskas/Thingport/blob/main/docs/guides/custom-widgets.md";
const REPO_FOLDER_URL = "https://github.com/TautvydasDerzinskas/Thingport/tree/main/community-widgets";

/** The files a pull request adds under community-widgets/, as a zip to unpack there. */
async function downloadForPublishing(widget: CustomWidget) {
  const { strToU8, zipSync } = await import("fflate");
  const folder = widget.slug;
  // Shared widgets are credited; one saved before names were filled in gets the user's own.
  const manifest = { ...widget.manifest, author: widget.manifest.author || readUser()?.display_name || undefined };
  const credit = manifest.author
    ? `\nBy ${manifest.authorUrl ? `[${manifest.author}](${manifest.authorUrl})` : manifest.author}.\n`
    : "";
  const readme = `# ${manifest.name}\n\n${manifest.description || "What it shows, and what to set."}\n${credit}`;
  const files: Record<string, Uint8Array> = {
    [`${folder}/widget.json`]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    [`${folder}/widget.js`]: strToU8(widget.script),
    [`${folder}/README.md`]: strToU8(readme),
  };
  if (widget.html) files[`${folder}/widget.html`] = strToU8(widget.html);
  const blob = new Blob([zipSync(files)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folder}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

type Props = {
  /** Puts a widget on the dashboard showing. */
  onAdd: (widget: CustomWidget) => void;
  onUnauthorized?: () => void;
};

/** The user's custom widgets, the community's, and how to make and share them. */
export default function CustomWidgetsSection({ onAdd, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [tab, setTab] = useState<Tab>("mine");
  const custom = useCustomWidgets();

  if (custom && !custom.enabled) return <Alert severity="info">{t("dashboard.custom.off")}</Alert>;

  return (
    <Stack spacing={2}>
      <Box>
        <Segmented
          label={t("dashboard.custom.title")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "mine", label: t("dashboard.custom.tabs.mine") },
            { value: "community", label: t("dashboard.custom.tabs.community") },
            { value: "share", label: t("dashboard.custom.tabs.share") },
          ]}
        />
      </Box>
      {tab === "mine" && (
        <MyWidgets
          widgets={custom?.widgets ?? null}
          reload={custom?.reload}
          onAdd={onAdd}
          onBrowse={() => setTab("community")}
          onUnauthorized={onUnauthorized}
        />
      )}
      {tab === "community" && <Community reload={custom?.reload} onUnauthorized={onUnauthorized} />}
      {tab === "share" && <Share />}
    </Stack>
  );
}

function WidgetRow({
  manifest,
  extra,
  actions,
}: {
  manifest: WidgetManifest;
  extra?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "primary.main",
        }}
      >
        <WidgetIcon icon={manifest.icon} iconUrl={manifest.iconUrl} size={28} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {manifest.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {manifest.version && `v${manifest.version}`}
            {manifest.author && " · "}
            {manifest.author &&
              (manifest.authorUrl ? (
                <Link href={manifest.authorUrl} target="_blank" rel="noopener noreferrer" color="inherit">
                  {manifest.author}
                </Link>
              ) : (
                manifest.author
              ))}
          </Typography>
          {extra}
        </Stack>
        {manifest.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {manifest.description}
          </Typography>
        )}
      </Box>
      {actions}
    </Paper>
  );
}

function MyWidgets({
  widgets,
  reload,
  onAdd,
  onBrowse,
  onUnauthorized,
}: {
  widgets: CustomWidget[] | null;
  reload?: () => Promise<void>;
  onAdd: (widget: CustomWidget) => void;
  onBrowse: () => void;
  onUnauthorized?: () => void;
}) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const toast = useToast();
  const [menu, setMenu] = useState<{ widget: CustomWidget; anchor: HTMLElement } | null>(null);
  const [editing, setEditing] = useState<{ widget: CustomWidget | null } | null>(null);

  const remove = async (widget: CustomWidget) => {
    const ok = await confirm({
      title: t("dashboard.custom.removeTitle", { name: widget.manifest.name }),
      message: t("dashboard.custom.removeMessage"),
      confirmLabel: t("dashboard.custom.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await widgetsApi.remove(widget.id);
      await reload?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  };

  return (
    <Stack spacing={1}>
      <Box>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setEditing({ widget: null })}>
          {t("dashboard.custom.new")}
        </Button>
      </Box>
      {widgets === null ? (
        [0, 1].map((index) => <Skeleton key={index} variant="rounded" height={62} />)
      ) : widgets.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {t("dashboard.custom.none")}{" "}
          <Link component="button" type="button" onClick={onBrowse}>
            {t("dashboard.custom.browse")}
          </Link>
        </Typography>
      ) : (
        widgets.map((widget) => (
          <WidgetRow
            key={widget.id}
            manifest={widget.manifest}
            extra={
              widget.source === "community" && (
                <Chip size="small" variant="outlined" label={t("dashboard.custom.fromCommunity")} sx={{ height: 20 }} />
              )
            }
            actions={
              <>
                <Tooltip title={t("dashboard.custom.add")}>
                  <IconButton
                    size="small"
                    aria-label={`${t("dashboard.custom.add")}: ${widget.manifest.name}`}
                    onClick={() => onAdd(widget)}
                  >
                    <AddCircleOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("dashboard.custom.actions")}>
                  <IconButton
                    size="small"
                    aria-label={`${t("dashboard.custom.actions")}: ${widget.manifest.name}`}
                    aria-haspopup="menu"
                    onClick={(event) => setMenu({ widget, anchor: event.currentTarget })}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            }
          />
        ))
      )}
      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem
            key="edit"
            onClick={() => {
              setEditing({ widget: menu.widget });
              setMenu(null);
            }}
          >
            <ListItemIcon>
              {menu.widget.source === "own" ? (
                <EditOutlinedIcon fontSize="small" />
              ) : (
                <ContentCopyIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>
              {menu.widget.source === "own" ? t("dashboard.custom.edit") : t("dashboard.custom.copyToMine")}
            </ListItemText>
          </MenuItem>,
          <MenuItem
            key="download"
            onClick={() => {
              void downloadForPublishing(menu.widget);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.custom.download")}</ListItemText>
          </MenuItem>,
          <Divider key="divider" />,
          <MenuItem
            key="remove"
            sx={{ color: "error.main" }}
            onClick={() => {
              void remove(menu.widget);
              setMenu(null);
            }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.custom.remove")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
      <WidgetEditorDialog
        open={editing !== null}
        widget={editing?.widget ?? null}
        onClose={() => setEditing(null)}
        onUnauthorized={onUnauthorized}
        onSaved={(saved) => {
          setEditing(null);
          void reload?.();
          toast({ message: t("dashboard.custom.saved", { name: saved.manifest.name }), severity: "success" });
        }}
      />
    </Stack>
  );
}

function Community({ reload, onUnauthorized }: { reload?: () => Promise<void>; onUnauthorized?: () => void }) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const toast = useToast();
  const [widgets, setWidgets] = useState<CommunityWidget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    widgetsApi
      .community()
      .then(setWidgets)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(err instanceof Error ? err.message : String(err));
      });
  }, [onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  // Installing is consenting: the prompt says what the code can do and which hosts it reaches.
  const install = async (widget: CommunityWidget) => {
    const update = widget.installed !== null;
    const ok = await confirm({
      title: t(update ? "dashboard.custom.updateTitle" : "dashboard.custom.installTitle", {
        name: widget.manifest.name,
      }),
      message: (
        <>
          {t("dashboard.custom.installTrust")}
          {widget.manifest.hosts.length > 0 && (
            <>
              <br />
              <br />
              {t("dashboard.custom.installHosts", { hosts: widget.manifest.hosts.join(", ") })}
            </>
          )}
        </>
      ),
      confirmLabel: t(update ? "dashboard.custom.update" : "dashboard.custom.install"),
    });
    if (!ok) return;
    setBusy(widget.slug);
    try {
      await widgetsApi.install(widget.slug);
      await reload?.();
      load();
      toast({ message: t("dashboard.custom.installed", { name: widget.manifest.name }), severity: "success" });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (error)
    return (
      <Alert severity="warning" action={<Button onClick={load}>{t("dashboard.custom.retry")}</Button>}>
        {t("dashboard.custom.communityError")}
      </Alert>
    );
  if (!widgets)
    return (
      <Stack spacing={1}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="rounded" height={62} />
        ))}
      </Stack>
    );
  if (!widgets.length)
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {t("dashboard.custom.communityEmpty")}
      </Typography>
    );
  return (
    <Stack spacing={1}>
      {widgets.map((widget) => (
        <WidgetRow
          key={widget.slug}
          manifest={widget.manifest}
          extra={
            widget.manifest.hosts.length > 0 && (
              <Tooltip title={widget.manifest.hosts.join(", ")}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("dashboard.custom.reaches", { count: widget.manifest.hosts.length })}
                  sx={{ height: 20 }}
                />
              </Tooltip>
            )
          }
          actions={
            widget.installed && !widget.installed.updateAvailable ? (
              <Chip
                size="small"
                icon={<CheckIcon />}
                label={t("dashboard.custom.isInstalled")}
                color="success"
                variant="outlined"
              />
            ) : (
              <Button
                size="small"
                variant="outlined"
                disabled={busy === widget.slug}
                onClick={() => void install(widget)}
                aria-label={`${t(widget.installed ? "dashboard.custom.update" : "dashboard.custom.install")}: ${widget.manifest.name}`}
              >
                {t(widget.installed ? "dashboard.custom.update" : "dashboard.custom.install")}
              </Button>
            )
          }
        />
      ))}
    </Stack>
  );
}

function Share() {
  const { t } = useTranslation("app");
  const [connectOpen, setConnectOpen] = useState(false);
  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: "primary.main" }}>
          <AutoAwesomeOutlinedIcon fontSize="small" />
          <Typography variant="subtitle2" color="text.primary">
            {t("dashboard.custom.share.aiTitle")}
          </Typography>
        </Stack>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 }, typography: "body2", color: "text.secondary" }}>
          <li>{t("dashboard.custom.share.ai1")}</li>
          <li>
            <Trans t={t} i18nKey="dashboard.custom.share.ai2" components={{ strong: <strong /> }} />
          </li>
          <li>{t("dashboard.custom.share.ai3")}</li>
          <li>{t("dashboard.custom.share.ai4")}</li>
        </Box>
        <Button size="small" sx={{ mt: 1 }} onClick={() => setConnectOpen(true)}>
          {t("dashboard.custom.share.connect")}
        </Button>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: "primary.main" }}>
          <PublishOutlinedIcon fontSize="small" />
          <Typography variant="subtitle2" color="text.primary">
            {t("dashboard.custom.share.publishTitle")}
          </Typography>
        </Stack>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.5 }, typography: "body2", color: "text.secondary" }}>
          <li>{t("dashboard.custom.share.publish1")}</li>
          <li>
            <Trans
              t={t}
              i18nKey="dashboard.custom.share.publish2"
              components={{ folder: <Link href={REPO_FOLDER_URL} target="_blank" rel="noopener noreferrer" /> }}
            />
          </li>
          <li>{t("dashboard.custom.share.publish3")}</li>
          <li>{t("dashboard.custom.share.publish4")}</li>
        </Box>
        <Button size="small" sx={{ mt: 1 }} href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
          {t("dashboard.custom.share.guide")}
        </Button>
      </Paper>
      <McpConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
    </Stack>
  );
}
