import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import CodeEditor from "../CodeEditor";
import { copyText } from "../../utils/clipboard";
import { saveBytesToDisk } from "../../utils/downloadResponse";

type Props = {
  name: string;
  source: string;
  onClose: () => void;
};

/** A script's source, to read. Nothing here edits it: the model's own copy is what the customizer runs. */
export default function ScriptCodeDialog({ name, source, onClose }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The browser wouldn't copy; the text is selectable, which is the fallback.
    }
  };

  const lines = source.split("\n").length;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="div" noWrap>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("models:customizer.code.lines", { count: lines })}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={copied ? t("models:customizer.code.copied") : t("models:customizer.code.copy")}>
          <IconButton size="small" onClick={() => void copy()} aria-label={t("models:customizer.code.copy")}>
            {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t("models:customizer.code.download")}>
          <IconButton
            size="small"
            onClick={() => void saveBytesToDisk(new TextEncoder().encode(source), name, "text/plain")}
            aria-label={t("models:customizer.code.download")}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose} aria-label={t("common:close")}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, height: "min(70vh, 640px)" }}>
        <CodeEditor
          value={source}
          onChange={() => {}}
          readOnly
          language="scad"
          label={t("models:customizer.code.label", { name })}
        />
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button size="small" onClick={onClose}>
          {t("common:close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
