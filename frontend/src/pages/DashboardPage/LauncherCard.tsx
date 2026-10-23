import { useState } from "react";
import { useTranslation } from "react-i18next";
import { alpha, type Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import DashboardCard, { DashboardCardBody } from "./DashboardCard";
import { useIconSrc } from "../../components/IconPicker/iconCatalog";
import type { LauncherLink } from "./widgets";

/** As holm draws app icons: in their own colours, or as one-colour glyphs that follow the theme, or those dimmed. */
export type LauncherIconStyle = "colored" | "mono" | "grayed";

const TILE = 44;
const ICON = 26;

const hoverBg = (theme: Theme) => alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.06 : 0.04);

/** The site's own icon, where most sites keep one, for an item given none. */
function faviconOf(url: string): string | null {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/**
 * An item's icon on its tile: the image the user gave, else the site's own icon, else the name's first letter, which
 * also shows while an image loads (a LAN address that doesn't answer can take a while to fail).
 *
 * Mono and grayed make any image a one-colour glyph in the theme's ink. holm blackens every pixel, which suits icons
 * drawn on transparency but turns one with a solid background into a square; here it's made grey and blended into
 * the tile instead: multiplied on a light theme, so white falls away, and inverted then screened on a dark one, so
 * black does.
 */
export function LauncherIcon({
  item,
  iconStyle,
  size = TILE,
}: {
  item: LauncherLink;
  iconStyle: LauncherIconStyle;
  size?: number;
}) {
  const sources = [useIconSrc(item.icon), faviconOf(item.url)].filter((src): src is string => Boolean(src));
  const [failed, setFailed] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = sources[failed];
  const colored = iconStyle === "colored";
  const glyph = Math.round(size * (ICON / TILE));
  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        width: size,
        height: size,
        borderRadius: `${Math.round(size * 0.27)}px`,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        // A coloured icon sits on white, as brand icons are drawn for; a glyph on a quiet tile in the theme's colours.
        bgcolor: colored ? theme.palette.common.white : theme.palette.background.paper,
        backgroundImage: colored
          ? "none"
          : `linear-gradient(${alpha(theme.palette.text.primary, 0.08)}, ${alpha(theme.palette.text.primary, 0.08)})`,
        boxShadow: colored ? `inset 0 0 0 1px ${alpha(theme.palette.common.black, 0.08)}` : "none",
        opacity: iconStyle === "grayed" ? 0.55 : 1,
        // Each tile blends on its own, not with what's behind the card.
        isolation: "isolate",
      })}
    >
      {loaded !== src && (
        <Typography
          aria-hidden
          sx={{
            fontWeight: 700,
            fontSize: Math.round(size * 0.45),
            lineHeight: 1,
            color: colored ? "primary.main" : "text.primary",
          }}
        >
          {(item.name || "?")[0].toUpperCase()}
        </Typography>
      )}
      {src && (
        <Box
          component="img"
          // A new source when the last one failed, so the browser loads it afresh.
          key={src}
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed((count) => count + 1)}
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            m: "auto",
            width: glyph,
            height: glyph,
            objectFit: "contain",
            opacity: loaded === src ? 1 : 0,
            transition: "opacity 150ms ease",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            ...(!colored &&
              (theme.palette.mode === "dark"
                ? { filter: "grayscale(1) invert(1) contrast(1.2)", mixBlendMode: "screen" }
                : { filter: "grayscale(1) contrast(1.2)", mixBlendMode: "multiply" })),
          })}
        />
      )}
    </Box>
  );
}

function LauncherTile({ item, iconStyle }: { item: LauncherLink; iconStyle: LauncherIconStyle }) {
  return (
    <ButtonBase
      component="a"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={item.name}
      sx={{
        flexDirection: "column",
        justifyContent: "flex-start",
        gap: 0.75,
        px: 0.5,
        py: 1,
        borderRadius: "10px",
        transition: "background-color 150ms ease, transform 150ms ease",
        "&:hover": { bgcolor: hoverBg, transform: "translateY(-1px)" },
        "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
      }}
    >
      <LauncherIcon item={item} iconStyle={iconStyle} />
      <Typography
        variant="caption"
        sx={{
          fontSize: "0.7rem",
          lineHeight: 1.25,
          maxWidth: "100%",
          textAlign: "center",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          color: "text.primary",
        }}
      >
        {item.name}
      </Typography>
    </ButtonBase>
  );
}

