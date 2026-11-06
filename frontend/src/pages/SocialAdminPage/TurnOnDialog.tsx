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
import PublicIcon from "@mui/icons-material/Public";
import RemoveIcon from "@mui/icons-material/Remove";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { UnauthorizedError } from "../../api/client";
import { canTurnOn, federationApi, type FederationSettings, type Reachability } from "../../api/federation";
import HelpTip from "../../components/HelpTip";
import { prefersReducedMotion } from "../../components/storageAnimations/parts";
import { statusTint, type StatusTone } from "../../theme";
import { Mono } from "./parts";

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

const key = (name: string) => `adminSettings.social.federation.check.${name}`;

type Tone = StatusTone | "neutral";
type CheckRow = { tone: Tone; icon: React.ReactElement; label: string; detail: string | null };

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
      else setError(err instanceof Error ? err.message : t(key("failed")));
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
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t(key("failed")));
      setSaving(false);
    }
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
          detail: t(key("leadsElsewhereDetail")),
        });
      } else if (kind === "public_unverified") {
        rows.push({
          tone: "warning",
          icon: <ReportProblemOutlinedIcon />,
          label: t(key("noLoopback")),
          detail: t(key("noLoopbackDetail")),
        });
      } else {
        rows.push({ tone: "error", icon: <CloseIcon />, label: t(key("noAnswer")), detail: t(key("noAnswerDetail")) });
      }
      const addresses = result.addresses.join(", ") || null;
      if (kind === "local")
        rows.push({ tone: "info", icon: <HomeOutlinedIcon />, label: t(key("addressLocal")), detail: addresses });
      else if (kind === "public" || kind === "public_unverified")
        rows.push({ tone: "info", icon: <PublicIcon />, label: t(key("addressPublic")), detail: addresses });
      else rows.push({ tone: "neutral", icon: <RemoveIcon />, label: t(key("addressSkipped")), detail: null });
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
          : {
              tone: "error",
              icon: <ReportProblemOutlinedIcon />,
              title: t(key("unreachableTitle")),
              text: t(kind === "not_set" ? key("notSetText") : key("unreachableText")),
            };

  const help = [t(key("helpApprove")), t(key("helpShare")), t(key("helpOff"))];
  const tint = (tone: Tone) => (tone === "neutral" ? null : statusTint(theme, tone));
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
                const colors = tint(row.tone);
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
                        bgcolor: colors?.background ?? "action.hover",
                        color: colors?.text ?? "text.secondary",
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
                  <Button color="inherit" size="small" onClick={() => navigate("/admin-auth")}>
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
          disabled={checking || saving || !canTurnOn(kind)}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t(key("turnOn"))}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
