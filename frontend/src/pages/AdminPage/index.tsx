import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import StorageIcon from "@mui/icons-material/Storage";
import PublicIcon from "@mui/icons-material/Public";
import UpdateCheckSection from "./UpdateCheckSection";
import SectionHeader from "../../components/SectionHeader";
import SystemHealthSection from "./SystemHealthSection";
import { adminApi, type StorageUsage } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { formatFileSize } from "../../utils/fileSize";
import { THINGPORT_WEBSITE_URL } from "../../constants/website";

type Props = {
  onUnauthorized?: () => void;
};

export default function AdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  // undefined = loading, null = failed (the footer hides).
  const [storage, setStorage] = useState<StorageUsage | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    adminApi.getStorageUsage().then(
      (usage) => {
        if (!cancelled) setStorage(usage);
      },
      (err) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        setStorage(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  return (
    <Stack spacing={4} sx={{ maxWidth: 960 }}>
      <UpdateCheckSection onUnauthorized={onUnauthorized} />
      {storage !== null && (
        <Stack spacing={3}>
          <SectionHeader
            title={t("adminSettings.storageUsage.heading")}
            subtitle={t("adminSettings.storageUsage.subtitle")}
          />
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              title={
                storage
                  ? t("adminSettings.storageUsage.totalHint", {
                      models: formatFileSize(storage.model_bytes),
                      pictures: formatFileSize(storage.picture_bytes),
                      other: formatFileSize(storage.other_generated_bytes),
                    })
                  : undefined
              }
              sx={{ color: "text.secondary" }}
            >
              <StorageIcon fontSize="small" />
              {storage === undefined ? (
                <Skeleton width={420} />
              ) : (
                <Typography variant="body2">
                  {t("adminSettings.storageUsage.summary", {
                    total: formatFileSize(storage.total_bytes),
                    models: formatFileSize(storage.model_bytes),
                    count: storage.model_count,
                    pictures: formatFileSize(storage.picture_bytes),
                  })}
                </Typography>
              )}
            </Stack>
          </Paper>
        </Stack>
      )}
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
