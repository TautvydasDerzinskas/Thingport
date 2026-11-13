import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import { formatBytes, k } from "./parts";

export type SourceInput = {
  /** A database dump and the storage folder, or the old instance online. */
  way: "dump" | "online";
  mode: "upload" | "server";
  file: File | null;
  dumpPath: string;
  folder: string;
  address: string;
  token: string;
};

export const EMPTY_SOURCE: SourceInput = {
  way: "dump",
  mode: "upload",
  file: null,
  dumpPath: "",
  folder: "",
  address: "",
  token: "",
};

export const sourceReady = (input: SourceInput) =>
  input.way === "online"
    ? Boolean(input.address.trim() && input.token.trim())
    : Boolean(input.folder.trim()) && (input.mode === "upload" ? Boolean(input.file) : Boolean(input.dumpPath.trim()));

type Props = {
  input: SourceInput;
  onChange: (input: SourceInput) => void;
  /** The share uploaded so far, while it uploads. */
  uploading: number | null;
  disabled: boolean;
  /** Where on the server both must be. */
  root: string;
};

/** The old instance's database dump, uploaded or already on the server, and its storage folder. */
export default function SourceStep({ input, onChange, uploading, disabled, root }: Props) {
  const { t, i18n } = useTranslation("app");
  const picker = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const set = (patch: Partial<SourceInput>) => onChange({ ...input, ...patch });

  const pick = () => {
    if (!disabled) picker.current?.click();
  };

  if (input.way === "online") {
    return (
      <Stack spacing={2.5}>
        <WaySwitch input={input} onChange={onChange} disabled={disabled} />
        <TextField
          label={t(k("source.address"))}
          placeholder="http://192.168.1.20"
          value={input.address}
          onChange={(event) => set({ address: event.target.value })}
          disabled={disabled}
          fullWidth
          helperText={t(k("source.addressHelp"))}
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off", inputMode: "url" } }}
        />
        <TextField
          label={t(k("source.token"))}
          value={input.token}
          onChange={(event) => set({ token: event.target.value })}
          disabled={disabled}
          fullWidth
          type="password"
          autoComplete="off"
          helperText={`${t(k("source.tokenHelp"))} ${t(k("source.untouched"))}`}
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <WaySwitch input={input} onChange={onChange} disabled={disabled} />
      <Segmented
        label={t(k("source.where"))}
        value={input.mode}
        onChange={(mode) => set({ mode })}
        disabled={disabled}
        options={[
          { value: "upload", label: t(k("source.upload")) },
          { value: "server", label: t(k("source.onServer")) },
        ]}
      />
      {input.mode === "upload" ? (
        <>
          <ButtonBase
            onClick={pick}
            disabled={disabled}
            aria-label={input.file ? `${t(k("source.drop"))}: ${input.file.name}` : t(k("source.drop"))}
            onDragOver={(event) => {
              event.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped && !disabled) set({ file: dropped });
            }}
            sx={{
              display: "block",
              width: "100%",
              border: "1.5px dashed",
              borderColor: dragging ? "primary.main" : "divider",
              borderRadius: 2,
              px: 2,
              py: 3,
              textAlign: "center",
              bgcolor: (theme) => (dragging ? alpha(theme.palette.primary.main, 0.06) : "transparent"),
              transition: "border-color 150ms ease, background-color 150ms ease",
              "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
            }}
          >
            <UploadFileOutlinedIcon color={input.file ? "primary" : "action"} sx={{ fontSize: 32 }} aria-hidden />
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5 }}>
              {input.file ? input.file.name : t(k("source.drop"))}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p">
              {input.file ? formatBytes(input.file.size, i18n.language) : t(k("source.dropHelp"))}
            </Typography>
            {uploading !== null && (
              <Box sx={{ mt: 1.5, mx: "auto", maxWidth: 360 }}>
                <LinearProgress
                  variant="determinate"
                  value={uploading * 100}
                  aria-label={t(k("source.uploading"), { percent: Math.round(uploading * 100) })}
                />
                <Typography variant="caption" color="text.secondary">
                  {t(k("source.uploading"), { percent: Math.round(uploading * 100) })}
                </Typography>
              </Box>
            )}
          </ButtonBase>
          <input
            ref={picker}
            type="file"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) set({ file: chosen });
              event.target.value = "";
            }}
          />
        </>
      ) : (
        <TextField
          label={t(k("source.dumpPath"))}
          placeholder={`${root}/thingport.dump`}
          value={input.dumpPath}
          onChange={(event) => set({ dumpPath: event.target.value })}
          disabled={disabled}
          fullWidth
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
        />
      )}
      <TextField
        label={
          <>
            {t(k("source.folder"))}
            <HelpTip text={t(k("source.folderHelp"))} />
          </>
        }
        placeholder={`${root}/old-storage`}
        value={input.folder}
        onChange={(event) => set({ folder: event.target.value })}
        disabled={disabled}
        fullWidth
        slotProps={{
          htmlInput: { spellCheck: false, autoCapitalize: "off" },
          inputLabel: { sx: { pointerEvents: "auto" } },
        }}
        helperText={`${t(k("source.inside"), { root })} ${t(k("source.untouched"))}`}
      />
    </Stack>
  );
}

/** A dump and the storage folder, or the old instance online. */
function WaySwitch({
  input,
  onChange,
  disabled,
}: {
  input: SourceInput;
  onChange: (input: SourceInput) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("app");
  return (
    <Segmented
      fullWidth
      label={t(k("source.wayIn"))}
      value={input.way}
      onChange={(way) => onChange({ ...input, way })}
      disabled={disabled}
      options={[
        { value: "dump", label: t(k("source.dumpWay")) },
        { value: "online", label: t(k("source.onlineWay")) },
      ]}
    />
  );
}
