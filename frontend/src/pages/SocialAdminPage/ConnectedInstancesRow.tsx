import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LinkIcon from "@mui/icons-material/Link";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PublicIcon from "@mui/icons-material/Public";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import { UnauthorizedError } from "../../api/client";
import { federationApi, linksOnly, type FederationSettings } from "../../api/federation";
import ConnectedInstancesAnimation from "../../components/adminAnimations/ConnectedInstancesAnimation";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import { useToast } from "../../components/ToastProvider";
import FeatureRow from "./FeatureRow";
import { federationErrorText } from "./federationErrors";
import KeyDialog from "./KeyDialog";
import { Mono, ToneChip } from "./parts";
import TurnOnDialog from "./TurnOnDialog";

export type SettingsUpdate = FederationSettings | ((previous: FederationSettings | null) => FederationSettings | null);

/** Connected instances' settings, read on opening and again when the tab comes back. A read that started before a
 *  change made here is dropped: it would put back what the change replaced. */
export function useFederationSettings(onUnauthorized?: () => void) {
  const [settings, setSettings] = React.useState<FederationSettings | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const changes = React.useRef(0);
  const update = React.useCallback((next: SettingsUpdate) => {
    changes.current += 1;
    setSettings(next);
  }, []);
  const load = React.useCallback(() => {
    const asked = changes.current;
    federationApi.getSettings().then(
      (value) => {
        if (asked !== changes.current) return;
        setSettings(value);
        setLoadFailed(false);
      },
      (err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setLoadFailed(true);
      },
    );
  }, [onUnauthorized]);
  React.useEffect(() => {
    load();
    const onReturn = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [load]);
  return { settings, setSettings: update, loadFailed, reload: load };
}

type Props = {
  settings: FederationSettings | null;
  onSettings: (update: SettingsUpdate) => void;
  socialEnabled: boolean;
  onUnauthorized?: () => void;
};

/** The third row of the features panel: off by default, turned on through the reachability check. */
export default function ConnectedInstancesRow({ settings, onSettings, socialEnabled, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const showToast = useToast();
  const [turningOn, setTurningOn] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [menu, setMenu] = React.useState<HTMLElement | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const k = (name: string) => `adminSettings.social.federation.${name}`;
  const enabled = settings?.enabled ?? false;
  const live = enabled && socialEnabled;

  const fail = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else showToast({ message: federationErrorText(err, t), severity: "error" });
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: t(k("turnOffTitle")),
      message: t(k("turnOffText")),
      confirmLabel: t(k("turnOff")),
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      onSettings(await federationApi.setEnabled(false));
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const checkAgain = async () => {
    if (!settings) return;
    setChecking(true);
    try {
      const { reachability } = await federationApi.check();
      // Onto the settings as they are by now: it may have been turned off meanwhile.
      onSettings((current) => current && { ...current, reachability });
    } catch (err) {
      fail(err);
    } finally {
      setChecking(false);
    }
  };

  const reach = settings?.reachability;
  const chip = !reach ? null : reach.kind === "local" ? (
    <ToneChip tone="info" icon={<HomeOutlinedIcon />} label={t(k("status.local"))} />
  ) : reach.kind === "public" || reach.kind === "public_unverified" ? (
    settings!.confirmedBy > 0 ? (
      <ToneChip
        tone="success"
        icon={<PublicIcon />}
        label={t(k("status.confirmed"), { count: settings!.confirmedBy })}
      />
    ) : (
      <ToneChip
        tone={reach.kind === "public" ? "success" : "warning"}
        icon={<PublicIcon />}
        label={t(k("status.unconfirmed"))}
      />
    )
  ) : linksOnly(reach) ? (
    <ToneChip tone="warning" icon={<LinkIcon />} label={t(k("status.linksOnly"))} />
  ) : (
    <ToneChip tone="error" icon={<ReportProblemOutlinedIcon />} label={t(k("status.unreachable"))} />
  );
  const statusHelp =
    reach?.kind === "local"
      ? t(k("status.localHelp"))
      : reach?.kind === "public" || reach?.kind === "public_unverified"
        ? t(k("status.publicHelp"))
        : linksOnly(reach)
          ? t(k("status.linksOnlyHelp"))
          : t(k("status.unreachableHelp"));

  const info = [t(k("infoPair")), t(k("infoApprove")), t(k("infoShare")), t(k("infoOff"))];

  return (
    <>
      <FeatureRow
        animation={<ConnectedInstancesAnimation key={String(live)} size={76} on={live} />}
        title={t(k("label"))}
        help={
          <HelpTip
            text={[t(k("infoTitle")), ...info].join(" ")}
            content={
              <>
                <Typography variant="subtitle2" component="div" sx={{ mb: 0.5 }}>
                  {t(k("infoTitle"))}
                </Typography>
                <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                  {info.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </Box>
              </>
            }
          />
        }
        summary={t(k("summary"))}
        checked={enabled}
        disabled={settings === null || !socialEnabled || saving}
        busy={saving}
        blockedReason={settings !== null && !socialEnabled ? t("adminSettings.social.chats.needsSocial") : undefined}
        onChange={(checked) => (checked ? setTurningOn(true) : void turnOff())}
        extra={
          enabled && reach ? (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ pt: 0.75 }}>
              {chip}
              <HelpTip text={statusHelp} />
              {reach.url && <Mono>{reach.url}</Mono>}
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => void checkAgain()} disabled={checking}>
                {t(k("checkAgain"))}
              </Button>
            </Stack>
          ) : undefined
        }
        actions={
          enabled ? (
            <Tooltip title={t(k("thisInstance"))}>
              <IconButton onClick={(event) => setMenu(event.currentTarget)} aria-label={t(k("thisInstance"))}>
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      <Menu open={menu !== null} anchorEl={menu} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={!settings?.fingerprint}
          onClick={() => {
            setMenu(null);
            setShowKey(true);
          }}
        >
          <ListItemIcon>
            <KeyOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k("showOwnKey"))}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            navigate("/admin-auth");
          }}
        >
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k("changePublicUrl"))}</ListItemText>
        </MenuItem>
      </Menu>
      {turningOn && (
        <TurnOnDialog
          onClose={() => setTurningOn(false)}
          onTurnedOn={(value) => {
            setTurningOn(false);
            onSettings(value);
            showToast({ message: t(k("turnedOn")) });
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
      {showKey && settings?.fingerprint && (
        <KeyDialog fingerprint={settings.fingerprint} origin={settings.publicUrl} onClose={() => setShowKey(false)} />
      )}
    </>
  );
}
