import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Segmented from "../../components/controls/Segmented";
import { exportableProfiles, type StudioDocument } from "../../studio/document";

type Format = "3mf" | "stl-zip";

type Props = {
  document: StudioDocument;
  downloading: boolean;
  onDownload: (format: Format) => void;
  onClose: () => void;
};

export default function StudioExportDialog({ document, downloading, onDownload, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [format, setFormat] = useState<Format>("3mf");
  const profiles = exportableProfiles(document);
  const canExport = profiles.length > 0;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("studio.design.export.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Segmented<Format>
            fullWidth
            label={t("studio.design.export.format")}
            value={format}
            options={[
              { value: "3mf", label: profiles.length > 1 ? t("studio.design.export.threeMfZipLabel") : "3MF" },
              { value: "stl-zip", label: "STL" },
            ]}
            disabled={downloading}
            onChange={setFormat}
          />
          <Typography variant="body2" color="text.secondary">
            {!canExport
              ? t("studio.design.nothingToExport")
              : format === "3mf"
                ? profiles.length > 1
                  ? t("studio.profiles.downloadZip")
                  : t("studio.design.export.threeMf")
                : t("studio.design.export.stlZip")}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:close")}</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!canExport}
          loading={downloading}
          onClick={() => onDownload(format)}
        >
          {t("common:download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
