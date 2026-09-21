import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import { setCachedAuthorPreviewEnabled } from "../../hooks/useAuthorPreviewEnabled";

type Props = {
  onUnauthorized?: () => void;
};

/** Profile switch for the author preview card shown on hovering an author link (see
 *  components/AuthorHoverCard.tsx). Stored server-side so it follows the account. */
export default function AuthorPreviewSetting({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app"]);
  const [enabled, setEnabled] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi.getAuthorPreview()
      .then(res => { if (active) setEnabled(res.enabled); })
      .catch(err => {
        if (active && err instanceof UnauthorizedError) onUnauthorized?.();
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onUnauthorized]);

  const handleChange = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setStatus(null);
    try {
      const res = await settingsApi.updateAuthorPreview(next);
      setEnabled(res.enabled);
      setCachedAuthorPreviewEnabled(res.enabled);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setEnabled(previous);
      setStatus(err instanceof Error ? err.message : t("profile.authorPreview.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}>
        {t("profile.authorPreview.heading")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("profile.authorPreview.description")}
      </Typography>
      <Paper
        variant="outlined"
        sx={{ p: 2.5, borderColor: (muiTheme) => (muiTheme.palette.mode === "dark" ? "transparent" : "divider") }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                disabled={loading || saving}
                onChange={e => void handleChange(e.target.checked)}
              />
            }
            label={t("profile.authorPreview.label")}
          />
          {saving && <CircularProgress size={16} />}
        </Stack>
        {status && <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>{status}</Typography>}
      </Paper>
    </Box>
  );
}
