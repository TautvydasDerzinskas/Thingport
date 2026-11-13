import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { PHOTO_KEEP_OPTIONS, type PhotoKeep } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";

type Props = {
  /** undefined while it loads, or where it couldn't be read. */
  keep: PhotoKeep | null | undefined;
  /** It couldn't be read: no setting is shown as saved, so none can be picked as if it changed one. */
  failed?: boolean;
  onChange: (keep: PhotoKeep | null) => void;
  onUnauthorized?: () => void;
};

const ALL = "all";

/** How many photos an import or a re-sync keeps from a model's page: all of them unless an admin picks fewer. */
export default function PhotosPerModelRow({ keep, failed = false, onChange, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const toast = useToast();
  // The last pick; one made while another is saving is saved once that's done, so the last pick is what's kept.
  const wanted = React.useRef<PhotoKeep | null>(null);
  const saving = React.useRef(false);

  const select = async (value: string) => {
    if (keep === undefined) return;
    const next = value === ALL ? null : (Number(value) as PhotoKeep);
    if (next === keep) return;
    wanted.current = next;
    onChange(next);
    if (saving.current) return;
    saving.current = true;
    let saved = keep;
    try {
      let asked: PhotoKeep | null;
      do {
        asked = wanted.current;
        saved = await settingsApi.updatePhotosPerModel(asked);
      } while (asked !== wanted.current);
      onChange(saved);
    } catch (err) {
      onChange(saved);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.photosPerModel.saveFailed"), severity: "error" });
    } finally {
      saving.current = false;
    }
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={600} component="div" sx={{ display: "flex", alignItems: "center" }}>
          {t("adminSettings.photosPerModel.label")}
          <HelpTip text={t("adminSettings.photosPerModel.help")} />
        </Typography>
      </Box>
      {failed ? (
        <Typography variant="body2" color="text.secondary">
          {t("adminSettings.photosPerModel.loadFailed")}
        </Typography>
      ) : keep === undefined ? (
        <Skeleton variant="rounded" width={220} height={36} />
      ) : (
        <Segmented
          label={t("adminSettings.photosPerModel.label")}
          value={keep === null ? ALL : String(keep)}
          onChange={(value) => void select(value)}
          options={[
            { value: ALL, label: t("adminSettings.photosPerModel.all") },
            // Most first, as "All" is.
            ...PHOTO_KEEP_OPTIONS.toReversed().map((option) => ({ value: String(option), label: String(option) })),
          ]}
        />
      )}
    </Stack>
  );
}
