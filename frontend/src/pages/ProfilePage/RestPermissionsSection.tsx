import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { authApi, type ApiTokenInfo, type RestScopeInfo } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import HelpTip from "../../components/HelpTip";
import { PanelHeader, SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import PermissionRow from "../../components/PermissionRow";
import { useToast } from "../../components/ToastProvider";

type Props = {
  info: ApiTokenInfo;
  onChange: (info: ApiTokenInfo) => void;
  onUnauthorized?: () => void;
};

const MEDIA = new Set(["images", "files"]);
const OTHER = "other";

/** Token permissions' REST panel: what other apps using the token may read under /api. Each choice saves
 *  on its own, as in the MCP panel; a refused save puts it back. */
export default function RestPermissionsSection({ info, onChange, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);
  // Ahead of the server while a save is in flight; back in step with it once the save answers.
  const [selected, setSelected] = React.useState<string[]>(info.rest_scopes);
  React.useEffect(() => setSelected(info.rest_scopes), [info.rest_scopes]);
  const enabled = new Set(selected);

  // A scope added on the server before its translation falls back to the server's English text.
  const label = (scope: RestScopeInfo, part: "title" | "description") => {
    const key = `profile.apiToken.rest.scopes.${scope.id}.${part}`;
    return i18n.exists(key, { ns: "app" }) ? t(key) : scope[part];
  };

  const toggle = async (id: string, on: boolean) => {
    const next = info.available_rest_scopes
      .map((scope) => scope.id)
      .filter((other) => (other === id ? on : enabled.has(other)));
    setSelected(next);
    setSaving(true);
    try {
      onChange(await authApi.setApiTokenRestScopes(next));
    } catch (err) {
      setSelected(info.rest_scopes);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: t("profile.apiToken.rest.failed"), severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const scopes = info.available_rest_scopes;
  const groups = [
    { key: "library", scopes: scopes.filter((scope) => !MEDIA.has(scope.id) && scope.id !== OTHER) },
    { key: "media", scopes: scopes.filter((scope) => MEDIA.has(scope.id)) },
    { key: "other", scopes: scopes.filter((scope) => scope.id === OTHER) },
  ].filter((group) => group.scopes.length);

  return (
    <>
      <PanelHeader
        title={t("profile.apiToken.rest.heading")}
        subtitle={t("profile.apiToken.rest.subtitle")}
        action={<HelpTip text={t("profile.apiToken.rest.description")} />}
      />
      <Stack spacing={2.5}>
        {groups.map((group) => (
          <Box key={group.key}>
            <SectionLabel>{t(`profile.apiToken.rest.groups.${group.key}`)}</SectionLabel>
            {group.scopes.map((scope) => (
              <PermissionRow
                key={scope.id}
                name={scope.id}
                title={label(scope, "title")}
                description={label(scope, "description")}
                allowed={enabled.has(scope.id)}
                disabled={saving}
                onChange={(on) => void toggle(scope.id, on)}
              />
            ))}
          </Box>
        ))}
      </Stack>
    </>
  );
}
