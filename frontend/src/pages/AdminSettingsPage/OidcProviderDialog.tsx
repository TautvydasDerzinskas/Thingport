import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { UnauthorizedError } from "../../api/client";
import { oidcApi, type OidcProvider, type OidcProviderInput } from "../../api/oidc";

type Props = {
  /** The provider to edit, or null to add one. */
  provider: OidcProvider | null;
  publicUrl: string | null;
  onClose: () => void;
  onSaved: (provider: OidcProvider, added: boolean) => void;
  onUnauthorized?: () => void;
};

const DEFAULT_SCOPES = "openid email profile";
// Mirrors the backend's rule for the part of the redirect URI that names the provider.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function slugFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "sso"
  );
}

type Draft = Omit<OidcProviderInput, "client_secret" | "slug"> & { client_secret: string; slug: string };

const draftOf = (provider: OidcProvider | null): Draft => ({
  name: provider?.name ?? "",
  slug: provider?.slug ?? "",
  issuer_url: provider?.issuer_url ?? "",
  client_id: provider?.client_id ?? "",
  client_secret: "",
  scopes: provider?.scopes ?? DEFAULT_SCOPES,
  // A new one stays off the sign-in page until it's been tested.
  enabled: provider?.enabled ?? false,
  create_accounts: provider?.create_accounts ?? false,
  link_by_email: provider?.link_by_email ?? false,
});

