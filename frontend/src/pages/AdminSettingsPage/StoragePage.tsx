import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FloatingFolderAnimation from "../../components/storageAnimations/FloatingFolderAnimation";
import ConsumeSection from "./ConsumeSection";
import StorageBrowserDialog from "./StorageBrowserDialog";
import StorageSection from "./StorageSection";
import StorageUsageLine from "../AdminPage/StorageUsageLine";

type Props = {
  onUnauthorized?: () => void;
};

/** Where model files go: what's stored now, the folder layout, and the folder they're picked up from. */
export default function StoragePage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [browsing, setBrowsing] = useState(false);
  return (
    <Stack spacing={4} divider={<Divider />}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <AnimatedTile>
            <FloatingFolderAnimation size={76} />
          </AnimatedTile>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <StorageUsageLine onUnauthorized={onUnauthorized} icon={false} />
            <Divider sx={{ my: 1.5 }} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {t("adminSettings.storageBrowser.heading")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("adminSettings.storageBrowser.subtitle")}
                </Typography>
              </Box>
              <Button variant="outlined" onClick={() => setBrowsing(true)} sx={{ flexShrink: 0 }}>
                {t("adminSettings.storageBrowser.open")}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
      <StorageSection onUnauthorized={onUnauthorized} />
      <ConsumeSection onUnauthorized={onUnauthorized} />
      {browsing && <StorageBrowserDialog onClose={() => setBrowsing(false)} onUnauthorized={onUnauthorized} />}
    </Stack>
  );
}
