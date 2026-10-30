import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useToast } from "../ToastProvider";

type Props = {
  /** The parameter's name, since "Choose PNG" alone doesn't say which of two it is for. */
  name: string;
  /** The name of the file chosen; `initial` while it is still the script's own default. */
  value: string;
  initial: string;
  /** The extension the script can read, with its dot. */
  accept: string;
  onFile: (fileName: string, bytes: Uint8Array) => void;
  onClear: () => void;
  disabled?: boolean;
};

/**
 * A file the script reads: an image for `surface()`, a shape for `import()`.
 *
 * Nothing goes anywhere. The bytes stay in the tab and are handed to the engine there, like the rest of what the
 * reader chooses.
 */
export default function FileField({ name, value, initial, accept, onFile, onClear, disabled }: Props) {
  const { t } = useTranslation("models");
  const showToast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const chosen = value !== initial;
  const type = accept.slice(1).toUpperCase();

  // A slow read only lands if nothing has happened since it began: no later choice, no change to the value (clearing
  // it, undo, Reset), and the field still here.
  const latest = useRef(0);
  useEffect(() => () => void (latest.current += 1), []);
  const valueNow = useRef(value);
  useEffect(() => {
    valueNow.current = value;
  }, [value]);

  const pick = async (file: File) => {
    // The picker's filter is only a suggestion, and the engine reads nothing else: said here rather than as a
    // warning about an unreadable file after a render.
    if (!file.name.toLowerCase().endsWith(accept)) {
      showToast({ message: t("customizer.form.fileWrongType", { type }), severity: "error" });
      return;
    }
    const request = ++latest.current;
    const valueThen = valueNow.current;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request === latest.current && valueThen === valueNow.current) onFile(file.name, bytes);
  };

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        startIcon={<UploadFileIcon fontSize="small" />}
        onClick={() => input.current?.click()}
        aria-label={`${name}: ${t("customizer.form.chooseFile", { type })}`}
        sx={{ flexShrink: 0 }}
      >
        {t("customizer.form.chooseFile", { type })}
      </Button>
      <Typography
        // Keyed so a newly chosen name fades in, which is what says the choice took.
        key={value}
        variant="caption"
        noWrap
        title={chosen ? value : undefined}
        sx={{
          flex: 1,
          minWidth: 0,
          color: chosen ? "text.primary" : "text.secondary",
          animation: "customizerFileIn 200ms ease-out",
          "@keyframes customizerFileIn": { from: { opacity: 0 }, to: { opacity: 1 } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {chosen ? value : t("customizer.form.fileStandIn")}
      </Typography>
      {chosen && (
        <Tooltip title={t("customizer.form.fileClear")}>
          <span>
            <IconButton
              size="small"
              disabled={disabled}
              onClick={onClear}
              aria-label={`${name}: ${t("customizer.form.fileClear")}`}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still says something changed.
          event.target.value = "";
          if (file) void pick(file);
        }}
      />
    </Stack>
  );
}
