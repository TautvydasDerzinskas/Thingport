import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import type { AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import { profileApi } from "../../api/profile";
import { copyText } from "../../utils/clipboard";
import { useToast } from "../ToastProvider";
import UsernameField, { usernameSavable, type UsernameState } from "./UsernameField";

type Props = {
  user: AuthUser;
  /** This instance's host: the part after the @. */
  host: string;
  onSaved: (user: AuthUser) => void;
  onUnauthorized?: () => void;
};

/** Your handle under your name, username@this-instance: copied with one click, changed in a small popover. */
export default function HandleChip({ user, host, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [value, setValue] = React.useState(user.username ?? "");
  const [state, setState] = React.useState<UsernameState>("unchanged");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handle = `${user.username ?? ""}@${host}`;
  const k = (name: string) => `author.username.${name}`;

  const open = (event: React.MouseEvent<HTMLElement>) => {
    setValue(user.username ?? "");
    setError(null);
    setAnchor(event.currentTarget);
  };

  const copy = async () => {
    try {
      await copyText(handle);
      showToast({ message: t(k("copied")) });
    } catch {
      showToast({ message: t(k("copyFailed")), severity: "error" });
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!usernameSavable(state) || saving) return;
    if (state === "unchanged") {
      setAnchor(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await profileApi.setUsername(value));
      showToast({ message: t(k("saved")) });
      setAnchor(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t(k("saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  if (!user.username) return null;
  return (
    <>
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.25,
          mt: 0.75,
          pl: 1.25,
          pr: 0.25,
          height: 32,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
          maxWidth: "100%",
        }}
      >
        <Box
          component="span"
          title={handle}
          sx={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            color: "text.primary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {handle}
        </Box>
        <Tooltip title={t(k("copy"))}>
          <IconButton size="small" onClick={() => void copy()} aria-label={t(k("copy"))}>
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t(k("change"))}>
          <IconButton
            size="small"
            onClick={open}
            aria-label={t(k("change"))}
            aria-expanded={anchor !== null}
            aria-haspopup="dialog"
          >
            <EditOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => !saving && setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: { p: 2, width: 380, maxWidth: "calc(100vw - 32px)" },
            role: "dialog",
            "aria-label": t(k("change")),
          },
          // The popover opens to change it: straight into the field, once it's there (it focuses its own paper first).
          transition: { onEntered: () => inputRef.current?.focus() },
        }}
      >
        <Stack component="form" spacing={1.5} onSubmit={(event) => void save(event)}>
          <UsernameField
            inputRef={inputRef}
            value={value}
            onChange={setValue}
            current={user.username}
            host={host}
            onState={setState}
            disabled={saving}
            onUnauthorized={onUnauthorized}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => setAnchor(null)} disabled={saving}>
              {t("common:cancel")}
            </Button>
            <Button type="submit" variant="contained" disabled={saving || !usernameSavable(state)}>
              {t("common:save")}
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}
