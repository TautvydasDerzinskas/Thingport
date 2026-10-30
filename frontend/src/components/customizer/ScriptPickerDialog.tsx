import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import DataObjectIcon from "@mui/icons-material/DataObject";

type Props = {
  scripts: { id: string; filename: string }[];
  onPick: (id: string) => void;
  onClose: () => void;
};

/** Which script to customise, for a model that came with more than one. */
export default function ScriptPickerDialog({ scripts, onPick, onClose }: Props) {
  const { t } = useTranslation(["models", "common"]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>{t("models:customizer.pick.title")}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary", px: 2, pt: 1.5 }}>
          {t("models:customizer.pick.body", { count: scripts.length })}
        </Typography>
        <List dense sx={{ py: 1 }}>
          {scripts.map((script) => (
            <ListItemButton key={script.id} onClick={() => onPick(script.id)}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <DataObjectIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={script.filename} primaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button size="small" onClick={onClose}>
          {t("common:cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