/** Adds or edits one single sign-on provider. */
export default function OidcProviderDialog({ provider, publicUrl, onClose, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(provider));
  // Follows the name until it's edited by hand.
  const [slugTouched, setSlugTouched] = useState(Boolean(provider));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuerCheck, setIssuerCheck] = useState<
    { state: "checking" } | { state: "ok"; issuer: string } | { state: "failed"; error: string } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const slug = provider ? provider.slug : slugTouched ? draft.slug : slugFrom(draft.name);
  const slugValid = SLUG_PATTERN.test(slug);
  const redirectUri = provider?.redirect_uri ?? (publicUrl ? `${publicUrl}/api/auth/oidc/${slug}/callback` : null);
  const scopesValid = draft.scopes.trim().split(/\s+/).includes("openid");
  const canSave =
    draft.name.trim() && draft.issuer_url.trim() && draft.client_id.trim() && slugValid && scopesValid && !saving;

  const checkIssuer = async () => {
    const issuerUrl = draft.issuer_url.trim();
    if (!issuerUrl) {
      setIssuerCheck(null);
      return;
    }
    setIssuerCheck({ state: "checking" });
    try {
      const result = await oidcApi.check(issuerUrl);
      setIssuerCheck(result.ok ? { state: "ok", issuer: result.issuer } : { state: "failed", error: result.error });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      setIssuerCheck(null);
    }
  };

  const copy = async () => {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const input: OidcProviderInput = {
      name: draft.name.trim(),
      issuer_url: draft.issuer_url.trim(),
      client_id: draft.client_id.trim(),
      scopes: draft.scopes.trim(),
      enabled: draft.enabled,
      create_accounts: draft.create_accounts,
      link_by_email: draft.link_by_email,
      // A blank field keeps the saved secret.
      ...(draft.client_secret ? { client_secret: draft.client_secret } : {}),
      ...(provider ? {} : { slug }),
    };
    try {
      const saved = provider ? await oidcApi.update(provider.id, input) : await oidcApi.create(input);
      onSaved(saved, !provider);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.signIn.dialog.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {provider
          ? t("adminSettings.signIn.dialog.editTitle", { name: provider.name })
          : t("adminSettings.signIn.dialog.addTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label={t("adminSettings.signIn.dialog.name")}
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            helperText={t("adminSettings.signIn.dialog.nameHelp", {
              label: t("auth.sso.continueWith", { name: draft.name.trim() || "Authentik" }),
            })}
            fullWidth
            size="small"
          />
          <TextField
            label={t("adminSettings.signIn.dialog.issuer")}
            placeholder="https://auth.example.com/application/o/thingport/"
            value={draft.issuer_url}
            onChange={(event) => {
              update("issuer_url", event.target.value);
              setIssuerCheck(null);
            }}
            onBlur={() => void checkIssuer()}
            error={issuerCheck?.state === "failed"}
            helperText={
              issuerCheck?.state === "checking"
                ? t("adminSettings.signIn.dialog.issuerChecking")
                : issuerCheck?.state === "ok"
                  ? t("adminSettings.signIn.dialog.issuerOk")
                  : issuerCheck?.state === "failed"
                    ? t("adminSettings.signIn.dialog.issuerFailed", { error: issuerCheck.error })
                    : t("adminSettings.signIn.dialog.issuerHelp")
            }
            slotProps={{
              input: {
                endAdornment:
                  issuerCheck?.state === "checking" ? (
                    <InputAdornment position="end">
                      <CircularProgress size={16} />
                    </InputAdornment>
                  ) : issuerCheck?.state === "ok" ? (
                    <InputAdornment position="end">
                      <CheckCircleOutlineIcon color="success" fontSize="small" />
                    </InputAdornment>
                  ) : undefined,
              },
            }}
            fullWidth
            size="small"
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label={t("adminSettings.signIn.dialog.clientId")}
              value={draft.client_id}
              onChange={(event) => update("client_id", event.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              type="password"
              label={t("adminSettings.signIn.dialog.clientSecret")}
              value={draft.client_secret}
              onChange={(event) => update("client_secret", event.target.value)}
              placeholder={provider?.has_client_secret ? t("adminSettings.signIn.dialog.secretSaved") : undefined}
              helperText={provider?.has_client_secret ? t("adminSettings.signIn.dialog.secretKeep") : undefined}
              autoComplete="new-password"
              fullWidth
              size="small"
            />
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">{t("adminSettings.signIn.dialog.redirectHeading")}</Typography>
            {redirectUri ? (
              <TextField
                value={redirectUri}
                helperText={t("adminSettings.signIn.dialog.redirectHelp")}
                slotProps={{
                  input: {
                    readOnly: true,
                    sx: { fontFamily: "monospace", fontSize: "0.8rem" },
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip
                          title={
                            copied ? t("adminSettings.signIn.dialog.copied") : t("adminSettings.signIn.dialog.copy")
                          }
                        >
                          <IconButton
                            size="small"
                            onClick={() => void copy()}
                            aria-label={t("adminSettings.signIn.dialog.copy")}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
                fullWidth
                size="small"
              />
            ) : (
              <Alert severity="warning">{t("adminSettings.signIn.publicUrlMissing")}</Alert>
            )}
            {!provider && (
              <TextField
                label={t("adminSettings.signIn.dialog.slug")}
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  update("slug", event.target.value.toLowerCase());
                }}
                error={!slugValid}
                helperText={t(
                  slugValid ? "adminSettings.signIn.dialog.slugHelp" : "adminSettings.signIn.dialog.slugInvalid",
                )}
                size="small"
                sx={{ maxWidth: 320 }}
              />
            )}
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{t("adminSettings.signIn.dialog.accountsHeading")}</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.create_accounts}
                  onChange={(event) => update("create_accounts", event.target.checked)}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{t("adminSettings.signIn.dialog.createAccounts")}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("adminSettings.signIn.dialog.createAccountsHelp")}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: "flex-start", "& .MuiSwitch-root": { mt: -0.5 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={draft.link_by_email}
                  onChange={(event) => update("link_by_email", event.target.checked)}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{t("adminSettings.signIn.dialog.linkByEmail")}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("adminSettings.signIn.dialog.linkByEmailHelp")}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: "flex-start", "& .MuiSwitch-root": { mt: -0.5 } }}
            />
            <FormControlLabel
              control={<Switch checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} />}
              label={
                <Stack>
                  <Typography variant="body2">{t("adminSettings.signIn.dialog.enabled")}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("adminSettings.signIn.dialog.enabledHelp")}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: "flex-start", "& .MuiSwitch-root": { mt: -0.5 } }}
            />
          </Stack>

          <TextField
            label={t("adminSettings.signIn.dialog.scopes")}
            value={draft.scopes}
            onChange={(event) => update("scopes", event.target.value)}
            error={!scopesValid}
            helperText={t(
              scopesValid ? "adminSettings.signIn.dialog.scopesHelp" : "adminSettings.signIn.dialog.scopesInvalid",
            )}
            fullWidth
            size="small"
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
          {saving
            ? t("adminSettings.signIn.dialog.saving")
            : provider
              ? t("adminSettings.signIn.dialog.save")
              : t("adminSettings.signIn.dialog.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
