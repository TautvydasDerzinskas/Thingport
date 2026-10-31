import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import { UnauthorizedError } from "../api/client";
import { collectionsApi, type Collection } from "../api/collections";

type Props = {
  onCreated: (collection: Collection) => void;
  disabled?: boolean;
  /** Takes the cursor once usable: with no collections yet, there's nothing else to do in the dialog. */
  focused?: boolean;
  /** For a dialog that saves the new collection along with its other changes, and so has to wait for it. */
  onCreatingChange?: (creating: boolean) => void;
  onUnauthorized?: () => void;
  sx?: SxProps<Theme>;
};

/** Names a new collection and makes it on the spot, for any dialog that picks from the user's collections. */
export default function NewCollectionField({
  onCreated,
  disabled,
  focused,
  onCreatingChange,
  onUnauthorized,
  sx,
}: Props) {
  const { t } = useTranslation("models");
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focused && !disabled) inputRef.current?.focus();
  }, [focused, disabled]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    onCreatingChange?.(true);
    setError(null);
    try {
      onCreated(await collectionsApi.create({ name: trimmed }));
      setName("");
    } catch (err) {
      if (err instanceof UnauthorizedError && onUnauthorized) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : t("collections.form.saveFailed"));
    } finally {
      setCreating(false);
      onCreatingChange?.(false);
    }
  };

  return (
    <TextField
      size="small"
      fullWidth
      disabled={disabled}
      inputRef={inputRef}
      placeholder={t("collections.newCollection")}
      value={name}
      error={Boolean(error)}
      helperText={error}
      onChange={(event) => {
        setName(event.target.value);
        setError(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void create();
        }
      }}
      slotProps={{
        htmlInput: { maxLength: 200, "aria-label": t("collections.newCollection") },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={t("collections.form.create")}>
                <span>
                  <IconButton
                    size="small"
                    edge="end"
                    aria-label={t("collections.form.create")}
                    disabled={disabled || creating || !name.trim()}
                    onClick={() => void create()}
                  >
                    {creating ? <CircularProgress size={18} /> : <AddIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
      sx={sx}
    />
  );
}
