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
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CableIcon from "@mui/icons-material/Cable";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { slicerProfile } from "../../../adapter/slicers/index.generated";
import { SLICER_OPTIONS } from "../../../constants/settingsOptions";
import { UnauthorizedError } from "../../../api/client";
import { settingsApi, type SlicerSettings } from "../../../api/settings";
import { setCachedSlicerSettings } from "../../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../../hooks/useUserPrinters";
import { isBridgeable, isBridgedSlicer } from "../../../utils/slicerLaunch";
import HelpTip from "../../HelpTip";
import NestedMenuItem from "../../NestedMenuItem";
import PrinterIcon from "../../printers/PrinterIcon";
import { AppGrid, AppTile, menuPosition, reopenContextMenuBelow, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";
import { SlicerLogo } from "./slicerLogos";

const labelOf = (id: string) => SLICER_OPTIONS.find((option) => option.id === id)?.label ?? id;

type Props = {
  /** Called on following the bridge link, which leaves for another page. */
  onNavigate: () => void;
  /** Switches the dialog to its Printers section, for a slicer's printer when there's none to pick. */
  onOpenPrinters?: () => void;
  onUnauthorized?: () => void;
};

const NONE: SlicerSettings = { slicer: null, slicers: [], bridged: [], unadapted: [], printers: {} };

/** The slicers installed on this computer, as app icons: double-click one, or right-click it, to switch it on or
 *  off. A model's "Open in" menu offers the ones on; its button opens the last one used. A slicer with a protocol of
 *  its own can be sent through Thingport Bridge from its right-click menu; those that go through it wear its cable.
 *  The menu also switches the slicer's adapted copies off or on, and picks the printer they're made for. */
export default function SlicerPanel({ onNavigate, onOpenPrinters, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const { printers } = useUserPrinters(onUnauthorized);
  const [value, setValue] = React.useState<SlicerSettings>(NONE);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ id: string; top: number; left: number } | null>(null);

  // Saves go one at a time, so their answers arrive in order. The panel keeps showing its own toggles until the last
  // save is back, then the server's answer to it, which also puts back any that failed.
  const saves = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const saved = React.useRef<SlicerSettings>(NONE);

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

  const toggleAdapted = (id: string) => {
    if (loading) return;
    const off = value.unadapted.includes(id);
    save(
      (shown) => ({ ...shown, unadapted: off ? without(shown.unadapted, id) : [...shown.unadapted, id] }),
      off ? { adapt: id } : { unadapt: id },
    );
  };

  const setPrinter = (id: string, printer: string | null) => {
    if (loading) return;
    save(
      (shown) => {
        const next = { ...shown.printers };
        if (printer) next[id] = printer;
        else delete next[id];
        return { ...shown, printers: next };
      },
      { printer: { slicer: id, printer } },
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
        {menuId && slicerProfile(menuId) && <Divider />}
        {menuId && slicerProfile(menuId) && (
          // Stays open, so the switch is seen to move.
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={!value.unadapted.includes(menuId)}
            disabled={loading}
            onClick={() => toggleAdapted(menuId)}
          >
            <ListItemIcon>
              <LightbulbOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t("slicer.openAdapted")}
              <Box component="span" onClick={(event) => event.stopPropagation()}>
                <HelpTip text={t("slicer.openAdaptedHelp", { slicer: labelOf(menuId) })} />
              </Box>
            </ListItemText>
            <Switch
              size="small"
              edge="end"
              checked={!value.unadapted.includes(menuId)}
              disableRipple
              tabIndex={-1}
              inputProps={{ readOnly: true, tabIndex: -1, "aria-hidden": true }}
              sx={{ ml: 1.5 }}
            />
          </MenuItem>
        )}
        {menuId && slicerProfile(menuId)?.targetsPrinter && (
          <NestedMenuItem
            icon={<PrinterIcon fontSize="small" />}
            label={t("slicer.printer")}
            detail={
              printers.find((p) => p.printer.id === value.printers[menuId])?.printer.model ?? t("slicer.askPrinter")
            }
            disabled={loading || value.unadapted.includes(menuId)}
          >
            {(close) => [
              ...printers.map((p) => {
                const chosen = value.printers[menuId] === p.printer.id;
                const known = Boolean(p.presets[menuId]);
                return (
                  <MenuItem
                    key={p.printer.id}
                    role="menuitemradio"
                    aria-checked={chosen}
                    disabled={!known}
                    onClick={() => {
                      close();
                      setPrinter(menuId, p.printer.id);
                    }}
                  >
                    <ListItemIcon>{chosen && <CheckIcon fontSize="small" />}</ListItemIcon>
                    <ListItemText
                      primary={`${p.brandName} ${p.printer.model}`}
                      secondary={known ? undefined : t("printers.menu.notIn", { slicer: labelOf(menuId) })}
                    />
                  </MenuItem>
                );
              }),
              printers.length > 0 && <Divider key="divider" />,
              <MenuItem
                key="ask"
                role="menuitemradio"
                aria-checked={!value.printers[menuId]}
                onClick={() => {
                  close();
                  setPrinter(menuId, null);
                }}
              >
                <ListItemIcon>{!value.printers[menuId] && <CheckIcon fontSize="small" />}</ListItemIcon>
                <ListItemText>{t("slicer.askPrinter")}</ListItemText>
              </MenuItem>,
              onOpenPrinters && (
                <MenuItem
                  key="add"
                  onClick={() => {
                    close();
                    setMenu(null);
                    onOpenPrinters();
                  }}
                >
                  <ListItemIcon>
                    <AddCircleOutlineIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t("slicer.addPrinters")}</ListItemText>
                </MenuItem>
              ),
            ]}
          </NestedMenuItem>
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
