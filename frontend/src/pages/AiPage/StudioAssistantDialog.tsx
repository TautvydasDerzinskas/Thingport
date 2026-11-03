import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import type { AiConnection } from "../../api/aiConnections";
import { settingsApi, type StudioAssistantSettings } from "../../api/settings";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { AiLogo, hostOf } from "./aiLogos";

type Props = {
  settings: StudioAssistantSettings;
  connections: AiConnection[];
  onClose: () => void;
  onSaved: (settings: StudioAssistantSettings) => void;
  onUnauthorized?: () => void;
};

/** Whether an AI runs on this network: localhost, a private address or a bare or local name, as a model on someone's own
 *  hardware does. Such a one is likely small, so it starts on the compact tool set. */
function onLocalNetwork(baseUrl: string): boolean {
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    !host.includes(".") ||
    /\.(local|lan|home|internal)$/.test(host) ||
    /^(127|10)\./.test(host) ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** Which AIs people may pick in Studio's prompt, which is picked first, and which get the compact tool set. Turning it
 *  on and off is the tile's switch. */
export default function StudioAssistantDialog({ settings, connections, onClose, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const labelId = useId();
  // Only AIs that still exist: one deleted meanwhile has already been taken off the list on the server.
  const [offered, setOffered] = useState<string[]>(() =>
    settings.ai_connection_ids.filter((id) => connections.some((connection) => connection.id === id)),
  );
  const [chosenDefault, setChosenDefault] = useState<string | null>(settings.default_ai_connection_id);
  const [compact, setCompact] = useState<string[]>(settings.compact_ai_connection_ids);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The default is always one on offer, the first when the one picked is taken off, as the server keeps it.
  const defaultId = chosenDefault && offered.includes(chosenDefault) ? chosenDefault : (offered[0] ?? null);

  const toggle = (connection: AiConnection, on: boolean) => {
    setOffered((current) => (on ? [...current, connection.id] : current.filter((other) => other !== connection.id)));
    // Offered anew, a model on this network starts compact; Claude finds its tools by search instead.
    if (on && connection.kind === "openai" && onLocalNetwork(connection.base_url))
      setCompact((current) => (current.includes(connection.id) ? current : [...current, connection.id]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await settingsApi.updateStudioAssistant({
          ai_connection_ids: offered,
          default_ai_connection_id: defaultId,
          compact_ai_connection_ids: compact.filter((id) => offered.includes(id)),
        }),
      );
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("adminSettings.studioAssistant.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("adminSettings.aiFeatures.studio")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {!connections.length && <Alert severity="warning">{t("adminSettings.aiCategorization.noAi")}</Alert>}
          {connections.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {t("adminSettings.studioAssistant.offered")}
                <HelpTip text={t("adminSettings.studioAssistant.offeredHelp")} />
              </Typography>
              <Stack sx={{ mt: 0.5 }}>
                {connections.map((connection) => (
                  <Stack key={connection.id} direction="row" alignItems="center" spacing={1.25} sx={{ py: 0.5 }}>
                    <AiLogo model={connection.model} baseUrl={connection.base_url} size={20} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {connection.model}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {hostOf(connection.base_url)}
                      </Typography>
                    </Box>
                    {connection.kind === "openai" && offered.includes(connection.id) && (
                      <Segmented
                        label={t("adminSettings.studioAssistant.toolsAria", { model: connection.model })}
                        value={compact.includes(connection.id) ? "compact" : "all"}
                        options={[
                          { value: "all", label: t("adminSettings.studioAssistant.toolsAll") },
                          { value: "compact", label: t("adminSettings.studioAssistant.toolsCompact") },
                        ]}
                        onChange={(value) =>
                          setCompact((current) =>
                            value === "compact"
                              ? [...current.filter((id) => id !== connection.id), connection.id]
                              : current.filter((id) => id !== connection.id),
                          )
                        }
                        disabled={saving}
                      />
                    )}
                    <Switch
                      checked={offered.includes(connection.id)}
                      onChange={(event) => toggle(connection, event.target.checked)}
                      disabled={saving}
                      slotProps={{
                        input: {
                          "aria-label": t("adminSettings.studioAssistant.offerAria", { model: connection.model }),
                        },
                      }}
                    />
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          <FormControl fullWidth disabled={saving || !offered.length}>
            <InputLabel id={labelId}>{t("adminSettings.studioAssistant.default")}</InputLabel>
            <Select
              labelId={labelId}
              label={t("adminSettings.studioAssistant.default")}
              value={defaultId ?? ""}
              onChange={(event) => setChosenDefault(event.target.value || null)}
            >
              {connections
                .filter((connection) => offered.includes(connection.id))
                .map((connection) => (
                  <MenuItem key={connection.id} value={connection.id}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <AiLogo model={connection.model} baseUrl={connection.base_url} size={18} />
                      <span>{`${connection.model} · ${hostOf(connection.base_url)}`}</span>
                    </Stack>
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          {connections.length > 0 && !offered.length && (
            <Typography variant="caption" color="text.secondary">
              {t("adminSettings.studioAssistant.noneOffered")}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t("adminSettings.studioAssistant.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
