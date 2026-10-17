import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { oidcApi, type SignInProvider } from "../../api/oidc";

/** "Continue with ..." for each single sign-on provider, under the password form. */
export default function SingleSignOnButtons({
  providers,
  inviteToken,
}: {
  providers: SignInProvider[];
  /** Joining with an invitation: the provider account must have the invited email. */
  inviteToken?: string;
}) {
  const { t } = useTranslation("app");
  if (!providers.length) return null;
  return (
    <Stack spacing={1.5} sx={{ mt: 3 }}>
      <Divider sx={{ typography: "caption", color: "text.secondary" }}>{t("auth.sso.or")}</Divider>
      {providers.map((provider) => (
        // A full navigation: the provider's page takes over, then sends the browser back here.
        <Button
          key={provider.slug}
          component="a"
          href={inviteToken ? oidcApi.inviteUrl(provider.slug, inviteToken) : oidcApi.startUrl(provider.slug)}
          variant="outlined"
          size="large"
          fullWidth
          startIcon={<KeyOutlinedIcon />}
        >
          {t("auth.sso.continueWith", { name: provider.name })}
        </Button>
      ))}
    </Stack>
  );
}
