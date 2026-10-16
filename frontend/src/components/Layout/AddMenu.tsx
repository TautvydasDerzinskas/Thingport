import Box from "@mui/material/Box";
import type { CaptchaAnswer } from "../../api/captcha";
import CaptchaField from "../CaptchaField";
import { useCaptchaSettings } from "../../hooks/useCaptchaSettings";
import React from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DriveFolderUploadIcon from "@mui/icons-material/DriveFolderUpload";
import LinkIcon from "@mui/icons-material/Link";
import { useUploadImport } from "../uploads/useUploadImport";
import { useImportJob } from "./ImportJobContext";
import { useToast } from "../ToastProvider";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import {
  detectImportProvider,
  IMPORT_LINK_EXAMPLES,
  isMakerworldCollectionUrl,
  isMakerworldModelUrl,
  isPrintablesCollectionUrl,
  isThingiverseCollectionUrl,
  isThingiverseLikesUrl,
  type ImportProviderKey,
} from "../../utils/importLinkDetection";
import type { MakerworldProfileScope } from "../../api/imports";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useDisabledProviders";

const IMPORT_PROVIDERS: ImportProviderKey[] = ["makerworld", "thingiverse", "printables"];

/** What the search palette's !import command calls. */
export type AddMenuHandle = {
  /** No link opens the import dialog. A supported link imports straight away, unless something
   *  needs the dialog first (a captcha, a blocked or invalid link, several links), when it opens
   *  filled in with it. */
  importFromCommand: (link?: string) => void;
};

type Props = {
  categoryId?: string | null;
  makerworldCookie?: string | null;
  onUploaded: () => void;
  onUnauthorized?: () => void;
};

/** The top bar's "+ Add" button. MakerWorld collection links are blocked here; they can only be
 *  imported via the browser extension. */
