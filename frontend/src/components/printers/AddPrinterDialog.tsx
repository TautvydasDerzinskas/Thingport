import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import SearchIcon from "@mui/icons-material/Search";
import { UnauthorizedError } from "../../api/client";
import { printersApi, type PrinterCatalogue, type PrinterSummary } from "../../api/printers";
import PrinterPicture from "./PrinterPicture";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Catalogue ids of the printers already the user's. */
  owned: ReadonlySet<string>;
  /** The brand to show first: of a printer of theirs or a suggestion. */
  initialBrand?: string;
  onAdd: (printer: PrinterSummary) => Promise<void>;
  onUnauthorized?: () => void;
};

const CARD = 64;

export function bedText(printer: PrinterSummary): string {
  const bed = printer.bed;
  if (!bed) return "";
  const size = bed.shape === "circle" ? `⌀ ${bed.diameter ?? bed.x}` : `${bed.x} × ${bed.y}`;
  return printer.height ? `${size} × ${printer.height} mm` : `${size} mm`;
}

/** Every printer the catalogue has, by brand or by search: clicking one adds it, and the dialog stays for the next. */
export default function AddPrinterDialog({ open, onClose, owned, initialBrand, onAdd, onUnauthorized }: Props) {
  const { t } = useTranslation(["app"]);
  const [catalogue, setCatalogue] = useState<PrinterCatalogue | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const search = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || catalogue) return;
    let active = true;
    // Opening it again after a failure tries again.
    setFailed(false);
    printersApi
      .catalogue()
      .then((res) => {
        if (active) setCatalogue(res);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, catalogue, onUnauthorized]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const brandNames = useMemo(() => new Map(catalogue?.brands.map((b) => [b.id, b.name]) ?? []), [catalogue]);
  const nameOf = (printer: PrinterSummary) => `${brandNames.get(printer.brand) ?? printer.brand} ${printer.model}`;

  const matching = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!catalogue || !words.length) return null;
    return catalogue.printers.filter((printer) => {
      const name = `${brandNames.get(printer.brand) ?? printer.brand} ${printer.model}`.toLowerCase();
      return words.every((word) => name.includes(word));
    });
  }, [catalogue, brandNames, query]);

  const shownBrand =
    brand ??
    (initialBrand && brandNames.has(initialBrand) ? initialBrand : brandNames.has("bambulab") ? "bambulab" : null) ??
    catalogue?.brands[0]?.id ??
    null;
  const shown = matching ?? catalogue?.printers.filter((printer) => printer.brand === shownBrand) ?? [];

  const add = async (printer: PrinterSummary) => {
    if (owned.has(printer.id) || adding) return;
    setAdding(printer.id);
    try {
      await onAdd(printer);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="add-printer-title"
      // Search is where it starts.
      TransitionProps={{ onEntered: () => search.current?.focus() }}
    >
      <DialogTitle id="add-printer-title">{t("printers.add.title")}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "min(70vh, 560px)" }}>
        <TextField
          inputRef={search}
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("printers.add.search")}
          inputProps={{ "aria-label": t("printers.add.search") }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ mt: 0.5 }}
        />
        {/* The brand list beside the printers doesn't fit a phone: there it's a picker under the search. */}
        {!matching && catalogue && (
          <TextField
            select
            size="small"
            label={t("printers.add.brands")}
            value={shownBrand ?? ""}
            onChange={(event) => setBrand(event.target.value)}
            sx={{ display: { xs: "flex", sm: "none" } }}
          >
            {catalogue.brands.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name} ({b.printers})
              </MenuItem>
            ))}
          </TextField>
        )}
        <Box sx={{ display: "flex", gap: 2, flex: 1, minHeight: 0 }}>
          {!matching && (
            <List
              dense
              aria-label={t("printers.add.brands")}
              sx={{ width: 200, flexShrink: 0, overflowY: "auto", display: { xs: "none", sm: "block" }, py: 0 }}
            >
              {(catalogue?.brands ?? []).map((b) => (
                <ListItemButton
                  key={b.id}
                  selected={b.id === shownBrand}
                  onClick={() => setBrand(b.id)}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemText primary={b.name} primaryTypographyProps={{ noWrap: true }} />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {b.printers}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          )}
          <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
            {failed ? (
              <Typography variant="body2" color="error">
                {t("printers.add.failed")}
              </Typography>
            ) : !catalogue ? (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 1 }}>
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} variant="rounded" height={CARD + 46} />
                ))}
              </Box>
            ) : shown.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                {t("printers.add.none", { query: query.trim() })}
              </Typography>
            ) : (
              <Box
                component="ul"
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 1,
                  m: 0,
                  p: 0,
                  listStyle: "none",
                }}
              >
                {shown.map((printer) => (
                  <PrinterCard
                    key={printer.id}
                    printer={printer}
                    name={matching ? nameOf(printer) : printer.model}
                    added={owned.has(printer.id)}
                    busy={adding === printer.id}
                    onClick={() => void add(printer)}
                    addedLabel={t("printers.add.added")}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("printers.add.done")}</Button>
      </DialogActions>
    </Dialog>
  );
}

function PrinterCard({
  printer,
  name,
  added,
  busy,
  onClick,
  addedLabel,
}: {
  printer: PrinterSummary;
  name: string;
  added: boolean;
  busy: boolean;
  onClick: () => void;
  addedLabel: string;
}) {
  return (
    <Box component="li" sx={{ display: "flex" }}>
      <ButtonBase
        onClick={onClick}
        disabled={added || busy}
        aria-label={added ? `${name}: ${addedLabel}` : name}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.75,
          p: 1.25,
          borderRadius: "10px",
          border: 1,
          borderColor: added ? "primary.main" : "divider",
          transition: "border-color 150ms, background-color 150ms",
          "&:hover": { borderColor: "primary.main" },
          "&.Mui-disabled": { opacity: 1 },
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: CARD,
            height: CARD,
            borderRadius: "8px",
            bgcolor: "common.white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy ? 0.5 : 1,
            transition: "opacity 150ms",
          }}
        >
          <PrinterPicture printer={printer} size={CARD} />
          {added && (
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "primary.contrastText",
                "& svg.ring": { position: "absolute", inset: 0 },
                animation: "printer-added 220ms ease-out",
                "@keyframes printer-added": {
                  from: { transform: "scale(0.4)", opacity: 0 },
                  to: { transform: "none" },
                },
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            >
              <Box component="svg" className="ring" viewBox="0 0 20 20" sx={{ color: "primary.main" }}>
                <circle cx="10" cy="10" r="9" fill="currentColor" />
              </Box>
              <CheckIcon sx={{ fontSize: 14, position: "relative" }} />
            </Box>
          )}
        </Box>
        <Typography variant="body2" fontWeight={600} sx={{ textAlign: "center", lineHeight: 1.25 }}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {bedText(printer)}
        </Typography>
      </ButtonBase>
    </Box>
  );
}
