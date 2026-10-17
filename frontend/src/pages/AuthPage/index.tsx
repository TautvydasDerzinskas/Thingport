import React from "react";
import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Alert from "@mui/material/Alert";
import type { AuthUser } from "../../api/auth";
import Wordmark from "../../components/Wordmark";
import SignInPanel from "./SignInPanel";
import RegisterPanel, { type Invite } from "./RegisterPanel";
import ForgotPasswordPanel from "./ForgotPasswordPanel";
import SingleSignOnButtons from "./SingleSignOnButtons";
import type { SignInProvider } from "../../api/oidc";

type Props = {
  onSuccess: (token: string, expires_in: number, user: AuthUser) => void;
  apiUp: boolean | null;
  allowRegistrations: boolean;
  passwordResetEnabled: boolean;
  invite?: Invite | null;
  /** Offered under the password form; none means the page looks as it always has. */
  oidcProviders?: SignInProvider[];
};

const NO_PROVIDERS: SignInProvider[] = [];

export default function AuthPage({
  onSuccess,
  apiUp,
  allowRegistrations,
  passwordResetEnabled,
  invite = null,
  oidcProviders = NO_PROVIDERS,
}: Props) {
  const { t } = useTranslation("app");
  const [tab, setTab] = React.useState<"signIn" | "register">(invite ? "register" : "signIn");
  // Set while the forgot-password form replaces the tabs; carries over the typed sign-in email.
  const [forgotEmail, setForgotEmail] = React.useState<string | null>(null);
  // Closed registrations hide the Register tab unless this visit came from an invitation.
  const canRegister = allowRegistrations || invite !== null;

  return (
    <Paper
      elevation={8}
      sx={{
        width: "100%",
        maxWidth: 420,
        borderRadius: 3,
        p: 4,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Stack spacing={3} sx={{ mb: 3, textAlign: "center" }}>
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Wordmark size="lg" />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t("auth.subtitle")}
        </Typography>
      </Stack>

      {apiUp === false && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("auth.apiOffline")}
        </Alert>
      )}

      {forgotEmail === null && canRegister && (
        <Tabs
          value={tab}
          onChange={(_e, value) => setTab(value)}
          variant="fullWidth"
          sx={{ mb: 3, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab value="signIn" label={t("auth.signInTab")} />
          <Tab value="register" label={t("auth.registerTab")} />
        </Tabs>
      )}

      {forgotEmail !== null ? (
        <ForgotPasswordPanel initialEmail={forgotEmail} onBack={() => setForgotEmail(null)} />
      ) : tab === "register" && canRegister ? (
        <>
          <RegisterPanel onSuccess={onSuccess} invite={invite} />
          {/* An invitation can be taken up through a provider too, even one that doesn't create accounts. */}
          {invite && <SingleSignOnButtons providers={oidcProviders} inviteToken={invite.token} />}
        </>
      ) : (
        <>
          <SignInPanel onSuccess={onSuccess} onForgotPassword={passwordResetEnabled ? setForgotEmail : undefined} />
          <SingleSignOnButtons providers={oidcProviders} />
        </>
      )}
    </Paper>
  );
}
