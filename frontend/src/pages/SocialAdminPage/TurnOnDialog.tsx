import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import LinkIcon from "@mui/icons-material/Link";
import PublicIcon from "@mui/icons-material/Public";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { UnauthorizedError } from "../../api/client";
import {
  canTurnOn,
  FederationError,
  federationApi,
  linksOnly,
  type FederationSettings,
  type ProbeFailure,
  type Reachability,
} from "../../api/federation";
import HelpTip from "../../components/HelpTip";
import { prefersReducedMotion } from "../../components/storageAnimations/parts";
import { federationErrorText } from "./federationErrors";
import { statusTint, type StatusTone } from "../../theme";
import { Mono } from "./parts";

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

const key = (name: string) => `adminSettings.social.federation.check.${name}`;

type CheckRow = { tone: StatusTone; icon: React.ReactElement; label: string; detail: string | null };

const FAILURE_KEYS: Record<ProbeFailure, string> = {
  reserved: "reserved",
  not_found: "notFound",
  timeout: "timeout",
  refused: "refused",
  certificate: "certificate",
  redirect: "redirect",
  failed: "failed",
};

type Props = {
  onClose: () => void;
  onTurnedOn: (settings: FederationSettings) => void;
  onUnauthorized?: () => void;
};

/** Turning connected instances on: first whether other instances could reach this one, then the switch. */
export default function TurnOnDialog({ onClose, onTurnedOn, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const theme = useTheme();
  const still = prefersReducedMotion();
  const [result, setResult] = React.useState<Reachability | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Bumped per check, so the rows appear again one by one.
  const [round, setRound] = React.useState(0);

  const check = React.useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const { reachability } = await federationApi.check();
      setResult(reachability);
      setRound((value) => value + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof FederationError ? federationErrorText(err, t) : t(key("failed")));
    } finally {
      setChecking(false);
    }
  }, [onUnauthorized, t]);

  React.useEffect(() => {
    void check();
  }, [check]);

  const turnOn = async () => {
    setSaving(true);
    setError(null);
    try {
      onTurnedOn(await federationApi.setEnabled(true));
    } catch (err) {
      setSaving(false);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      // Checked again on turning on, and its Public URL is gone or reserved now: the new result says so.
      if (err instanceof FederationError && (err.code === "no_public_url" || err.code === "reserved_address")) {
        await check();
        return;
      }
      setError(err instanceof FederationError ? federationErrorText(err, t) : t(key("failed")));
    }
  };

  /** Why the Public URL didn't lead back here, as the check found it. */
  const failureRow = (found: Reachability, url: string): CheckRow => {
    const reason = found.reason ?? "failed";
    const address = new URL(url);
    const detail =
      reason === "reserved"
        ? found.addresses.join(", ") || null
        : reason === "timeout"
          ? t(key("failure.timeoutDetail"))
          : reason === "not_found"
            ? t(key("failure.notFoundDetail"), { host: address.hostname })
            : reason === "refused"
              ? t(key("failure.refusedDetail"), { host: address.host })
              : (found.detail ?? null);
    return { tone: "error", icon: <CloseIcon />, label: t(key(`failure.${FAILURE_KEYS[reason]}`)), detail };
  };

  const kind = result?.kind;
  const rows: CheckRow[] = [];
  if (result) {
    rows.push(
      result.url
        ? { tone: "success", icon: <CheckIcon />, label: t(key("urlSet")), detail: result.url }
        : { tone: "error", icon: <CloseIcon />, label: t(key("urlNotSet")), detail: null },
    );
    if (result.url) {
      if (kind === "local" || kind === "public") {
        rows.push({
          tone: "success",
          icon: <CheckIcon />,
          label: t(key("leadsHere")),
          detail: t(key("leadsHereDetail")),
        });
      } else if (kind === "elsewhere") {
        rows.push({
          tone: "error",
          icon: <CloseIcon />,
          label: t(key("leadsElsewhere")),
          detail: result.detail
            ? t(key("leadsElsewhereAnswered"), { answer: result.detail })
            : t(key("leadsElsewhereDetail")),
        });
      } else if (kind === "public_unverified") {
        // A redirect or a certificate is something to fix, whoever answered; silence may just be the router.
        rows.push(
          result.reason === "redirect" || result.reason === "certificate"
            ? { ...failureRow(result, result.url), tone: "warning", icon: <ReportProblemOutlinedIcon /> }
            : {
                tone: "warning",
                icon: <ReportProblemOutlinedIcon />,
                label: t(key("noLoopback")),
                detail: t(key("noLoopbackDetail")),
              },
        );
      } else {
        rows.push(failureRow(result, result.url));
      }
      // Where it is matters once something answers there.
      const addresses = result.addresses.join(", ") || null;
      if (kind === "local")
        rows.push({ tone: "info", icon: <HomeOutlinedIcon />, label: t(key("addressLocal")), detail: addresses });
      else if (kind === "public" || kind === "public_unverified")
        rows.push({ tone: "info", icon: <PublicIcon />, label: t(key("addressPublic")), detail: addresses });
    }
  }

  const banner: { tone: StatusTone; icon: React.ReactElement; title: string; text: string } | null = !result
    ? null
    : kind === "local"
      ? { tone: "info", icon: <HomeOutlinedIcon />, title: t(key("localTitle")), text: t(key("localText")) }
      : kind === "public"
        ? { tone: "success", icon: <PublicIcon />, title: t(key("publicTitle")), text: t(key("publicText")) }
        : kind === "public_unverified"
          ? { tone: "warning", icon: <PublicIcon />, title: t(key("unverifiedTitle")), text: t(key("unverifiedText")) }
          : linksOnly(result)
            ? { tone: "warning", icon: <LinkIcon />, title: t(key("linksOnlyTitle")), text: t(key("linksOnlyText")) }
            : {
                tone: "error",
                icon: <ReportProblemOutlinedIcon />,
                title: t(key("unreachableTitle")),
                text: t(kind === "not_set" ? key("notSetText") : key("reservedText")),
              };

  const help = [t(key("helpApprove")), t(key("helpShare")), t(key("helpOff"))];
  const motion = (delay: number) =>
    still ? {} : { opacity: 0, animation: `${appear} 0.3s ease-out ${delay}s forwards` };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t("adminSettings.social.federation.turnOnTitle")}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} disabled={saving} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t(key("intro"))}
          </Typography>
          {checking && (
            <Stack component="output" direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2">{t(key("checking"))}</Typography>
            </Stack>
          )}
          {!checking && result && (
            <Stack key={round} aria-live="polite">
              {rows.map((row, index) => {
                const colors = statusTint(theme, row.tone);
                return (
                  <Stack
                    key={row.label}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    sx={{
                      py: 1,
                      borderBottom: index < rows.length - 1 ? 1 : 0,
                      borderColor: "divider",
                      ...motion(0.15 + index * 0.35),
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: colors.background,
                        color: colors.text,
                        "& svg": { fontSize: 16 },
                      }}
                    >
                      {row.icon}
                    </Box>
                    <Stack sx={{ minWidth: 0 }}>
                      <Typography variant="body2">{row.label}</Typography>
                      {row.detail && <Mono>{row.detail}</Mono>}
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          )}
          {!checking && banner && (
            <Alert
              key={`banner-${round}`}
              severity={banner.tone}
              icon={banner.icon}
              sx={motion(0.15 + rows.length * 0.35)}
              action={
                kind === "not_set" || kind === "elsewhere" || kind === "unreachable" ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => navigate("/admin-auth")}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    {t(key("publicUrlButton"))}
                  </Button>
                ) : undefined
              }
            >
              <Typography variant="body2" fontWeight={600}>
                {banner.title}
              </Typography>
              <Typography variant="body2">{banner.text}</Typography>
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {t(key("youApprove"))}
            </Typography>
            <HelpTip
              text={help.join(" ")}
              content={
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {help.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </Box>
              }
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        <Button startIcon={<RefreshIcon />} onClick={() => void check()} disabled={checking || saving}>
          {t(key("again"))}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void turnOn()}
          disabled={checking || saving || !canTurnOn(result)}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t(key("turnOn"))}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
