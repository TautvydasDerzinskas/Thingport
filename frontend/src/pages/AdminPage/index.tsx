import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import StorageIcon from "@mui/icons-material/Storage";
import PublicIcon from "@mui/icons-material/Public";
import UpdateCheckSection from "./UpdateCheckSection";
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
      <SystemHealthSection onUnauthorized={onUnauthorized} />

      {storage !== null && (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          title={t("adminSettings.storageUsage.hint")}
          sx={{ px: 0.5, color: "text.secondary" }}
        >
          <StorageIcon fontSize="small" />
          {storage === undefined ? (
            <Skeleton width={220} />
          ) : (
            <Typography variant="body2">
              {t("adminSettings.storageUsage.summary", {
                size: formatFileSize(storage.model_bytes),
                count: storage.model_count,
              })}
            </Typography>
          )}
        </Stack>
      )}

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
