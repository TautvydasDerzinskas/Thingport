import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { adminApi, type PhotoKeep, type StorageUsage } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import { AnimatedTile } from "../../components/storageAnimations/parts";
import FloatingFolderAnimation from "../../components/storageAnimations/FloatingFolderAnimation";
import ConsumeSection from "./ConsumeSection";
import FileReuseSection from "./FileReuseSection";
import FreeUpSpaceDialog from "./FreeUpSpaceDialog";
import LicenseFilesSection from "./LicenseFilesSection";
import PhotosPerModelRow from "./PhotosPerModelRow";
import StorageBrowserDialog from "./StorageBrowserDialog";
import StorageSection from "./StorageSection";
import StorageUsageCard from "./StorageUsageCard";
import { useStorageCleanup } from "./useStorageCleanup";

type Props = {
  onUnauthorized?: () => void;
};

/** Where model files go: what's stored now, the folder layout, and the folder they're picked up from. */
export default function StoragePage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [browsing, setBrowsing] = useState(false);
  const [freeing, setFreeing] = useState(false);
  // undefined while loading; null when it couldn't be measured.
  const [usage, setUsage] = useState<StorageUsage | null | undefined>(undefined);
  const [keep, setKeep] = useState<PhotoKeep | null | undefined>(undefined);

  const load = useCallback(() => {
    adminApi.getStorageUsage().then(setUsage, (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      setUsage(null);
    });
    settingsApi.getPhotosPerModel().then(setKeep, (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      setKeep(null);
    });
  }, [onUnauthorized]);
  useEffect(load, [load]);
  // A clean-up that ends changes both: what's on disk, and the photos setting when it trimmed them.
  const { cleanup, running, start } = useStorageCleanup(load, onUnauthorized);

  return (
    <Stack spacing={4} divider={<Divider />}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2.5} alignItems="flex-start">
          <AnimatedTile>
            <FloatingFolderAnimation size={76} />
          </AnimatedTile>
          <Stack spacing={1.5} divider={<Divider />} sx={{ flex: 1, minWidth: 0 }}>
            <StorageUsageCard usage={usage} freeing={running} onFreeUp={() => setFreeing(true)} />
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
            <PhotosPerModelRow keep={keep} onChange={setKeep} onUnauthorized={onUnauthorized} />
          </Stack>
        </Stack>
      </Paper>
      <StorageSection onUnauthorized={onUnauthorized} />
      <FileReuseSection onUnauthorized={onUnauthorized} />
      <LicenseFilesSection onUnauthorized={onUnauthorized} />
      <ConsumeSection onUnauthorized={onUnauthorized} />
      {browsing && <StorageBrowserDialog onClose={() => setBrowsing(false)} onUnauthorized={onUnauthorized} />}
      {freeing && usage && (
        <FreeUpSpaceDialog
          usage={usage}
          cleanup={cleanup}
          keepSetting={keep ?? null}
          onStart={start}
          onClose={() => setFreeing(false)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Stack>
  );
}
