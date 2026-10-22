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
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { SLICER_OPTIONS } from "../../../constants/settingsOptions";
import { UnauthorizedError } from "../../../api/client";
import { settingsApi, type SlicerSettings } from "../../../api/settings";
import { setCachedSlicerSettings } from "../../../hooks/useSlicerPreference";
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

/** The slicers installed on this computer, as app icons: double-click one, or right-click it, to switch it on or
 *  off. A model's "Open in" menu offers the ones on; its button opens the last one used. */
export default function SlicerPanel({ onNavigate, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [value, setValue] = React.useState<SlicerSettings>({ slicer: null, slicers: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ id: string; top: number; left: number } | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getSlicer()
      .then((res) => {
        if (active) setValue(res);
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

  const toggle = async (id: string) => {
    if (loading) return;
    const previous = value;
    const slicers = previous.slicers.includes(id)
      ? previous.slicers.filter((other) => other !== id)
      : [...previous.slicers, id];
    // Shown straight away; put back if the save fails.
    setValue({ ...previous, slicers });
    setError(null);
    try {
      const res = await settingsApi.updateSlicer({ slicers });
      setValue(res);
      setCachedSlicerSettings(res);
    } catch (err) {
      setValue(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("profile.slicer.failed"));
    }
  };

  const isOn = (id: string) => value.slicers.includes(id);
  const statusOf = (id: string) => (isOn(id) ? t("slicer.active") : t("slicer.notActive"));
  const menuId = menu?.id;
  const bridged = value.slicers.filter(isBridgedSlicer).map(labelOf);

  return (
    <>
      <PanelHeader title={t("configuration.tabs.slicer")} subtitle={t("slicer.subtitle")} />
      <AppGrid>
        {SLICER_OPTIONS.map(({ id, label }) => (
          <AppTile
            key={id}
            name={label}
            subtitle={id === value.slicer && value.slicers.length > 1 ? t("slicer.lastUsed") : undefined}
            logo={<SlicerLogo id={id} size={26} />}
            on={isOn(id)}
            badge={isOn(id) ? true : undefined}
            highlighted={menuId === id}
            tooltip={loading ? undefined : `${label}: ${statusOf(id)}`}
            ariaLabel={`${label}: ${statusOf(id)}`}
            onContextMenu={(event) => setMenu({ id, ...menuPosition(event) })}
            onActivate={() => void toggle(id)}
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
            disabled={loading}
            onClick={() => {
              setMenu(null);
              void toggle(menuId);
            }}
          >
            <ListItemIcon>
              {isOn(menuId) ? (
                <RemoveCircleOutlineIcon fontSize="small" />
              ) : (
                <CheckCircleOutlineIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>{isOn(menuId) ? t("slicer.deactivate") : t("slicer.activate")}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {bridged.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          {t("profile.slicer.bridgeRequiredPrefix", { slicer: bridged.join(", ") })}{" "}
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
