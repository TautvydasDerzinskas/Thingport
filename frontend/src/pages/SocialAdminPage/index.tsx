import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import SectionHeader from "../../components/SectionHeader";
import SocialFeaturesSection from "./SocialFeaturesSection";

type Props = {
  onUnauthorized?: () => void;
};

/** Administration → Social: what this instance's users share with each other, and chats. */
export default function SocialAdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.social.heading")} subtitle={t("adminSettings.social.subtitle")} />
      <SocialFeaturesSection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