const AddMenu = React.forwardRef<AddMenuHandle, Props>(function AddMenu(
  { categoryId, makerworldCookie, onUploaded, onUnauthorized },
  ref,
) {
  const { t } = useTranslation(["app", "common"]);
  // Turned off by an admin: not offered.
  const disabledProviders = useDisabledProviders();
  const showToast = useToast();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [linkValue, setLinkValue] = React.useState("");
  const [exampleProvider, setExampleProvider] = React.useState<ImportProviderKey | null>(null);
  const [profileScope, setProfileScope] = React.useState<MakerworldProfileScope>("url");
  const { isImporting } = useImportJob();
  const upload = useUploadImport({ categoryId, makerworldCookie, onUploaded, onUnauthorized });
  const captchaSettings = useCaptchaSettings();
  const [captcha, setCaptcha] = React.useState<CaptchaAnswer | null>(null);
  const needsCaptcha = Boolean(captchaSettings?.import);

  // A pasted block of links becomes one queue job; a single link keeps the existing flows
  // (collection pickers, zip inspection, immediate import).
  const links = React.useMemo(
    () =>
      linkValue
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [linkValue],
  );
  const isBatch = links.length > 1;
  const detectedProviders = React.useMemo(() => {
    const found = new Set<ImportProviderKey>();
    for (const link of links) {
      const key = detectImportProvider(link);
      if (key) found.add(key);
    }
    return found;
  }, [links]);
  const isBlockedCollection = isBatch
    ? links.some(
        (link) =>
          isMakerworldCollectionUrl(link) ||
          isThingiverseLikesUrl(link) ||
          isThingiverseCollectionUrl(link) ||
          isPrintablesCollectionUrl(link),
      )
    : isMakerworldCollectionUrl(linkValue);
  const isMakerworldModel = links.some((link) => isMakerworldModelUrl(link));

  const closeMenu = () => setAnchorEl(null);

  const handleUpload = () => {
    closeMenu();
    upload.triggerUpload();
  };

  const handleFolderUpload = () => {
    closeMenu();
    upload.triggerFolderUpload();
  };

  const openImport = (prefill = "") => {
    closeMenu();
    setLinkValue(prefill);
    setExampleProvider(null);
    setProfileScope("url");
    setImportOpen(true);
  };

  React.useImperativeHandle(ref, () => ({
    importFromCommand: (link) => {
      // The same rule as the Add button, which is disabled meanwhile.
      if (upload.isBusy || isImporting) {
        showToast({ message: t("addMenu.disabledWhileImporting"), severity: "info" });
        return;
      }
      const url = link?.trim() ?? "";
      const direct =
        url && !/\s/.test(url) && detectImportProvider(url) && !isMakerworldCollectionUrl(url) && !needsCaptcha;
      if (direct) void upload.submitImport(url);
      else openImport(url);
    },
  }));

  const closeImport = () => {
    if (upload.importing) return;
    setImportOpen(false);
  };

  const submitImport = async () => {
    if (!links.length || isBlockedCollection) return;
    if (needsCaptcha && !captcha?.captcha_answer.trim()) return;
    // Each captcha works once; reopening shows a fresh one.
    if (isBatch) {
      await upload.submitImportMany(links, needsCaptcha ? captcha : null, isMakerworldModel ? profileScope : "url");
      setImportOpen(false);
      return;
    }
    await upload.submitImport(linkValue, needsCaptcha ? captcha : null, isMakerworldModel ? profileScope : "url");
    setImportOpen(false);
  };

  return (
    <>
      {upload.fileInput}
      {upload.folderInput}
      <Tooltip title={isImporting ? t("addMenu.disabledWhileImporting") : ""}>
        <span>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            disabled={upload.isBusy || isImporting}
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            {upload.uploading ? t("uploadBar.uploading") : t("common:add")}
          </Button>
        </span>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={handleUpload}>
          <ListItemIcon>
            <UploadFileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("addMenu.uploadFiles")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleFolderUpload}>
          <ListItemIcon>
            <DriveFolderUploadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("addMenu.uploadFolder")}</ListItemText>
        </MenuItem>
        {/* Nothing to import from with every provider turned off. */}
        {!allProvidersOff(disabledProviders) && (
          <MenuItem onClick={() => openImport()}>
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("common:import")}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Dialog open={importOpen} onClose={closeImport} fullWidth maxWidth="sm">
        <DialogTitle>{t("addMenu.importTitle")}</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            {IMPORT_PROVIDERS.filter((key) => !disabledProviders.has(key)).map((key) => {
              const info = IMPORT_PROVIDER_INFO[key];
              const active = detectedProviders.has(key);
              return (
                <Chip
                  key={key}
                  label={info.label}
                  size="small"
                  onClick={() => setExampleProvider((prev) => (prev === key ? null : key))}
                  sx={{
                    fontWeight: 600,
                    bgcolor: active ? info.color : "action.disabledBackground",
                    color: active ? (info.textColor ?? "#fff") : "text.disabled",
                  }}
                />
              );
            })}
          </Stack>

          {exampleProvider && (
            <Alert severity="info" sx={{ mb: 1.5 }} onClose={() => setExampleProvider(null)}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t("addMenu.exampleLinksFor", { provider: IMPORT_PROVIDER_INFO[exampleProvider].label })}
              </Typography>
              <Typography variant="caption" component="div" sx={{ wordBreak: "break-all" }}>
                {t("addMenu.exampleModel")}: {IMPORT_LINK_EXAMPLES[exampleProvider].model}
              </Typography>
              <Typography variant="caption" component="div" sx={{ wordBreak: "break-all" }}>
                {t("addMenu.exampleCollection")}: {IMPORT_LINK_EXAMPLES[exampleProvider].collection}
                {exampleProvider === "makerworld" && ` (${t("addMenu.makerworldCollectionExtensionOnly")})`}
              </Typography>
            </Alert>
          )}

          {isBlockedCollection && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              {t(isBatch ? "addMenu.batchCollectionsBlocked" : "addMenu.makerworldCollectionBlocked")}
            </Alert>
          )}

          <TextField
            fullWidth
            multiline
            minRows={2}
            margin="dense"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitImport();
              }
            }}
            placeholder={t("addMenu.linksPlaceholder") ?? undefined}
            disabled={upload.importing}
          />
          {isBatch && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              {t("addMenu.linksDetected", { count: links.length })}
            </Typography>
          )}
          {isMakerworldModel && (
            <TextField
              select
              fullWidth
              size="small"
              margin="dense"
              label={t("addMenu.profilesLabel")}
              value={profileScope}
              onChange={(e) => setProfileScope(e.target.value as MakerworldProfileScope)}
              disabled={upload.importing}
              helperText={profileScope === "url" ? t("addMenu.profilesHelpUrl") : t("addMenu.profilesHelpMany")}
              sx={{ mt: 1.5 }}
            >
              <MenuItem value="url">{t("addMenu.profilesUrl")}</MenuItem>
              <MenuItem value="designer">{t("addMenu.profilesDesigner")}</MenuItem>
              <MenuItem value="all">{t("addMenu.profilesAll")}</MenuItem>
            </TextField>
          )}
          {needsCaptcha && (
            <Box sx={{ mt: 2 }}>
              <CaptchaField onChange={setCaptcha} disabled={upload.importing} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeImport} disabled={upload.importing}>
            {t("common:cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={submitImport}
            disabled={
              upload.importing ||
              !links.length ||
              isBlockedCollection ||
              (needsCaptcha && !captcha?.captcha_answer.trim())
            }
            startIcon={upload.importing ? <CircularProgress size={14} /> : undefined}
          >
            {upload.importing ? t("uploadBar.importing") : t("common:import")}
          </Button>
        </DialogActions>
      </Dialog>

      {upload.modals}
    </>
  );
});

export default AddMenu;
