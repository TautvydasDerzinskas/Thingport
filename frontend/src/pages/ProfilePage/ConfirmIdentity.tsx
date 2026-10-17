import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { UnauthorizedError } from "../../api/client";
import { oidcApi, type ConfirmPage, type ProfileSignIn } from "../../api/oidc";

type Props = {
  info: ProfileSignIn;
  /** The page to come back to once it's confirmed. */
  page: ConfirmPage;
  onUnauthorized?: () => void;
};

/** For someone without a password whose sign-in wasn't recent: sign in again through a provider to go on. */
export default function ConfirmIdentity({ info, page, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const connected = info.providers.filter((provider) => provider.enabled && provider.connection);

  const confirm = async (slug: string) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await oidcApi.confirm(slug, page);
      window.location.assign(url);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Alert severity="info">
      <Stack spacing={1.5}>
        <Typography variant="body2">
          {connected.length ? t("profile.signIn.confirmBody") : t("profile.signIn.confirmNoProvider")}
        </Typography>
        {connected.length > 0 && (
          <Stack direction="row" gap={1} flexWrap="wrap">
            {connected.map((provider) => (
              <Button
                key={provider.slug}
                variant="outlined"
                size="small"
                startIcon={<KeyOutlinedIcon />}
                disabled={busy}
                onClick={() => void confirm(provider.slug)}
              >
                {t("profile.signIn.confirmWith", { name: provider.name })}
              </Button>
            ))}
          </Stack>
        )}
        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
      </Stack>
    </Alert>
  );
}
