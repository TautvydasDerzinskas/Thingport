import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import SectionHeader from "../../components/SectionHeader";
import { authApi } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import type { CaptchaAnswer } from "../../api/captcha";
import CaptchaField from "../../components/CaptchaField";
import { useCaptchaSettings } from "../../hooks/useCaptchaSettings";
import ConfirmIdentity from "./ConfirmIdentity";
import { useSignInMethods, useSsoResult } from "./useSignInMethods";

const MIN_PASSWORD_LENGTH = 8;

type Props = {
  onUnauthorized?: () => void;
};

export default function ChangePasswordPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const captchaEnabled = useCaptchaSettings()?.change_password ?? false;
  const [captcha, setCaptcha] = React.useState<CaptchaAnswer | null>(null);
  const [captchaKey, setCaptchaKey] = React.useState(0);
  const { info, reload } = useSignInMethods(onUnauthorized);
  const sso = useSsoResult();
  // Someone who only signs in through a provider sets their first password, without a current one to give.
  const settingFirst = info?.has_password === false;
  const mustConfirm = settingFirst && !info.signed_in_recently;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.register.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.register.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await authApi.updateProfile({
        ...(settingFirst ? {} : { current_password: currentPassword }),
        new_password: newPassword,
        ...(captchaEnabled && captcha),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus(settingFirst ? t("profile.signIn.passwordSet") : t("profile.passwordUpdated"));
      reload();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("profile.genericError"));
      // The recent sign-in may have run out while they typed: the page then asks to confirm.
      if (settingFirst) reload();
    } finally {
      // Every attempt, successful or not, uses the captcha up.
      if (captchaEnabled) setCaptchaKey((k) => k + 1);
      setLoading(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 420 }}>
      <SectionHeader
        title={settingFirst ? t("profile.signIn.setPasswordTitle") : t("profile.changePasswordTitle")}
        subtitle={settingFirst ? t("profile.signIn.setPasswordSubtitle") : t("profile.changePasswordSubtitle")}
        onBack={() => navigate("/profile")}
        backLabel={t("profile.backToProfile")}
      />

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
        <ConfirmIdentity info={info} page="/profile/password" onUnauthorized={onUnauthorized} />
      ) : (
        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {!settingFirst && (
              <TextField
                type="password"
                label={t("profile.currentPasswordLabel")}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                size="small"
              />
            )}
            <TextField
              type="password"
              label={t("profile.newPasswordLabel")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              helperText={t("auth.register.passwordHelp")}
              required
              fullWidth
              size="small"
            />
            <TextField
              type="password"
              label={t("profile.confirmNewPasswordLabel")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              fullWidth
              size="small"
            />
            {captchaEnabled && <CaptchaField key={captchaKey} onChange={setCaptcha} disabled={loading} />}
            <Button type="submit" variant="contained" disabled={loading}>
              {loading
                ? t("profile.saving")
                : settingFirst
                  ? t("profile.signIn.setPassword")
                  : t("profile.savePassword")}
            </Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
