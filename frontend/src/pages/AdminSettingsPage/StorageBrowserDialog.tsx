import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme, type Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import ThreeDRotationOutlinedIcon from "@mui/icons-material/ThreeDRotationOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  adminApi,
  type StorageFile,
  type StorageFileKind,
  type StorageFolder,
  type StorageListing,
} from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { statusTint } from "../../theme";
import { readUser } from "../../utils/auth";
import { formatFileSize } from "../../utils/fileSize";

type Props = {
  onClose: () => void;
  onUnauthorized?: () => void;
};

const KIND_ICONS: Record<StorageFileKind, typeof InsertDriveFileOutlinedIcon> = {
  plate: ViewInArOutlinedIcon,
  file: InsertDriveFileOutlinedIcon,
  license: GavelOutlinedIcon,
  image: ImageOutlinedIcon,
  description: ImageOutlinedIcon,
  thumb: ImageOutlinedIcon,
  render: ImageOutlinedIcon,
  preview: ThreeDRotationOutlinedIcon,
  slicer: LayersOutlinedIcon,
};

// A row the disk couldn't read: the warning sign in place of its icon, and its line in the theme's warning text, which
// stays readable small on a light panel.
const unreadableIcon = <WarningAmberIcon sx={{ color: "warning.main" }} />;
const unreadableLine = { sx: { color: (theme: Theme) => statusTint(theme, "warning").text } };

/** The managed model files, and the supporting files, pictures, 3D previews and slicer copies beside them, as they're
 *  laid out on disk now: a folder per user, then the storage structure. */
export default function StorageBrowserDialog({ onClose, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const me = readUser()?.id;
  const [folder, setFolder] = React.useState("");
  const [listing, setListing] = React.useState<StorageListing | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setListing(null);
    setError(null);
    adminApi.browseStorage(folder).then(
      (result) => active && setListing(result),
      (err: unknown) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [folder, onUnauthorized]);

  const atTop = folder === "";
  const empty = listing && !listing.folders.length && !listing.files.length;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 6 }}>
        {t("adminSettings.storageBrowser.title")}
        <IconButton aria-label={t("common:close")} onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, minHeight: 360 }}>
        <Breadcrumbs sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }} maxItems={6}>
          {atTop ? (
            <Typography color="text.primary">{t("adminSettings.storageBrowser.root")}</Typography>
          ) : (
            <Link component="button" type="button" underline="hover" onClick={() => setFolder("")}>
              {t("adminSettings.storageBrowser.root")}
            </Link>
          )}
          {(listing?.crumbs ?? []).map((crumb, index, crumbs) =>
            index === crumbs.length - 1 ? (
              <Typography key={crumb.path} color="text.primary" sx={{ wordBreak: "break-all" }}>
                {crumb.label ?? crumb.name}
              </Typography>
            ) : (
              <Link
                key={crumb.path}
                component="button"
                type="button"
                underline="hover"
                onClick={() => setFolder(crumb.path)}
              >
                {crumb.label ?? crumb.name}
              </Link>
            ),
          )}
        </Breadcrumbs>

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {!listing && !error && (
          <Box sx={{ p: 2 }}>
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} height={44} />
            ))}
          </Box>
        )}
        {empty && (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
            {t("adminSettings.storageBrowser.empty")}
          </Typography>
        )}
        {listing && !empty && (
          <StorageListingView
            listing={listing}
            atTop={atTop}
            me={me}
            onOpenFolder={setFolder}
            onOpenModel={(printId) => navigate(`/models/${printId}`)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A folder's folders and files, with one warning above them when the disk couldn't read some of what's here. */
export function StorageListingView({
  listing,
  atTop,
  me,
  onOpenFolder,
  onOpenModel,
}: {
  listing: StorageListing;
  atTop: boolean;
  me: string | undefined;
  onOpenFolder: (path: string) => void;
  onOpenModel: (printId: string) => void;
}) {
  const { t } = useTranslation("app");
  // The folder itself counts when the disk couldn't list all of it.
  const unreadable =
    (listing.error_code ? 1 : 0) +
    listing.folders.filter((entry) => entry.error_code !== null).length +
    listing.files.filter((file) => file.location === "unreadable").length;
  return (
    <>
      {unreadable > 0 && (
        <Alert severity="warning" sx={{ mx: 2, mt: 2, mb: 1 }}>
          {t("adminSettings.storageBrowser.unreadable", { count: unreadable })}
          {/* The folder's own code, as an unreadable row shows its. */}
          {listing.error_code ? ` · ${listing.error_code}` : null}
        </Alert>
      )}
      <List dense disablePadding>
        {listing.folders.map((entry) => (
          <FolderRow key={entry.path} entry={entry} atTop={atTop} onOpen={() => onOpenFolder(entry.path)} />
        ))}
        {listing.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            // Another user's model isn't one an admin can open.
            onOpen={file.owner_id === me ? () => onOpenModel(file.print_id) : undefined}
          />
        ))}
      </List>
    </>
  );
}

function FolderRow({ entry, atTop, onOpen }: { entry: StorageFolder; atTop: boolean; onOpen: () => void }) {
  const { t } = useTranslation("app");
  const unreadable = entry.error_code !== null;
  const content = (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>
        {unreadable ? (
          unreadableIcon
        ) : atTop ? (
          <PersonOutlineIcon color="action" />
        ) : entry.pictures ? (
          <PhotoLibraryIcon sx={{ color: "info.light" }} />
        ) : (
          <FolderIcon sx={{ color: "warning.light" }} />
        )}
      </ListItemIcon>
      <ListItemText
        primary={entry.label ?? entry.name}
        secondary={
          unreadable
            ? [t("adminSettings.storageBrowser.cantReadFolder"), entry.error_code].join(" · ")
            : t("adminSettings.storageBrowser.folderSummary", {
                count: entry.files,
                size: formatFileSize(entry.bytes),
              })
        }
        primaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
        secondaryTypographyProps={unreadable ? unreadableLine : undefined}
      />
    </>
  );
  // With nothing listed below a folder the disk couldn't list, there's nothing to open.
  return unreadable && !entry.files ? (
    <ListItem>{content}</ListItem>
  ) : (
    <ListItemButton onClick={onOpen}>{content}</ListItemButton>
  );
}

function FileRow({ file, onOpen }: { file: StorageFile; onOpen?: () => void }) {
  const { t } = useTranslation("app");
  const Icon = KIND_ICONS[file.kind];
  const unreadable = file.location === "unreadable";
  const content = (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>{unreadable ? unreadableIcon : <Icon color="action" />}</ListItemIcon>
      <ListItemText
        primary={file.name}
        secondary={[
          ...(unreadable ? [t("adminSettings.storageBrowser.cantRead"), file.error_code] : []),
          formatFileSize(file.size),
          t(`adminSettings.storageBrowser.kind.${file.kind}`),
          t("adminSettings.storageBrowser.ofModel", { name: file.print_name }),
        ]
          .filter(Boolean)
          .join(" · ")}
        primaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
        secondaryTypographyProps={unreadable ? unreadableLine : undefined}
      />
      {(file.location === "source" || file.location === "missing") && (
        <Chip
          size="small"
          color={file.location === "missing" ? "error" : "default"}
          label={t(`adminSettings.storageBrowser.location.${file.location}`)}
          title={t(`adminSettings.storageBrowser.locationHint.${file.location}`)}
          sx={{ ml: 1, flexShrink: 0 }}
        />
      )}
    </>
  );
  return onOpen ? <ListItemButton onClick={onOpen}>{content}</ListItemButton> : <ListItem>{content}</ListItem>;
}
