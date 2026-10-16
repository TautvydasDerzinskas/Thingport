import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Link from "@mui/material/Link";
import PublicIcon from "@mui/icons-material/Public";
import UpdateCheckSection from "./UpdateCheckSection";
import SectionHeader from "../../components/SectionHeader";
import SystemHealthSection from "./SystemHealthSection";
import StorageUsageLine from "./StorageUsageLine";
import StorageBrowserDialog from "../AdminSettingsPage/StorageBrowserDialog";
import { THINGPORT_WEBSITE_URL } from "../../constants/website";

type Props = {
  onUnauthorized?: () => void;
};

export default function AdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [browsing, setBrowsing] = useState(false);

  return (
    <Stack spacing={4} sx={{ maxWidth: 960 }}>
      <UpdateCheckSection onUnauthorized={onUnauthorized} />
      <Stack spacing={3}>
        <SectionHeader
          title={t("adminSettings.storageUsage.heading")}
          subtitle={t("adminSettings.storageUsage.subtitle")}
        />
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
            spacing={2}
          >
            <StorageUsageLine onUnauthorized={onUnauthorized} />
            <Button variant="outlined" size="small" onClick={() => setBrowsing(true)} sx={{ flexShrink: 0 }}>
              {t("adminSettings.storageBrowser.open")}
            </Button>
          </Stack>
        </Paper>
      </Stack>
      {browsing && <StorageBrowserDialog onClose={() => setBrowsing(false)} onUnauthorized={onUnauthorized} />}
      <SystemHealthSection onUnauthorized={onUnauthorized} />

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        title={t("adminSettings.website.hint")}
        sx={{ px: 0.5, color: "text.secondary" }}
      >
        <PublicIcon fontSize="small" />
        <Link href={THINGPORT_WEBSITE_URL} target="_blank" rel="noopener" variant="body2" underline="hover">
          {t("adminSettings.website.link")}
        </Link>
      </Stack>
    </Stack>
  );
}
