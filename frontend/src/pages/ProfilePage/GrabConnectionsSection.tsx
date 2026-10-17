import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { grabApi, type GrabConnection } from "../../api/grab";
import { useConfirm } from "../../components/ConfirmProvider";
import { relativeTime } from "../../utils/relativeTime";

/** Browsers whose Thingport Grab was connected by approval; nothing at all for someone who has none. */
export default function GrabConnectionsSection({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { t, i18n } = useTranslation("app");
  const confirm = useConfirm();
  const [connections, setConnections] = React.useState<GrabConnection[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    },
    [onUnauthorized],
  );
  const load = React.useCallback(() => {
    grabApi.list().then(setConnections, fail);
  }, [fail]);
  React.useEffect(load, [load]);

  if (connections.length === 0) return null;

  const remove = async (connection: GrabConnection) => {
    const ok = await confirm({
      title: t("grab.profile.removeTitle", { name: connection.name }),
      message: t("grab.profile.removeMessage", { name: connection.name }),
      confirmLabel: t("grab.profile.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await grabApi.remove(connection.id);
      load();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Stack spacing={1.5}>
      {connections.map((connection) => (
        <Stack key={connection.id} direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body1">{t("grab.profile.heading", { name: connection.name })}</Typography>
            <Typography variant="caption" color="text.secondary">
              {connection.last_used_at
                ? t("grab.profile.lastUsed", { when: relativeTime(connection.last_used_at, i18n.language) })
                : t("grab.profile.connectedWhen", { when: relativeTime(connection.connected_at, i18n.language) })}
            </Typography>
          </Box>
          <Button variant="text" color="error" onClick={() => void remove(connection)} sx={{ flexShrink: 0 }}>
            {t("grab.profile.remove")}
          </Button>
        </Stack>
      ))}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
