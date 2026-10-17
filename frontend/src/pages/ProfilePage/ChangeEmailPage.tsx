import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import SectionHeader from "../../components/SectionHeader";
import { authApi, type AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import type { CaptchaAnswer } from "../../api/captcha";
import CaptchaField from "../../components/CaptchaField";
import { useCaptchaSettings } from "../../hooks/useCaptchaSettings";
import ConfirmIdentity from "./ConfirmIdentity";
import { useSignInMethods, useSsoResult } from "./useSignInMethods";

type Props = {
  user: AuthUser | null;
  onUserUpdated: (user: AuthUser) => void;
  onUnauthorized?: () => void;
};

export default function ChangeEmailPage({ user, onUserUpdated, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const captchaEnabled = useCaptchaSettings()?.change_email ?? false;
  const [captcha, setCaptcha] = React.useState<CaptchaAnswer | null>(null);
  const [captchaKey, setCaptchaKey] = React.useState(0);
  const { info, reload } = useSignInMethods(onUnauthorized);
  const sso = useSsoResult();
  // Without a password, a recent sign-in stands in for it.
  const noPassword = info?.has_password === false;
  const mustConfirm = noPassword && !info.signed_in_recently;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const result = await authApi.updateProfile({
        ...(noPassword ? {} : { current_password: password }),
        email: email.trim(),
        ...(captchaEnabled && captcha),
      });
      onUserUpdated(result.user);
      setPassword("");
      setStatus(
        result.user.pending_email
          ? t("profile.pendingEmail", { email: result.user.pending_email })
          : t("profile.emailUpdated"),
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("profile.genericError"));
      if (noPassword) reload();
    } finally {
      // Every attempt, successful or not, uses the captcha up.
      if (captchaEnabled) setCaptchaKey((k) => k + 1);
      setLoading(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 420 }}>
      <SectionHeader
        title={t("profile.changeEmailTitle")}
        subtitle={t("profile.changeEmailSubtitle")}
        onBack={() => navigate("/profile")}
        backLabel={t("profile.backToProfile")}
      />

      {user?.pending_email && (
        <Alert severity="info">{t("profile.pendingEmailNotice", { email: user.pending_email })}</Alert>
      )}
      {status && (
        <Alert severity="success" onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      {(error ?? sso.error) && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error ?? sso.error}
        </Alert>
      )}

      {mustConfirm ? (
        <ConfirmIdentity info={info} page="/profile/email" onUnauthorized={onUnauthorized} />
      ) : (
        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              type="email"
              label={t("profile.newEmailLabel")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              fullWidth
              size="small"
            />
            {!noPassword && (
              <TextField
                type="password"
                label={t("profile.currentPasswordLabel")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                size="small"
              />
            )}
            {captchaEnabled && <CaptchaField key={captchaKey} onChange={setCaptcha} disabled={loading} />}
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? t("profile.saving") : t("profile.saveEmail")}
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
