import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { authApi, type ApiTokenInfo, type McpToolInfo } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import { PanelHeader, SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import PermissionRow from "../../components/PermissionRow";
import { useToast } from "../../components/ToastProvider";

type Props = {
  info: ApiTokenInfo;
  onChange: (info: ApiTokenInfo) => void;
  onUnauthorized?: () => void;
};

/** Token permissions' MCP panel: which tools the token may call at /api/mcp. Each choice saves on its own, so there's no
 *  unsaved state to lose; a refused save puts it back. */
export default function McpPermissionsSection({ info, onChange, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const toast = useToast();
  const [saving, setSaving] = React.useState<string | null>(null);
  // Ahead of the server while a save is in flight; back in step with it once the save answers.
  const [selected, setSelected] = React.useState<string[]>(info.mcp_tools);
  React.useEffect(() => setSelected(info.mcp_tools), [info.mcp_tools]);
  const enabled = new Set(selected);

  // A tool added on the server before its translation falls back to the server's English text.
  const label = (tool: McpToolInfo, part: "title" | "description") => {
    const key = `profile.apiToken.mcp.tools.${tool.name}.${part}`;
    return i18n.exists(key, { ns: "app" }) ? t(key) : tool[part];
  };

  const toggle = async (tool: McpToolInfo, on: boolean) => {
    const name = tool.name;
    // Reading needs no second thought; letting an assistant change the library does.
    if (on && !tool.read_only) {
      const ok = await confirm({
        title: t("profile.apiToken.mcp.writeConfirmTitle", { tool: label(tool, "title") }),
        message: t("profile.apiToken.mcp.writeConfirmMessage"),
        confirmLabel: t("profile.apiToken.mcp.writeConfirm"),
      });
      if (!ok) return;
    }
    // Only the offered tools: the server keeps the ticks of any an admin has hidden.
    const next = info.available_mcp_tools
      .map((available) => available.name)
      .filter((other) => (other === name ? on : enabled.has(other)));
    setSelected(next);
    setSaving(name);
    try {
      onChange(await authApi.setApiTokenMcpTools(next));
    } catch (err) {
      setSelected(info.mcp_tools);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("profile.apiToken.mcp.failed"), severity: "error" });
    } finally {
      setSaving(null);
    }
  };

  const groups = [
    { key: "reads", tools: info.available_mcp_tools.filter((tool) => tool.read_only) },
    { key: "writes", tools: info.available_mcp_tools.filter((tool) => !tool.read_only) },
  ].filter((group) => group.tools.length);

  return (
    <>
      <PanelHeader
        title={t("profile.apiToken.mcp.heading")}
        subtitle={t("profile.apiToken.mcp.subtitle")}
        action={<HelpTip text={t("profile.apiToken.mcp.description")} />}
      />
      {info.mcp_access === "off" ? (
        <Typography variant="body2" color="text.secondary">
          {t("profile.apiToken.mcp.adminOff")}
        </Typography>
      ) : (
        <Stack spacing={2.5}>
          {groups.map((group) => (
            <Box key={group.key}>
              <SectionLabel>
                {group.key === "reads" ? t("profile.apiToken.mcp.reads") : t("profile.apiToken.mcp.writes")}
              </SectionLabel>
              {group.tools.map((tool) => (
                <PermissionRow
                  key={tool.name}
                  name={tool.name}
                  title={label(tool, "title")}
                  description={label(tool, "description")}
                  allowed={enabled.has(tool.name)}
                  disabled={saving !== null}
                  onChange={(on) => void toggle(tool, on)}
                />
              ))}
            </Box>
          ))}
          {info.mcp_access === "read" && (
            <Typography variant="caption" color="text.secondary">
              {t("profile.apiToken.mcp.adminReadOnly")}
            </Typography>
          )}
        </Stack>
      )}
    </>
  );
}
