import React from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import type { SocialSettings } from "../../api/social";
import SectionHeader from "../../components/SectionHeader";
import ConnectedInstancesRow, { useFederationSettings } from "./ConnectedInstancesRow";
import InstancesSection from "./InstancesSection";
import SocialFeaturesSection from "./SocialFeaturesSection";

type Props = {
  onUnauthorized?: () => void;
};

/** Administration → Social: what this instance's users share with each other, chats, and connected instances. */
export default function SocialAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
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
          <ConnectedInstancesRow
            settings={federation.settings}
            onSettings={federation.setSettings}
            socialEnabled={socialEnabled}
            onUnauthorized={onUnauthorized}
          />
        }
      />
      {federation.settings?.enabled && socialEnabled && <InstancesSection onUnauthorized={onUnauthorized} />}
    </Stack>
  );
}
