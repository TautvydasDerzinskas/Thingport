import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import { iconsApi, type UserIcon } from "../../api/icons";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import HelpTip from "../HelpTip";
import { ICON_GROUPS, useIconCatalog, type IconGroup } from "./iconCatalog";

const TILE = 52;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.svg";

const tileIn = keyframes`
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: none; }
`;

type Props = {
  open: boolean;
  value: string;
  onClose: () => void;
  onPick: (value: string) => void;
};

/** Every icon to pick from: the user's uploads, then Thingport's own by group, or an image's web address. */
export default function IconBrowserDialog({ open, value, onClose, onPick }: Props) {
  const { t } = useTranslation("app");
  const catalog = useIconCatalog();
  const confirm = useConfirm();
  const showToast = useToast();
  const [query, setQuery] = React.useState("");
  const [uploads, setUploads] = React.useState<UserIcon[] | null>(null);
  const [uploading, setUploading] = React.useState(0);
  const [dropping, setDropping] = React.useState(false);
  const [address, setAddress] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setAddress(value && /^https?:/i.test(value) ? value : "");
    let live = true;
    iconsApi
      .list()
      .then((icons) => live && setUploads(icons))
      .catch(() => live && setUploads([]));
    return () => {
      live = false;
    };
  }, [open, value]);

  const pick = (picked: string) => {
    onPick(picked);
    onClose();
  };

  const upload = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/") || /\.svg$/i.test(file.name));
    if (!images.length) return;
    setUploading((count) => count + images.length);
    const added: UserIcon[] = [];
    for (const file of images) {
      try {
        added.push(await iconsApi.upload(file));
      } catch (error) {
        showToast({ message: (error as Error).message || t("iconPicker.uploadFailed"), severity: "error" });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    setUploads((current) => [...added.toReversed(), ...(current ?? [])]);
    // One picture, the usual case, is what the user wanted: it's picked straight away.
    if (images.length === 1 && added.length === 1) pick(added[0].url);
  };

  const remove = async (icon: UserIcon) => {
    const ok = await confirm({
      title: t("iconPicker.deleteTitle", { name: icon.name }),
      message: t("iconPicker.deleteMessage"),
      confirmLabel: t("iconPicker.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await iconsApi.remove(icon.id);
      setUploads((current) => current?.filter((other) => other.id !== icon.id) ?? null);
    } catch (error) {
      showToast({ message: (error as Error).message, severity: "error" });
    }
  };

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const shownUploads = (uploads ?? []).filter((icon) => matches(icon.name));
  const groups = ICON_GROUPS.map((group) => ({
    group,
    icons: catalog.filter((icon) => icon.group === group && (matches(icon.name) || matches(group))),
  })).filter(({ icons }) => icons.length);
  const addressValid = /^https?:\/\/\S+$/i.test(address.trim());

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="icon-browser-title">
      <DialogTitle id="icon-browser-title" sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1.5 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {t("iconPicker.title")}
        </Box>
        <IconButton size="small" aria-label={t("iconPicker.close")} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1.5, display: "flex", gap: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t("iconPicker.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            htmlInput: { "aria-label": t("iconPicker.search") },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button
          variant="outlined"
          startIcon={<AddPhotoAlternateOutlinedIcon />}
          onClick={() => fileRef.current?.click()}
          sx={{ flexShrink: 0 }}
        >
          {t("iconPicker.upload")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = "";
          }}
        />
      </Box>
      <DialogContent
        dividers
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          void upload(event.dataTransfer.files);
        }}
        sx={(theme) => ({
          minHeight: 320,
          outline: dropping ? `2px dashed ${theme.palette.primary.main}` : "2px dashed transparent",
          outlineOffset: -6,
          bgcolor: dropping ? alpha(theme.palette.primary.main, 0.06) : "transparent",
          transition: "background-color 150ms ease, outline-color 150ms ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        })}
      >
        <Section title={t("iconPicker.groups.uploaded")} help={t("iconPicker.uploadHelp")}>
          <ButtonBase
            onClick={() => fileRef.current?.click()}
            aria-label={t("iconPicker.upload")}
            sx={(theme) => ({
              ...tileSx,
              border: `1px dashed ${alpha(theme.palette.text.primary, 0.3)}`,
              color: "text.secondary",
              "&:hover, &.Mui-focusVisible": { borderColor: theme.palette.primary.main, color: "primary.main" },
            })}
          >
            <AddPhotoAlternateOutlinedIcon />
          </ButtonBase>
          {uploads === null &&
            Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} variant="rounded" width={TILE} height={TILE} sx={{ borderRadius: "12px" }} />
            ))}
          {Array.from({ length: uploading }, (_, index) => (
            <Skeleton key={`up-${index}`} variant="rounded" width={TILE} height={TILE} sx={{ borderRadius: "12px" }} />
          ))}
          {shownUploads.map((icon) => (
            <IconTile
              key={icon.id}
              name={icon.name}
              src={icon.url}
              selected={value === icon.url}
              onPick={() => pick(icon.url)}
              onDelete={() => void remove(icon)}
            />
          ))}
        </Section>
        {uploads !== null && uploads.length === 0 && !uploading && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: -1, mb: 2 }}>
            {t("iconPicker.noUploads")}
          </Typography>
        )}
        {groups.map(({ group, icons }) => (
          <Section key={group} title={t(`iconPicker.groups.${group satisfies IconGroup}`)}>
            {icons.map((icon) => (
              <IconTile
                key={icon.value}
                name={icon.name}
                src={icon.src}
                selected={value === icon.value}
                onPick={() => pick(icon.value)}
              />
            ))}
          </Section>
        ))}
        {needle && !groups.length && !shownUploads.length && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
            {t("iconPicker.noMatches", { query: query.trim() })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Box
          component="form"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            // React carries it on through the portal, to a form the picker sits in.
            event.stopPropagation();
            if (addressValid) pick(address.trim());
          }}
          sx={{ display: "flex", gap: 1, width: "100%" }}
        >
          <TextField
            size="small"
            fullWidth
            label={t("iconPicker.address")}
            placeholder="https://example.com/icon.svg"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            error={address.trim() !== "" && !addressValid}
            slotProps={{ htmlInput: { inputMode: "url", spellCheck: false, maxLength: 2048 } }}
          />
          <Button type="submit" variant="contained" disabled={!addressValid} sx={{ flexShrink: 0 }}>
            {t("iconPicker.useAddress")}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

