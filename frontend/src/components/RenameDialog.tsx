import { useLayoutEffect, useRef, useState } from "react";
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
  label?: string;
  /** An empty name is allowed for a feature, which then shows its type and number. */
  allowEmpty?: boolean;
  maxLength: number;
  /** The button's label, Save when left out: Create for a name given to something new. */
  saveLabel?: string;
  /** Selects the name it opens with, so typing replaces a suggested one. */
  selectOnOpen?: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
};

export default function RenameDialog({
  value,
  title,
  label,
  allowEmpty,
  maxLength,
  saveLabel,
  selectOnOpen,
  onClose,
  onSave,
}: Props) {
  const { t } = useTranslation("common");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (value !== null) setText(value);
  }, [value]);
  const valid = allowEmpty || text.trim().length > 0;
  const save = () => {
    if (!valid) return;
    onSave(text.trim());
    onClose();
  };
  return (
    <Dialog
      open={value !== null}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      // Once open: a menu that opened it gives focus back to its button as it closes, after the field's autoFocus.
      TransitionProps={{
        onEntered: () => {
          input.current?.focus();
          if (selectOnOpen) input.current?.select();
        },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          fullWidth
          size="small"
          label={label ?? t("name")}
          value={text}
          onChange={(event) => setText(event.target.value)}
          inputRef={input}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }}
          slotProps={{ htmlInput: { maxLength } }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button variant="contained" disableElevation disabled={!valid} onClick={save}>
          {saveLabel ?? t("save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
