import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import { useModelRepair } from "../Layout/ModelRepairContext";
import MissingFilesPanel from "./MissingFilesPanel";

/** Comes up on its own when a look at the library finds models whose files are gone, and is reachable again from
 *  the models page's Repair section. Putting it away is remembered against the count, so the same breakage never
 *  asks twice (ModelRepairContext). */
export default function MissingFilesDialog() {
  const { t } = useTranslation(["app", "common"]);
  const { promptOpen, closePrompt } = useModelRepair();

  return (
    <Dialog open={promptOpen} onClose={closePrompt} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <ReportProblemOutlinedIcon color="warning" />
          {t("missingFiles.title")}
        </Stack>
      </DialogTitle>
      <DialogContent>
        <MissingFilesPanel onStarted={closePrompt} />
      </DialogContent>
      <DialogActions>
        <Button onClick={closePrompt}>{t("missingFiles.notNow")}</Button>
      </DialogActions>
    </Dialog>
  );
}