const tileSx = {
  width: TILE,
  height: TILE,
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 2.5, "&:last-child": { mb: 0 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {title}
        </Typography>
        {help && <HelpTip text={help} />}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${TILE}px, 1fr))`, gap: 1 }}>
        {children}
      </Box>
    </Box>
  );
}

/** One icon, on white as the launcher draws coloured icons. An uploaded one has a menu, also on right-click. */
function IconTile({
  name,
  src,
  selected,
  onPick,
  onDelete,
}: {
  name: string;
  src: string;
  selected: boolean;
  onPick: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation("app");
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement } | { x: number; y: number } | null>(null);
  return (
    <Box
      sx={{
        position: "relative",
        justifySelf: "center",
        "&:hover .icon-more, &:focus-within .icon-more": { opacity: 1 },
      }}
      onContextMenu={
        onDelete
          ? (event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY });
            }
          : undefined
      }
    >
      <Tooltip title={name}>
        <ButtonBase
          onClick={onPick}
          aria-label={name}
          aria-pressed={selected}
          sx={(theme) => ({
            ...tileSx,
            bgcolor: theme.palette.common.white,
            boxShadow: selected
              ? `0 0 0 2px ${theme.palette.primary.main}`
              : `inset 0 0 0 1px ${alpha(theme.palette.common.black, 0.1)}`,
            transition: "transform 150ms ease, box-shadow 150ms ease",
            animation: `${tileIn} 180ms ease-out`,
            "&:hover": { transform: "translateY(-2px)" },
            "&.Mui-focusVisible": { boxShadow: `0 0 0 3px ${theme.palette.primary.main}` },
            "@media (prefers-reduced-motion: reduce)": { animation: "none", transition: "none", transform: "none" },
          })}
        >
          <Box component="img" src={src} alt="" loading="lazy" sx={{ width: 30, height: 30, objectFit: "contain" }} />
        </ButtonBase>
      </Tooltip>
      {onDelete && (
        <>
          <IconButton
            className="icon-more"
            size="small"
            aria-label={t("iconPicker.actionsFor", { name })}
            aria-haspopup="menu"
            onClick={(event) => setMenu({ anchor: event.currentTarget })}
            sx={{
              position: "absolute",
              top: -8,
              right: -8,
              p: 0.25,
              opacity: 0,
              bgcolor: "background.paper",
              boxShadow: 1,
              transition: "opacity 150ms ease",
              "&:hover": { bgcolor: "background.paper" },
              "@media (hover: none)": { opacity: 1 },
            }}
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Menu
            open={menu !== null}
            onClose={() => setMenu(null)}
            anchorEl={menu && "anchor" in menu ? menu.anchor : undefined}
            anchorReference={menu && "anchor" in menu ? "anchorEl" : "anchorPosition"}
            anchorPosition={menu && "x" in menu ? { left: menu.x, top: menu.y } : undefined}
          >
            <MenuItem
              onClick={() => {
                setMenu(null);
                onDelete();
              }}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("iconPicker.delete")}</ListItemText>
            </MenuItem>
          </Menu>
        </>
      )}
    </Box>
  );
}
