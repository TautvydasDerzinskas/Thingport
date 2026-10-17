import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { oidcApi, type ProfileSignIn } from "../../api/oidc";
import { useConfirm } from "../../components/ConfirmProvider";
import { relativeTime } from "../../utils/relativeTime";
import { useSsoResult } from "./useSignInMethods";

type Props = {
  info: ProfileSignIn | null;
  onChanged: () => void;
  onUnauthorized?: () => void;
};

/** The single sign-on providers the user can connect, or has: nothing at all on an instance without any. */
export default function SignInMethodsSection({ info, onChanged, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const confirm = useConfirm();
  const result = useSsoResult();
  const [notice, setNotice] = React.useState<{ severity: "success" | "error"; text: string } | null>(() =>
    result.connected
      ? { severity: "success", text: t("profile.signIn.connected", { name: result.connected }) }
      : result.error
        ? { severity: "error", text: result.error }
        : null,
  );
  const [busy, setBusy] = React.useState(false);

  if (!info || info.providers.length === 0) {
    // A result can still arrive after the provider was turned off.
    return notice ? <Alert severity={notice.severity}>{notice.text}</Alert> : null;
  }

  const fail = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else setNotice({ severity: "error", text: err instanceof Error ? err.message : String(err) });
  };

  const connect = async (slug: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const { url } = await oidcApi.connect(slug);
      window.location.assign(url);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };

  const disconnect = async (name: string, connectionId: string) => {
    const ok = await confirm({
      title: t("profile.signIn.disconnectTitle", { name }),
      message: t("profile.signIn.disconnectMessage", { name }),
      confirmLabel: t("profile.signIn.disconnect"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      await oidcApi.disconnect(connectionId);
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      {info.providers.map((provider) => {
        const { connection } = provider;
        const details = connection
          ? [
              connection.email
                ? t("profile.signIn.connectedAs", { email: connection.email })
                : t("profile.signIn.connectedShort"),
              connection.last_used_at
                ? t("profile.signIn.lastUsed", { when: relativeTime(connection.last_used_at, i18n.language) })
                : null,
              provider.enabled ? null : t("profile.signIn.turnedOff"),
            ]
              .filter(Boolean)
              .join(" · ")
          : t("profile.signIn.notConnected");
        return (
          <Stack key={provider.slug} direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body1">{provider.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {details}
              </Typography>
            </Box>
            {connection ? (
              <Button
                variant="text"
                color="error"
                disabled={busy}
                onClick={() => void disconnect(provider.name, connection.id)}
                sx={{ flexShrink: 0 }}
              >
                {t("profile.signIn.disconnect")}
              </Button>
            ) : (
              <Button
                variant="text"
                disabled={busy || !info.can_connect}
                onClick={() => void connect(provider.slug)}
                sx={{ flexShrink: 0 }}
              >
                {t("profile.signIn.connect")}
              </Button>
            )}
          </Stack>
        );
      })}
      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
    </Stack>
  );
}
