import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DownloadDoneIcon from "@mui/icons-material/DownloadDone";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi, type CommunityWidgetUsage, type WidgetInUse, type WidgetManifest } from "../../api/widgets";
import Segmented from "../../components/controls/Segmented";
import RollingNumber from "../../components/RollingNumber";
import { WidgetIcon } from "../DashboardPage/CustomWidgetCard";

const SOURCE_URL = "https://github.com/TautvydasDerzinskas/Thingport/tree/main/community-widgets";

type Tab = "inUse" | "community";

const rise = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Tiles come in one after another, up to a short cap so a long list doesn't keep the last waiting. */
const appear = (index: number) => ({
  animation: `${rise} 260ms ease-out both`,
  animationDelay: `${Math.min(index, 10) * 35}ms`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

const GRID = { display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" } as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

function UserAvatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        fontWeight: 600,
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
        color: "primary.main",
      }}
    >
      {initials(name)}
    </Avatar>
  );
}

function StatTile({
  icon,
  value,
  label,
  index,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  index: number;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, ...appear(index) }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1.5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "primary.main",
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" fontWeight={700} lineHeight={1.2} sx={{ overflow: "hidden" }}>
          <RollingNumber value={value} />
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {label}
        </Typography>
      </Box>
    </Paper>
  );
}

/** A widget's icon, name and byline: the head of both kinds of tile. */
function WidgetHead({ manifest, badge }: { manifest: WidgetManifest; badge?: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1.5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "primary.main",
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
        }}
      >
        <WidgetIcon icon={manifest.icon} iconUrl={manifest.iconUrl} size={24} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {manifest.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {[manifest.version && `v${manifest.version}`, manifest.author].filter(Boolean).join(" · ")}
        </Typography>
      </Box>
      {badge}
    </Stack>
  );
}

const tileSx = {
  p: 1.5,
  borderRadius: 2,
  border: 1,
  borderColor: "divider",
  bgcolor: "background.paper",
  transition: "transform 180ms, box-shadow 180ms, border-color 180ms",
} as const;

function InUseTile({ widget, index, onOpen }: { widget: WidgetInUse; index: number; onOpen: () => void }) {
  const { t } = useTranslation("app");
  const placed = widget.users.filter((user) => user.placed).length;
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={t("adminSettings.dashboard.inUse.open", { name: widget.manifest.name })}
      sx={{
        ...tileSx,
        ...appear(index),
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 1.5,
        "&:hover": {
          transform: "translateY(-2px)",
          borderColor: "primary.main",
          boxShadow: (theme) => `0 6px 18px ${alpha(theme.palette.primary.main, 0.14)}`,
        },
        "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
      }}
    >
      <WidgetHead
        manifest={widget.manifest}
        badge={
          <Chip
            size="small"
            variant="outlined"
            color={widget.source === "community" ? "primary" : "default"}
            label={t(`adminSettings.dashboard.inUse.${widget.source}`)}
            sx={{ height: 20, flexShrink: 0 }}
          />
        }
      />
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <AvatarGroup max={5} sx={{ "& .MuiAvatar-root": { width: 24, height: 24, fontSize: 10, borderWidth: 1.5 } }}>
          {widget.users.map((user) => (
            <UserAvatar key={user.id} name={user.displayName} />
          ))}
        </AvatarGroup>
        <Typography variant="caption" color="text.secondary" noWrap>
          {t("adminSettings.dashboard.inUse.placed", { count: placed })}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

function CommunityTile({ widget, index }: { widget: CommunityWidgetUsage; index: number }) {
  const { t } = useTranslation("app");
  return (
    <Box sx={{ ...tileSx, ...appear(index), display: "flex", flexDirection: "column", gap: 1 }}>
      <WidgetHead
        manifest={widget.manifest}
        badge={
          <Tooltip title={t("adminSettings.dashboard.community.source")}>
            <IconButton
              size="small"
              href={`${SOURCE_URL}/${widget.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t("adminSettings.dashboard.community.source")}: ${widget.manifest.name}`}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        }
      />
      {widget.manifest.description && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {widget.manifest.description}
        </Typography>
      )}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: "auto" }}>
        <Chip
          size="small"
          icon={<DownloadDoneIcon />}
          color={widget.installs > 0 ? "primary" : "default"}
          variant={widget.installs > 0 ? "filled" : "outlined"}
          label={t("adminSettings.dashboard.community.installs", { count: widget.installs })}
          sx={{ height: 22 }}
        />
        {widget.outdated > 0 && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={t("adminSettings.dashboard.community.outdated", { count: widget.outdated })}
            sx={{ height: 22 }}
          />
        )}
        {widget.manifest.hosts.length > 0 && (
          <Tooltip title={widget.manifest.hosts.join(", ")}>
            <Chip
              size="small"
              variant="outlined"
              label={t("dashboard.custom.reaches", { count: widget.manifest.hosts.length })}
              sx={{ height: 22 }}
            />
          </Tooltip>
        )}
      </Stack>
    </Box>
  );
}

