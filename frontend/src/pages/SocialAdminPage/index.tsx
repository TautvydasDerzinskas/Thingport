import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import type { SocialSettings } from "../../api/social";
import SectionHeader from "../../components/SectionHeader";
import ConnectedInstancesRow, { useFederationSettings } from "./ConnectedInstancesRow";
import InstancesSection from "./InstancesSection";
import SocialFeaturesSection from "./SocialFeaturesSection";
import AchievementsRow from "./AchievementsRow";

type Props = {
  onUnauthorized?: () => void;
};

/** Administration → Social: what this instance's users share with each other, chats, connected instances, and
 *  achievements (which work with social features off). */
export default function SocialAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [social, setSocial] = React.useState<SocialSettings | null>(null);
  const federation = useFederationSettings(onUnauthorized);
  const socialEnabled = social?.enabled ?? false;

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.social.heading")} subtitle={t("adminSettings.social.subtitle")} />
      <SocialFeaturesSection
        onUnauthorized={onUnauthorized}
        onSettings={setSocial}
        extraRow={
          <>
            <ConnectedInstancesRow
              settings={federation.settings}
              onSettings={federation.setSettings}
              socialEnabled={socialEnabled}
              onUnauthorized={onUnauthorized}
            />
            <Divider />
            <AchievementsRow onUnauthorized={onUnauthorized} />
          </>
        }
      />
      {federation.loadFailed && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={federation.reload}>
              {t("common:retry")}
            </Button>
          }
        >
          {t("adminSettings.social.federation.settingsLoadFailed")}
        </Alert>
      )}
      {federation.settings?.enabled && socialEnabled && <InstancesSection onUnauthorized={onUnauthorized} />}
    </Stack>
  );
}
