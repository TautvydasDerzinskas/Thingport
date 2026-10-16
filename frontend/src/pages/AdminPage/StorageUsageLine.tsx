import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import StorageIcon from "@mui/icons-material/Storage";
import { adminApi, type StorageUsage } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { formatFileSize } from "../../utils/fileSize";

type Props = {
  onUnauthorized?: () => void;
  /** Off where a picture beside it already says what it is. */
  icon?: boolean;
};

/** How much of storage is used, and by what, in one line; nothing when it can't be measured. */
export default function StorageUsageLine({ onUnauthorized, icon = true }: Props) {
  const { t } = useTranslation("app");
  // undefined = loading, null = failed.
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

  if (storage === null) return null;
  return (
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
      sx={{ color: "text.secondary", minWidth: 0 }}
    >
      {icon && <StorageIcon fontSize="small" />}
      {storage === undefined ? (
        <Skeleton width={420} sx={{ maxWidth: "100%" }} />
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
  );
}