/** `widget` stays set while it closes, so it fades out with its content. */
function UsersDialog({ widget, open, onClose }: { widget: WidgetInUse | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      {widget && (
        <>
          <DialogTitle sx={{ pb: 1 }}>
            <WidgetHead manifest={widget.manifest} />
          </DialogTitle>
          <DialogContent dividers sx={{ p: 0 }}>
            <List dense>
              {widget.users.map((user) => (
                <ListItem
                  key={user.id}
                  secondaryAction={
                    <Chip
                      size="small"
                      variant="outlined"
                      color={user.placed ? "success" : "default"}
                      label={t(
                        user.placed
                          ? "adminSettings.dashboard.users.placed"
                          : "adminSettings.dashboard.users.installed",
                      )}
                      sx={{ height: 20 }}
                    />
                  }
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <UserAvatar name={user.displayName} size={32} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={user.displayName}
                    secondary={user.email}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                    sx={{ pr: 12 }}
                  />
                </ListItem>
              ))}
            </List>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("common:close")}</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

function SkeletonGrid({ height }: { height: number }) {
  return (
    <Box sx={GRID}>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} variant="rounded" height={height} />
      ))}
    </Box>
  );
}

type Props = {
  /** Off, the community tab says users can't install them. */
  communityOn: boolean;
  onUnauthorized?: () => void;
};

/** The widgets users have, and the community repository's with their installs. */
export default function WidgetUsage({ communityOn, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [tab, setTab] = React.useState<Tab>("inUse");
  const [inUse, setInUse] = React.useState<WidgetInUse[] | null>(null);
  const [inUseError, setInUseError] = React.useState(false);
  const [community, setCommunity] = React.useState<CommunityWidgetUsage[] | null>(null);
  const [communityError, setCommunityError] = React.useState(false);
  const [open, setOpen] = React.useState<WidgetInUse | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const fail = React.useCallback(
    (setError: (failed: boolean) => void) => (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(true);
    },
    [onUnauthorized],
  );

  const loadInUse = React.useCallback(() => {
    setInUseError(false);
    widgetsApi.inUse().then(setInUse, fail(setInUseError));
  }, [fail]);

  // Only once its tab is opened: it asks GitHub for every widget.
  const loadCommunity = React.useCallback(() => {
    setCommunityError(false);
    widgetsApi.communityUsage().then(setCommunity, fail(setCommunityError));
  }, [fail]);

  React.useEffect(loadInUse, [loadInUse]);
  React.useEffect(() => {
    if (tab === "community" && community === null) loadCommunity();
  }, [tab, community, loadCommunity]);

  const users = new Set(inUse?.flatMap((widget) => widget.users.map((user) => user.id)) ?? []);
  const stats = [
    { icon: <ExtensionOutlinedIcon fontSize="small" />, value: inUse?.length ?? 0, key: "widgets" },
    { icon: <PeopleOutlineIcon fontSize="small" />, value: users.size, key: "users" },
    {
      icon: <DashboardOutlinedIcon fontSize="small" />,
      value: inUse?.reduce((sum, widget) => sum + widget.users.filter((user) => user.placed).length, 0) ?? 0,
      key: "placed",
    },
    {
      icon: <DownloadDoneIcon fontSize="small" />,
      value: inUse?.filter((widget) => widget.source === "community").reduce((sum, w) => sum + w.users.length, 0) ?? 0,
      key: "installs",
    },
  ];

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
        {inUse === null && !inUseError
          ? stats.map((stat) => <Skeleton key={stat.key} variant="rounded" height={62} />)
          : stats.map((stat, index) => (
              <StatTile
                key={stat.key}
                index={index}
                icon={stat.icon}
                value={stat.value}
                label={t(`adminSettings.dashboard.stats.${stat.key}`)}
              />
            ))}
      </Box>
      <Box>
        <Segmented
          label={t("adminSettings.dashboard.heading")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "inUse", label: t("adminSettings.dashboard.tabs.inUse") },
            { value: "community", label: t("adminSettings.dashboard.tabs.community") },
          ]}
        />
      </Box>
      {tab === "inUse" &&
        (inUseError ? (
          <Alert severity="warning" action={<Button onClick={loadInUse}>{t("common:retry")}</Button>}>
            {t("adminSettings.dashboard.inUse.failed")}
          </Alert>
        ) : inUse === null ? (
          <SkeletonGrid height={92} />
        ) : inUse.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t("adminSettings.dashboard.inUse.empty")}
          </Typography>
        ) : (
          <Box sx={GRID}>
            {inUse.map((widget, index) => (
              <InUseTile
                key={widget.key}
                widget={widget}
                index={index}
                onOpen={() => {
                  setOpen(widget);
                  setDialogOpen(true);
                }}
              />
            ))}
          </Box>
        ))}
      {tab === "community" && (
        <Stack spacing={1.5}>
          {!communityOn && <Alert severity="info">{t("adminSettings.dashboard.community.off")}</Alert>}
          {communityError ? (
            <Alert severity="warning" action={<Button onClick={loadCommunity}>{t("common:retry")}</Button>}>
              {t("adminSettings.dashboard.community.error")}
            </Alert>
          ) : community === null ? (
            <SkeletonGrid height={124} />
          ) : community.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              {t("adminSettings.dashboard.community.empty")}
            </Typography>
          ) : (
            <Box sx={{ ...GRID, opacity: communityOn ? 1 : 0.6, transition: "opacity 200ms" }}>
              {community.map((widget, index) => (
                <CommunityTile key={widget.slug} widget={widget} index={index} />
              ))}
            </Box>
          )}
        </Stack>
      )}
      <UsersDialog widget={open} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
