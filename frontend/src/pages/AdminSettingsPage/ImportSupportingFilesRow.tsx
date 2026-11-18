import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { SUPPORTING_FILE_MB_OPTIONS, type SupportingFileLimit } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";
import { saveLastPick } from "../../utils/saveLastPick";

/** The toggle's choice as the setting it stands for; null for one the options don't hold. */
const asLimit = (value: string): SupportingFileLimit | null =>
  value === "off" || value === "any" ? value : (SUPPORTING_FILE_MB_OPTIONS.find((mb) => String(mb) === value) ?? null);

/** How large a file an import keeps beside a model as a supporting file -- instructions, notes, sources: none, up to a
 *  size, or any. */
export default function ImportSupportingFilesRow({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { t } = useTranslation("app");
  const toast = useToast();
  // undefined while it loads; failed when it couldn't be read, so no size shows as saved.
  const [limit, setLimit] = React.useState<SupportingFileLimit | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);
  // The last pick; one made while another is saving is saved once that's done, so the last pick is what's kept.
  const wanted = React.useRef<SupportingFileLimit | null>(null);
  const saving = React.useRef(false);
  // Off once the row has gone: a pick still waiting then isn't saved over one made since.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    settingsApi.getImportSupportingFiles().then(
      (saved) => {
        if (!active) return;
        // Read again after it couldn't be, as a sign-in starts it over: the choice shows rather than the error.
        setFailed(false);
        if (wanted.current === null) setLimit(saved);
      },
      (err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const select = async (value: string) => {
    if (limit === undefined) return;
    const next = asLimit(value);
    if (next === null || next === limit) return;
    wanted.current = next;
    setLimit(next);
    if (saving.current) return;
    saving.current = true;
    let saved = limit;
    try {
      saved = await saveLastPick(
        () => wanted.current ?? next,
        async (asked) => (saved = await settingsApi.updateImportSupportingFiles(asked)),
        () => !mounted.current,
      );
      setLimit(saved);
    } catch (err) {
      setLimit(saved);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("adminSettings.importSupportingFiles.saveFailed"), severity: "error" });
    } finally {
      saving.current = false;
    }
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={600} component="div" sx={{ display: "flex", alignItems: "center" }}>
          {t("adminSettings.importSupportingFiles.label")}
          <HelpTip text={t("adminSettings.importSupportingFiles.help")} />
        </Typography>
      </Box>
      {failed ? (
        <Typography variant="body2" color="text.secondary">
          {t("adminSettings.importSupportingFiles.loadFailed")}
        </Typography>
      ) : limit === undefined ? (
        <Skeleton variant="rounded" width={300} height={36} />
      ) : (
        <Segmented
          label={t("adminSettings.importSupportingFiles.label")}
          value={String(limit)}
          onChange={(value) => void select(value)}
          options={[
            { value: "off", label: t("adminSettings.importSupportingFiles.off") },
            ...SUPPORTING_FILE_MB_OPTIONS.map((mb) => ({
              value: String(mb),
              label: t("adminSettings.importSupportingFiles.size", { count: mb }),
            })),
            { value: "any", label: t("adminSettings.importSupportingFiles.any") },
          ]}
        />
      )}
    </Stack>
  );
}
