import React from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import CableIcon from "@mui/icons-material/Cable";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { SLICER_OPTIONS } from "../../../constants/settingsOptions";
import { UnauthorizedError } from "../../../api/client";
import { settingsApi, type SlicerSettings } from "../../../api/settings";
import { setCachedSlicerSettings } from "../../../hooks/useSlicerPreference";
import { isBridgeable, isBridgedSlicer } from "../../../utils/slicerLaunch";
import HelpTip from "../../HelpTip";
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
 *  off. A model's "Open in" menu offers the ones on; its button opens the last one used. A slicer with a protocol of
 *  its own can be sent through Thingport Bridge from its right-click menu; those that go through it wear its cable. */
export default function SlicerPanel({ onNavigate, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [value, setValue] = React.useState<SlicerSettings>({ slicer: null, slicers: [], bridged: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ id: string; top: number; left: number } | null>(null);

  // Saves go one at a time, so their answers arrive in order. The panel keeps showing its own toggles until the last
  // save is back, then the server's answer to it, which also puts back any that failed.
  const saves = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const saved = React.useRef<SlicerSettings>({ slicer: null, slicers: [], bridged: [] });

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getSlicer()
      .then((res) => {
        if (!active) return;
        saved.current = res;
        setValue(res);
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

  // Shown at once; `patch` names just the one slicer, so a change made on another device in the meantime stays.
  const save = (
    show: (shown: SlicerSettings) => SlicerSettings,
    patch: Parameters<typeof settingsApi.updateSlicer>[0],
  ) => {
    setValue(show);
    setError(null);
    pendingSaves.current += 1;
    saves.current = saves.current.then(async () => {
      try {
        const res = await settingsApi.updateSlicer(patch);
        saved.current = res;
        setCachedSlicerSettings(res);
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(err instanceof Error ? err.message : t("profile.slicer.failed"));
      } finally {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) setValue(saved.current);
      }
    });
  };

  const without = (list: string[], id: string) => list.filter((other) => other !== id);

  const toggle = (id: string) => {
    if (loading) return;
    const on = value.slicers.includes(id);
    save(
      (shown) => ({ ...shown, slicers: on ? without(shown.slicers, id) : [...shown.slicers, id] }),
      on ? { disable: id } : { enable: id },
    );
  };

  const toggleBridge = (id: string) => {
    if (loading) return;
    const through = value.bridged.includes(id);
    save(
      (shown) => ({ ...shown, bridged: through ? without(shown.bridged, id) : [...shown.bridged, id] }),
      through ? { unbridge: id } : { bridge: id },
    );
  };

  const isOn = (id: string) => value.slicers.includes(id);
  const viaBridge = (id: string) => isBridgedSlicer(id, value.bridged);
  const statusOf = (id: string) => {
    const status = isOn(id) ? t("slicer.active") : t("slicer.notActive");
    return viaBridge(id) ? `${status} · ${t("slicer.throughBridge")}` : status;
  };
  const menuId = menu?.id;
  const needBridge = value.slicers.filter(viaBridge).map(labelOf);

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
            cornerIcon={isOn(id) && viaBridge(id) ? <CableIcon /> : undefined}
            highlighted={menuId === id}
            tooltip={loading ? undefined : `${label}: ${statusOf(id)}`}
            ariaLabel={`${label}: ${statusOf(id)}`}
            onContextMenu={(event) => setMenu({ id, ...menuPosition(event) })}
            onActivate={() => toggle(id)}
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
              toggle(menuId);
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
        {menuId && isBridgeable(menuId) && <Divider />}
        {menuId && isBridgeable(menuId) && (
          // Stays open, so the switch is seen to move.
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={value.bridged.includes(menuId)}
            disabled={loading}
            onClick={() => toggleBridge(menuId)}
          >
            <ListItemIcon>
              <CableIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t("slicer.throughBridge")}
              {/* Reading it doesn't flip the switch. */}
              <Box component="span" onClick={(event) => event.stopPropagation()}>
                <HelpTip text={t("slicer.throughBridgeHelp", { slicer: labelOf(menuId) })} />
              </Box>
            </ListItemText>
            <Switch
              size="small"
              edge="end"
              checked={value.bridged.includes(menuId)}
              disableRipple
              tabIndex={-1}
              inputProps={{ readOnly: true, tabIndex: -1, "aria-hidden": true }}
              sx={{ ml: 1.5 }}
            />
          </MenuItem>
        )}
      </Menu>

      {needBridge.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          {t("profile.slicer.bridgeRequiredPrefix", { slicer: needBridge.join(", ") })}{" "}
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
