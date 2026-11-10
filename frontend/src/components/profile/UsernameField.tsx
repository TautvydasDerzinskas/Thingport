import React from "react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { UnauthorizedError } from "../../api/client";
import { profileApi } from "../../api/profile";

// The backend's rule (services/usernames.ts), checked here too so a typo shows at once.
const PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,28}[a-z0-9])?$/;
const CHECK_DELAY_MS = 350;

export type UsernameState = "unchanged" | "checking" | "free" | "taken" | "invalid";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Their username now: typing it back is no change. */
  current: string | null;
  /** This instance's host, shown after the @. */
  host: string | null;
  onState?: (state: UsernameState) => void;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
  onUnauthorized?: () => void;
};

/** A username, as username@this-instance, checked as it's typed: whether it can be one, and whether it's free. */
export default function UsernameField({
  value,
  onChange,
  current,
  host,
  onState,
  autoFocus,
  inputRef,
  disabled,
  onUnauthorized,
}: Props) {
  const { t } = useTranslation("models");
  const [state, setState] = React.useState<UsernameState>("unchanged");
  const k = (name: string) => `author.username.${name}`;

  React.useEffect(() => {
    let cancelled = false;
    const next: UsernameState = value === current ? "unchanged" : PATTERN.test(value) ? "checking" : "invalid";
    setState(next);
    if (next !== "checking") return;
    const timer = window.setTimeout(() => {
      profileApi.usernameAvailable(value).then(
        (result) => {
          if (!cancelled) setState(result.available ? "free" : result.reason === "invalid" ? "invalid" : "taken");
        },
        (err) => {
          if (cancelled) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          // Unknown: let the save say, rather than block it.
          setState("free");
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, current, onUnauthorized]);

  React.useEffect(() => {
    onState?.(state);
  }, [state, onState]);

  const helper =
    state === "invalid"
      ? t(k("invalid"))
      : state === "taken"
        ? t(k("taken"))
        : state === "free"
          ? t(k("free"))
          : t(k("help"));

  return (
    <TextField
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      inputRef={inputRef}
      fullWidth
      label={t(k("label"))}
      value={value}
      onChange={(event) => onChange(event.target.value.trim().replace(/^@/, "").toLowerCase())}
      disabled={disabled}
      error={state === "invalid" || state === "taken"}
      helperText={helper}
      FormHelperTextProps={{ sx: state === "free" ? { color: "success.main" } : undefined }}
      inputProps={{ spellCheck: false, autoCapitalize: "off", autoComplete: "off", maxLength: 30 }}
      InputProps={{
        startAdornment: <InputAdornment position="start">@</InputAdornment>,
        endAdornment: (
          <InputAdornment position="end" sx={{ gap: 1 }}>
            {state === "checking" && <CircularProgress size={14} aria-label={t(k("checking"))} />}
            {host && (
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
                @{host}
              </span>
            )}
          </InputAdornment>
        ),
      }}
    />
  );
}

/** Whether a username in this state can be saved: unchanged counts, as it needs no saving. */
export function usernameSavable(state: UsernameState): boolean {
  return state === "unchanged" || state === "free";
}
