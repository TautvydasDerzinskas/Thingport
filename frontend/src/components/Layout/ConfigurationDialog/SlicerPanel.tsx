import React from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { SLICER_OPTIONS } from "../../../constants/settingsOptions";
import { UnauthorizedError } from "../../../api/client";
import { settingsApi } from "../../../api/settings";
import { setCachedSlicerPreference } from "../../../hooks/useSlicerPreference";
import { isBridgedSlicer } from "../../../utils/slicerLaunch";
import { AppGrid, AppTile, menuPosition, reopenContextMenuBelow, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";
import { SlicerLogo } from "./slicerLogos";

const labelOf = (id: string) => SLICER_OPTIONS.find((option) => option.id === id)?.label ?? id;

type Props = {
  /** Called on following the bridge link, which leaves for another page. */
  onNavigate: () => void;
  onUnauthorized?: () => void;
};

/** The slicer models open in, as app icons: right-click one and Activate it, or double-click it. */
export default function SlicerPanel({ onNavigate, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [value, setValue] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ id: string; top: number; left: number } | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getSlicer()
      .then((res) => {
        if (active) setValue(res.slicer ?? null);
      })
      .catch((err) => {
        if (active && err instanceof UnauthorizedError) onUnauthorized?.();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const activate = async (next: string) => {
    if (loading || next === value) return;
    const previous = value;
    // Shown straight away; put back if the save fails.
    setValue(next);
    setError(null);
    try {
      const res = await settingsApi.updateSlicer(next);
      setValue(res.slicer ?? null);
      setCachedSlicerPreference(res.slicer ?? null);
    } catch (err) {
      setValue(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("profile.slicer.failed"));
    }
  };

  const statusOf = (id: string) => (id === value ? t("slicer.active") : t("slicer.notActive"));
  const menuId = menu?.id;

  return (
    <>
      <PanelHeader title={t("configuration.tabs.slicer")} subtitle={t("slicer.subtitle")} />
      <AppGrid>
        {SLICER_OPTIONS.map(({ id, label }) => (
          <AppTile
            key={id}
            name={label}
            logo={<SlicerLogo id={id} size={26} />}
            on={id === value}
            badge={id === value ? true : undefined}
            highlighted={menuId === id}
            tooltip={loading ? undefined : `${label}: ${statusOf(id)}`}
            ariaLabel={`${label}: ${statusOf(id)}`}
            onContextMenu={(event) => setMenu({ id, ...menuPosition(event) })}
            onActivate={() => void activate(id)}
          />
        ))}
      </AppGrid>

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        onContextMenu={(event) => reopenContextMenuBelow(event, () => setMenu(null))}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {menuId && (
          <TileMenuHeader
            logo={<SlicerLogo id={menuId} size={20} />}
            name={labelOf(menuId)}
            status={statusOf(menuId)}
          />
        )}
        {menuId && (
          <MenuItem
            disabled={menuId === value || loading}
            onClick={() => {
              setMenu(null);
              void activate(menuId);
            }}
          >
            <ListItemIcon>
              <CheckCircleOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("slicer.activate")}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {value && isBridgedSlicer(value) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          {t("profile.slicer.bridgeRequiredPrefix", { slicer: labelOf(value) })}{" "}
          <Link component={RouterLink} to="/downloads" onClick={onNavigate}>
            {t("profile.slicer.bridgeRequiredLink")}
          </Link>
        </Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </>
  );
}
