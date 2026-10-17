import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import type { AuthUser } from "../../api/auth";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import ActivitySection from "./activity/ActivitySection";
import ApiTokenSection from "./ApiTokenSection";
import GrabConnectionsSection from "./GrabConnectionsSection";
import SignInMethodsSection from "./SignInMethodsSection";
import { useSignInMethods } from "./useSignInMethods";

type Props = {
  user: AuthUser | null;
  onUnauthorized?: () => void;
};

export default function ProfilePage({ user, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const avatarUrl = useGravatarUrl(user?.email, 128);
  const { info: signIn, reload: reloadSignIn } = useSignInMethods(onUnauthorized);
  // Until it's known, as it was: most accounts have one.
  const hasPassword = signIn?.has_password ?? true;

  return (
    // As wide as the activity below it, and centred in the page.
    <Stack spacing={4} sx={{ width: "fit-content", maxWidth: "100%", mx: "auto" }}>
      <Stack spacing={4}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            alt={user?.display_name}
            src={avatarUrl}
            sx={{ width: 64, height: 64, bgcolor: "primary.main", fontSize: 24 }}
          >
            {user?.display_name?.[0]?.toUpperCase()}
          </Avatar>
          <Box>
            <Typography
              variant="subtitle1"
              fontWeight={600}
              sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              {user?.display_name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {user?.email}
            </Typography>
          </Box>
        </Stack>

        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Box>
              <Typography variant="body1">{user?.email}</Typography>
              {user?.pending_email && (
                <Typography variant="caption" color="text.secondary">
                  {t("profile.pendingEmail", { email: user.pending_email })}
                </Typography>
              )}
            </Box>
            <Button variant="text" onClick={() => navigate("/profile/email")}>
              {t("profile.changeEmailLink")}
            </Button>
          </Stack>

          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            {hasPassword ? (
              <Typography variant="body1">••••••••</Typography>
            ) : (
              <Box>
                <Typography variant="body1">{t("profile.signIn.noPassword")}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("profile.signIn.noPasswordHint")}
                </Typography>
              </Box>
            )}
            <Button variant="text" onClick={() => navigate("/profile/password")} sx={{ flexShrink: 0 }}>
              {hasPassword ? t("profile.changePasswordLink") : t("profile.signIn.setPasswordLink")}
            </Button>
          </Stack>

          <SignInMethodsSection info={signIn} onChanged={reloadSignIn} onUnauthorized={onUnauthorized} />

          <ApiTokenSection onUnauthorized={onUnauthorized} />
          <GrabConnectionsSection onUnauthorized={onUnauthorized} />
        </Stack>
      </Stack>
      <ActivitySection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
