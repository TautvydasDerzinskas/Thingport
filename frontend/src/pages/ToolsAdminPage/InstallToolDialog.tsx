import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { AdminTool } from "../../api/tools";

/** Over this many models, the set is big enough that the room it takes is worth saying out loud. */
const A_LOT = 25;

type Props = {
  tool: AdminTool | null;
  busy: boolean;
  onClose: () => void;
  onInstall: (withModels: boolean) => void;
};

/**
 * Asked before a tool that brings models is installed: are its models wanted now?
 *
 * They are by default, because a tool that needs them doesn't work without them. The two things an admin can't
 * see for themselves are said here: what the tool loses without them -- which differs between a tool that
 * imports its models from a site and one that carries them itself -- and that a big set costs real room.
 */
export default function InstallToolDialog({ tool, busy, onClose, onInstall }: Props) {
  const { t } = useTranslation("app");
  const [withModels, setWithModels] = useState(true);
  const models = tool?.manifest.collection?.models ?? [];
  const count = models.length;
  // A tool whose models are its own packed files fetches nothing, so the warning about the site it imports
  // from would be untrue of it.
  const ownFiles = count > 0 && models.every((model) => model.files?.length);

  // Every tool is asked afresh, so one installed without its models doesn't leave the switch off for the next.
  useEffect(() => {
    if (tool) setWithModels(true);
  }, [tool]);

  if (!tool) return null;
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("adminSettings.tools.repo.installTitle", { name: tool.manifest.name })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2">{t("adminSettings.tools.repo.installBody", { count })}</Typography>
          <FormControlLabel
            control={<Switch checked={withModels} onChange={(event) => setWithModels(event.target.checked)} />}
            label={t("adminSettings.tools.repo.withModels")}
            disabled={busy}
          />
          {withModels && count >= A_LOT && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              {t("adminSettings.tools.repo.modelsRoom", { count })}
            </Alert>
          )}
          {!withModels && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              {t(`adminSettings.tools.repo.${ownFiles ? "modelsLaterOwn" : "modelsLater"}`)}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button size="small" onClick={onClose} disabled={busy}>
          {t("common:cancel")}
        </Button>
        <Button size="small" variant="contained" disabled={busy} onClick={() => onInstall(withModels)}>
          {t("adminSettings.tools.repo.install")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