/** Tiles wrap to the panel's width: a row in a wide panel, a column in a narrow one. */
function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, 76px)",
        justifyContent: "center",
        gap: 0.5,
      }}
    >
      {children}
    </Box>
  );
}

function SearchField({
  value,
  onChange,
  focusOnOpen,
}: {
  value: string;
  onChange: (value: string) => void;
  focusOnOpen?: boolean;
}) {
  const { t } = useTranslation("app");
  return (
    <TextField
      size="small"
      fullWidth
      value={value}
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={focusOnOpen}
      placeholder={t("dashboard.launcher.search")}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": t("dashboard.launcher.search") },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

const matching = (items: LauncherLink[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
};

type Props = {
  items: LauncherLink[];
  iconStyle: LauncherIconStyle;
  /** How many tiles show before "Show all"; null shows every one, scrolling in the panel. */
  limit: number | null;
  search: boolean;
};

/** Links as app icons, each opening in a new tab. No title: the icons say what it is. */
export default function LauncherCard({ items, iconStyle, limit, search }: Props) {
  const { t } = useTranslation("app");
  const [query, setQuery] = useState("");
  const [allOpen, setAllOpen] = useState(false);
  const [dialogQuery, setDialogQuery] = useState("");
  const found = matching(items, query);
  // A search shows every match: it's already narrowed down.
  const shown = limit && !query.trim() ? found.slice(0, limit) : found;
  const hidden = found.length - shown.length;

  return (
    <DashboardCard
      scroll={false}
      component="nav"
      aria-label={t("dashboard.launcher.title")}
      sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
    >
      {search && items.length > 0 && (
        <Box sx={{ flexShrink: 0 }}>
          <SearchField value={query} onChange={setQuery} />
        </Box>
      )}
      <DashboardCardBody>
        {!items.length ? (
          <Typography color="text.secondary" sx={{ p: 1 }}>
            {t("dashboard.launcher.empty")}
          </Typography>
        ) : !found.length ? (
          <Typography color="text.secondary" sx={{ p: 1, textAlign: "center" }}>
            {t("dashboard.launcher.noMatch")}
          </Typography>
        ) : (
          <TileGrid>
            {shown.map((item) => (
              <LauncherTile key={item.url + item.name} item={item} iconStyle={iconStyle} />
            ))}
            {hidden > 0 && (
              <ButtonBase
                onClick={() => setAllOpen(true)}
                aria-label={t("dashboard.launcher.showAll")}
                sx={{
                  flexDirection: "column",
                  justifyContent: "flex-start",
                  gap: 0.75,
                  px: 0.5,
                  py: 1,
                  borderRadius: "10px",
                  "&:hover": { bgcolor: hoverBg },
                  "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
                }}
              >
                <Box
                  sx={(theme) => ({
                    width: TILE,
                    height: TILE,
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px dashed ${alpha(theme.palette.text.primary, 0.3)}`,
                    color: "text.secondary",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                  })}
                >
                  {`+${hidden}`}
                </Box>
                <Typography variant="caption" sx={{ fontSize: "0.7rem", lineHeight: 1.25, color: "text.secondary" }}>
                  {t("dashboard.launcher.showAll")}
                </Typography>
              </ButtonBase>
            )}
          </TileGrid>
        )}
      </DashboardCardBody>

      <Dialog
        open={allOpen}
        onClose={() => {
          setAllOpen(false);
          setDialogQuery("");
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          {t("dashboard.launcher.allTitle", { count: items.length })}
          <IconButton size="small" aria-label={t("dashboard.launcher.close")} onClick={() => setAllOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <SearchField value={dialogQuery} onChange={setDialogQuery} focusOnOpen />
          </Box>
          {matching(items, dialogQuery).length ? (
            <TileGrid>
              {matching(items, dialogQuery).map((item) => (
                <LauncherTile key={item.url + item.name} item={item} iconStyle={iconStyle} />
              ))}
            </TileGrid>
          ) : (
            <Typography color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
              {t("dashboard.launcher.noMatch")}
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </DashboardCard>
  );
}
