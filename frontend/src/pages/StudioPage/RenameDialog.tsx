import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";

type Props = {
  /** Null keeps it closed. */
  value: string | null;
  title: string;
  /** An empty name is allowed for a feature, which then shows its type and number. */
  allowEmpty?: boolean;
  maxLength: number;
  onClose: () => void;
  onSave: (name: string) => void;
};

export default function RenameDialog({ value, title, allowEmpty, maxLength, onClose, onSave }: Props) {
  const { t } = useTranslation("common");
  const [text, setText] = useState("");
  useEffect(() => {
    if (value !== null) setText(value);
  }, [value]);
  const valid = allowEmpty || text.trim().length > 0;
  const save = () => {
    if (!valid) return;
    onSave(text.trim());
    onClose();
  };
  return (
    <Dialog open={value !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          fullWidth
          size="small"
          label={t("name")}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
          slotProps={{ htmlInput: { maxLength } }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button variant="contained" disableElevation disabled={!valid} onClick={save}>
          {t("save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
