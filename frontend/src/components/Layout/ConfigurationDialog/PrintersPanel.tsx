import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import { slicerProfile } from "../../../adapter/slicers/index.generated";
import { UnauthorizedError } from "../../../api/client";
import { BambuSignInError, printersApi, type PrinterSummary, type UserPrinter } from "../../../api/printers";
import { settingsApi } from "../../../api/settings";
import { SLICER_OPTIONS } from "../../../constants/settingsOptions";
import { setCachedSlicerSettings, useSlicerSettings } from "../../../hooks/useSlicerPreference";
import { reloadPrinters, useUserPrinters } from "../../../hooks/useUserPrinters";
import NestedMenuItem from "../../NestedMenuItem";
import { bedText } from "../../printers/AddPrinterDialog";
import AddPrinterDialog from "../../printers/AddPrinterDialog";
import PrinterPicture from "../../printers/PrinterPicture";
import { useToast } from "../../ToastProvider";
import { AddTile, AppGrid, AppTile, menuPosition, reopenContextMenuBelow, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";

const TILE = 60;

type Props = { onUnauthorized?: () => void };

type Tile =
  | { kind: "mine"; printer: PrinterSummary; brandName: string; nozzle: string; presets: UserPrinter["presets"] }
  | { kind: "suggested" | "declined"; printer: PrinterSummary; brandName: string; nozzle: string | null; why: string };

/** The printers the user prints on, as app tiles like the Slicer section's, with the ones their library points at
 *  dimmed beside them: double-click adds or removes one, right-click sets its nozzle and the slicers it's for. */
export default function PrintersPanel({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const showToast = useToast();
  const { printers, suggestions, bambu, loaded, failed, reload } = useUserPrinters(onUnauthorized);
  const slicerSettings = useSlicerSettings();
  const [menu, setMenu] = React.useState<{ id: string; top: number; left: number } | null>(null);
  const [adding, setAdding] = React.useState(false);
  // Asked again on the next visit, until a printer is chosen.
  const [bambuLater, setBambuLater] = React.useState(false);
  const [finding, setFinding] = React.useState(false);

  const fail = React.useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error && err.message ? err.message : fallback, severity: "error" });
    },
    [onUnauthorized, showToast],
  );

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await reloadPrinters();
    } catch (err) {
      fail(err, t("printers.failed"));
    }
  };

  const owned = new Set(printers.map((p) => p.printer.id));
  const tiles: Tile[] = [
    ...printers.map((p) => ({ kind: "mine" as const, ...p })),
    ...suggestions.map((s) => ({
      kind: s.declined ? ("declined" as const) : ("suggested" as const),
      printer: s.printer,
      brandName: s.brandName,
      nozzle: s.nozzle,
      why: s.sliced
        ? t("printers.suggestedSliced", { count: s.sliced })
        : t("printers.suggestedProjects", { count: s.projects }),
    })),
  ];
  const tileOf = (id: string) => tiles.find((tile) => tile.printer.id === id) ?? null;
  const fullName = (tile: Tile) => `${tile.brandName} ${tile.printer.model}`;

  const statusOf = (tile: Tile) =>
    tile.kind === "mine"
      ? t("printers.yours", { nozzle: tile.nozzle })
      : tile.kind === "suggested"
        ? `${t("printers.suggested")} · ${tile.why}`
        : t("printers.notYours");

  const add = (printer: PrinterSummary, nozzle?: string | null) => run(() => printersApi.put(printer.id, nozzle));
  const remove = (printer: PrinterSummary) =>
    run(async () => {
      await printersApi.remove(printer.id);
      // The slicers that made copies for it ask again, which the server has done too. The printer is gone either
      // way, so run's reload of the printers comes after this whether or not it worked.
      try {
        setCachedSlicerSettings(await settingsApi.getSlicer());
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
      }
    });
  const activate = (tile: Tile) => (tile.kind === "mine" ? remove(tile.printer) : add(tile.printer, tile.nozzle));

  // The slicers that load a printer's presets by name, switched on in Slicer: the ones a printer can be "used with".
  const slicers = SLICER_OPTIONS.filter(
    (option) => slicerSettings.slicers.includes(option.id) && slicerProfile(option.id)?.targetsPrinter,
  );
  const setUsedWith = async (slicer: string, printerId: string | null) => {
    try {
      setCachedSlicerSettings(await settingsApi.updateSlicer({ printer: { slicer, printer: printerId } }));
    } catch (err) {
      fail(err, t("printers.failed"));
    }
  };

  const findInBambu = async () => {
    setFinding(true);
    try {
      const found = await printersApi.findInBambuAccount();
      await reloadPrinters();
      showToast({
        message: found.length ? t("printers.bambu.found", { count: found.length }) : t("printers.bambu.none"),
        severity: found.length ? "success" : "info",
      });
    } catch (err) {
      if (err instanceof BambuSignInError)
        showToast({
          message: err.reason === "expired" ? t("printers.bambu.expired") : t("printers.bambu.signedOut"),
          severity: "warning",
        });
      else fail(err, t("printers.bambu.failed"));
    } finally {
      setFinding(false);
    }
  };

  const menuTile = menu ? tileOf(menu.id) : null;
  const closeMenu = () => setMenu(null);
  const usedWith = (id: string) => slicers.filter((option) => slicerSettings.printers[option.id] === id);

  return (
    <>
      <PanelHeader title={t("configuration.tabs.printers")} subtitle={t("printers.subtitle")} />

      {bambu && !bambuLater && (
        <Box
          component="section"
          aria-label={t("printers.bambu.region")}
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            mb: 2,
            px: 1.5,
            py: 1,
            borderRadius: "10px",
            bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.14 : 0.07),
            animation: "printers-banner 200ms ease-out",
            "@keyframes printers-banner": { from: { opacity: 0, transform: "translateY(-4px)" }, to: { opacity: 1 } },
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          <CloudOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
            {t("printers.bambu.question")}
          </Typography>
          <Button
            size="small"
            variant="contained"
            disableElevation
            disabled={finding}
            onClick={() => void findInBambu()}
            startIcon={finding ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {t("printers.bambu.find")}
          </Button>
          <Button size="small" onClick={() => setBambuLater(true)} disabled={finding}>
            {t("printers.bambu.later")}
          </Button>
        </Box>
      )}

      {failed ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("printers.loadFailed")}
          </Typography>
          <Button size="small" startIcon={<ReplayIcon />} onClick={() => void reload().catch(() => undefined)}>
            {t("common:retry")}
          </Button>
        </Box>
      ) : !loaded ? (
        <AppGrid column={TILE + 32}>
          {Array.from({ length: 3 }, (_, i) => (
            <Box key={i} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75, py: 1 }}>
              <Skeleton variant="rounded" width={TILE} height={TILE} />
              <Skeleton variant="text" width={48} />
            </Box>
          ))}
        </AppGrid>
      ) : (
        <AppGrid column={TILE + 32}>
          {tiles.map((tile) => (
            <AppTile
              key={tile.printer.id}
              name={tile.printer.model}
              subtitle={
                tile.kind === "mine"
                  ? t("printers.nozzleShort", { nozzle: tile.nozzle })
                  : tile.kind === "suggested"
                    ? t("printers.suggested")
                    : t("printers.notYours")
              }
              logo={<PrinterPicture printer={tile.printer} size={TILE} />}
              size={TILE}
              on={tile.kind === "mine"}
              badge={tile.kind === "mine" ? true : tile.kind === "suggested" ? "add" : undefined}
              highlighted={menu?.id === tile.printer.id}
              tooltip={`${fullName(tile)}: ${statusOf(tile)}`}
              ariaLabel={`${fullName(tile)}: ${statusOf(tile)}`}
              onContextMenu={(event) => setMenu({ id: tile.printer.id, ...menuPosition(event) })}
              onActivate={() => void activate(tile)}
            />
          ))}
          <AddTile label={t("printers.add.tile")} size={TILE} onClick={() => setAdding(true)} />
        </AppGrid>
      )}
      {loaded && !failed && printers.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          {t("printers.empty")}
        </Typography>
      )}

      <Menu
        open={Boolean(menuTile)}
        onClose={closeMenu}
        onContextMenu={(event) => reopenContextMenuBelow(event, closeMenu)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        {menuTile && (
          <TileMenuHeader
            logo={
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: "8px",
                  bgcolor: "common.white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PrinterPicture printer={menuTile.printer} size={36} />
              </Box>
            }
            name={fullName(menuTile)}
            status={bedText(menuTile.printer)}
          />
        )}
        {menuTile?.kind === "mine" && [
          <NestedMenuItem
            key="nozzle"
            icon={<NozzleIcon />}
            label={t("printers.menu.nozzle")}
            detail={t("printers.nozzleShort", { nozzle: menuTile.nozzle })}
          >
            {(close) =>
              (menuTile.printer.nozzles.length ? menuTile.printer.nozzles : ["0.4"]).map((nozzle) => (
                <MenuItem
                  key={nozzle}
                  role="menuitemradio"
                  aria-checked={nozzle === menuTile.nozzle}
                  onClick={() => {
                    close();
                    if (nozzle !== menuTile.nozzle) void add(menuTile.printer, nozzle);
                  }}
                >
                  <ListItemIcon>{nozzle === menuTile.nozzle && <CheckIcon fontSize="small" />}</ListItemIcon>
                  <ListItemText>{t("printers.nozzleShort", { nozzle })}</ListItemText>
                </MenuItem>
              ))
            }
          </NestedMenuItem>,
          <NestedMenuItem
            key="used"
            icon={<LayersOutlinedIcon fontSize="small" />}
            label={t("printers.menu.usedWith")}
            detail={
              usedWith(menuTile.printer.id).length
                ? t("printers.menu.slicers", { count: usedWith(menuTile.printer.id).length })
                : t("printers.menu.unused")
            }
          >
            {() =>
              slicers.length === 0 ? (
                <MenuItem disabled>
                  <ListItemText>{t("printers.menu.noSlicers")}</ListItemText>
                </MenuItem>
              ) : (
                slicers.map((option) => {
                  const checked = slicerSettings.printers[option.id] === menuTile.printer.id;
                  const known = Boolean(menuTile.presets[option.id]);
                  return (
                    // Stays open, so the ticks are seen to change.
                    <MenuItem
                      key={option.id}
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      disabled={!known}
                      onClick={() => void setUsedWith(option.id, checked ? null : menuTile.printer.id)}
                    >
                      <ListItemIcon>{checked && <CheckIcon fontSize="small" />}</ListItemIcon>
                      <ListItemText
                        primary={option.label}
                        secondary={known ? undefined : t("printers.menu.notIn", { slicer: option.label })}
                      />
                    </MenuItem>
                  );
                })
              )
            }
          </NestedMenuItem>,
          <Divider key="divider" />,
          <MenuItem
            key="remove"
            onClick={() => {
              closeMenu();
              void remove(menuTile.printer);
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("printers.menu.remove")}</ListItemText>
          </MenuItem>,
        ]}
        {menuTile &&
          menuTile.kind !== "mine" && [
            <MenuItem
              key="add"
              onClick={() => {
                closeMenu();
                void add(menuTile.printer, menuTile.nozzle);
              }}
            >
              <ListItemIcon>
                <AddCircleOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("printers.menu.add")}</ListItemText>
            </MenuItem>,
            <MenuItem
              key="decline"
              onClick={() => {
                closeMenu();
                void run(() => printersApi.decline(menuTile.printer.id, menuTile.kind === "suggested"));
              }}
            >
              <ListItemIcon>
                {menuTile.kind === "suggested" ? (
                  <BlockOutlinedIcon fontSize="small" />
                ) : (
                  <ReplayIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>
                {menuTile.kind === "suggested" ? t("printers.menu.notMine") : t("printers.menu.suggestAgain")}
              </ListItemText>
            </MenuItem>,
          ]}
      </Menu>

      <AddPrinterDialog
        open={adding}
        onClose={() => setAdding(false)}
        owned={owned}
        initialBrand={tiles[0]?.printer.brand}
        onAdd={(printer) => add(printer)}
        onUnauthorized={onUnauthorized}
      />
    </>
  );
}

/** A hotend's nozzle. */
function NozzleIcon() {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: 20, height: 20 }}>
      <path
        d="M7 3h10v5H7zM9 8h6l-1.5 6h-3zM12 14v4M10 21h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}
