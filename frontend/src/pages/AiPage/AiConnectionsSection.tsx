import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { aiConnectionsApi, type AiConnection } from "../../api/aiConnections";
import { useConfirm } from "../../components/ConfirmProvider";
import SectionHeader from "../../components/SectionHeader";
import {
  AppGrid,
  AppTile,
  menuPosition,
  reopenContextMenuBelow,
  TileMenuHeader,
} from "../../components/Layout/ConfigurationDialog/AppTiles";
import AiConnectionDialog from "./AiConnectionDialog";
import { AiLogo, hostOf } from "./aiLogos";

type Props = {
  connections: AiConnection[] | null;
  /** Reloads the list after a change. */
  onChanged: () => void;
  onUnauthorized?: () => void;
};

// Long enough for the second click of a double-click to cancel the first one's "make default".
const DOUBLE_CLICK_MS = 250;

/** The instance's AIs as app icons: click one to make it the default, double-click to edit it. */
export default function AiConnectionsSection({ connections, onChanged, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AiConnection | "new" | null>(null);
  const [menu, setMenu] = useState<{ connection: AiConnection; top: number; left: number } | null>(null);
  const [notice, setNotice] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const clickTimer = useRef<number | undefined>(undefined);

  const fail = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else
      setNotice({
        severity: "error",
        text: err instanceof Error ? err.message : t("adminSettings.ai.connection.failed"),
      });
  };

  const makeDefault = async (connection: AiConnection) => {
    if (connection.is_default) return;
    setNotice(null);
    try {
      await aiConnectionsApi.makeDefault(connection.id);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  // A keyboard "click" (detail 0) is left to Enter, which edits; the menu offers "Make default".
  const onTileClick = (connection: AiConnection, event: React.MouseEvent<HTMLElement>) => {
    window.clearTimeout(clickTimer.current);
    if (event.detail !== 1) return;
    clickTimer.current = window.setTimeout(() => void makeDefault(connection), DOUBLE_CLICK_MS);
  };

  const edit = (connection: AiConnection) => {
    window.clearTimeout(clickTimer.current);
    setNotice(null);
    setEditing(connection);
  };

  const test = async (connection: AiConnection) => {
    setTesting(connection.id);
    setNotice(null);
    try {
      const result = await aiConnectionsApi.test({ id: connection.id });
      setNotice(
        result.ok
          ? {
              severity: "success",
              text: t("adminSettings.ai.connection.testSuccess", { model: result.model, latency: result.latency_ms }),
            }
          : { severity: "error", text: result.error || t("adminSettings.ai.connection.testFailed") },
      );
    } catch (err) {
      fail(err);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (connection: AiConnection) => {
    const ok = await confirm({
      title: t("adminSettings.ai.connection.deleteTitle", { model: connection.model }),
      message: connection.is_default
        ? t("adminSettings.ai.connection.deleteDefaultMessage")
        : t("adminSettings.ai.connection.deleteMessage"),
      confirmLabel: t("adminSettings.ai.connection.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await aiConnectionsApi.remove(connection.id);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  // The domain tells apart two AIs running the same model.
  const repeated = new Set(
    (connections ?? [])
      .map((connection) => connection.model)
      .filter((model, index, all) => all.indexOf(model) !== index),
  );
  const menuConnection = menu?.connection;

  return (
    <Stack spacing={3}>
      <SectionHeader
        title={t("adminSettings.ai.connection.heading")}
        subtitle={t("adminSettings.ai.connection.subtitle")}
      />
      {connections === null ? (
        <CircularProgress size={20} />
      ) : connections.length === 0 ? (
        <EmptyState onAdd={() => setEditing("new")} />
      ) : (
        <Box>
          <AppGrid>
            {connections.map((connection) => {
              const host = hostOf(connection.base_url);
              return (
                <AppTile
                  key={connection.id}
                  name={connection.model}
                  subtitle={repeated.has(connection.model) ? host : undefined}
                  logo={
                    testing === connection.id ? (
                      <CircularProgress size={22} />
                    ) : (
                      <AiLogo model={connection.model} baseUrl={connection.base_url} size={26} />
                    )
                  }
                  on
                  badge={connection.is_default ? true : undefined}
                  highlighted={menuConnection?.id === connection.id}
                  tooltip={
                    connection.is_default
                      ? t("adminSettings.ai.connection.defaultTooltip", { host })
                      : t("adminSettings.ai.connection.tileTooltip", { host })
                  }
                  ariaLabel={
                    connection.is_default
                      ? t("adminSettings.ai.connection.defaultAria", { model: connection.model, host })
                      : `${connection.model}, ${host}`
                  }
                  onClick={(event) => onTileClick(connection, event)}
                  onActivate={() => edit(connection)}
                  onContextMenu={(event) => setMenu({ connection, ...menuPosition(event) })}
                />
              );
            })}
            <AppTile
              name={t("adminSettings.ai.connection.add")}
              logo={<AddIcon sx={{ color: "#6b7280" }} />}
              on
              ariaLabel={t("adminSettings.ai.connection.add")}
              onClick={() => setEditing("new")}
              onActivate={() => setEditing("new")}
              onContextMenu={(event) => event.preventDefault()}
            />
          </AppGrid>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {t("adminSettings.ai.connection.gridHint")}
          </Typography>
        </Box>
      )}

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        onContextMenu={(event) => reopenContextMenuBelow(event, () => setMenu(null))}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {menuConnection && (
          <TileMenuHeader
            logo={<AiLogo model={menuConnection.model} baseUrl={menuConnection.base_url} size={20} />}
            name={menuConnection.model}
            status={
              menuConnection.is_default
                ? t("adminSettings.ai.connection.defaultStatus", { host: hostOf(menuConnection.base_url) })
                : hostOf(menuConnection.base_url)
            }
          />
        )}
        {menuConnection && [
          <MenuItem
            key="edit"
            onClick={() => {
              setMenu(null);
              edit(menuConnection);
            }}
          >
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.ai.connection.edit")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="default"
            disabled={menuConnection.is_default}
            onClick={() => {
              setMenu(null);
              void makeDefault(menuConnection);
            }}
          >
            <ListItemIcon>
              <StarOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.ai.connection.makeDefault")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="test"
            disabled={testing !== null}
            onClick={() => {
              setMenu(null);
              void test(menuConnection);
            }}
          >
            <ListItemIcon>
              <NetworkCheckIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("adminSettings.ai.connection.test")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="delete"
            onClick={() => {
              setMenu(null);
              void remove(menuConnection);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText sx={{ color: "error.main" }}>{t("adminSettings.ai.connection.delete")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {editing && (
        <AiConnectionDialog
          // Starts afresh for each AI.
          key={editing === "new" ? "new" : editing.id}
          connection={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Stack>
  );
}

/** A robot with an idea in a speech bubble: there's no AI yet, and adding one is the way in. */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation("app");
  return (
    <Stack direction="row" spacing={2.5} alignItems="center" sx={{ py: 2 }}>
      <Box
        sx={{
          flexShrink: 0,
          width: 72,
          height: 72,
          borderRadius: "18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#ffffff",
          boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
        }}
      >
        <SmartToyOutlinedIcon sx={{ fontSize: 44, color: "#6b7280" }} />
      </Box>
      <Box
        sx={{
          position: "relative",
          px: 2,
          py: 1.5,
          border: 1,
          borderColor: "divider",
          borderRadius: "14px",
          bgcolor: "background.paper",
          maxWidth: 420,
          // The tail, pointing back at the robot.
          "&::before, &::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            borderStyle: "solid",
          },
          "&::before": {
            left: -9,
            borderWidth: "8px 9px 8px 0",
            borderColor: (theme) => `transparent ${theme.palette.divider} transparent transparent`,
          },
          "&::after": {
            left: -7,
            borderWidth: "7px 8px 7px 0",
            borderColor: (theme) => `transparent ${theme.palette.background.paper} transparent transparent`,
          },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <LightbulbOutlinedIcon sx={{ color: "warning.main", mt: 0.25 }} fontSize="small" />
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {t("adminSettings.ai.connection.emptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("adminSettings.ai.connection.emptyBody")}
            </Typography>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAdd} sx={{ mt: 1.5 }}>
              {t("adminSettings.ai.connection.add")}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
}
