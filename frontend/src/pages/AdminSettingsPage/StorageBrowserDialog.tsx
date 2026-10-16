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
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { adminApi, type StorageFile, type StorageListing } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { readUser } from "../../utils/auth";
import { formatFileSize } from "../../utils/fileSize";

type Props = {
  onClose: () => void;
  onUnauthorized?: () => void;
};

/** The managed model files as they're laid out on disk now: a folder per user, then the storage structure. */
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
          <List dense disablePadding>
            {listing.folders.map((entry) => (
              <ListItemButton key={entry.path} onClick={() => setFolder(entry.path)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {atTop ? <PersonOutlineIcon color="action" /> : <FolderIcon sx={{ color: "warning.light" }} />}
                </ListItemIcon>
                <ListItemText
                  primary={entry.label ?? entry.name}
                  secondary={t("adminSettings.storageBrowser.folderSummary", {
                    count: entry.files,
                    size: formatFileSize(entry.bytes),
                  })}
                  primaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
                />
              </ListItemButton>
            ))}
            {listing.files.map((file) => (
              <FileRow
                key={file.plate_id}
                file={file}
                // Another user's model isn't one an admin can open.
                onOpen={file.owner_id === me ? () => navigate(`/models/${file.print_id}`) : undefined}
              />
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileRow({ file, onOpen }: { file: StorageFile; onOpen?: () => void }) {
  const { t } = useTranslation("app");
  const content = (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <InsertDriveFileOutlinedIcon color="action" />
      </ListItemIcon>
      <ListItemText
        primary={file.name}
        secondary={`${formatFileSize(file.size)} · ${t("adminSettings.storageBrowser.ofModel", { name: file.print_name })}`}
        primaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
      />
      {file.location !== "managed" && (
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
