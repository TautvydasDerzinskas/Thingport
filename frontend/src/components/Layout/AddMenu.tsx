import Box from "@mui/material/Box";
import type { CaptchaAnswer } from "../../api/captcha";
import CaptchaField from "../CaptchaField";
import { useCaptchaSettings } from "../../hooks/useCaptchaSettings";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
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
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import BookmarkletGuideDialog from "../BookmarkletGuideDialog";
import { useUploadImport } from "../uploads/useUploadImport";
import { AddModelIcon, ImportLinkIcon, topBarButtonSx, UploadFilesIcon, UploadFolderIcon } from "./topBarIcons";
import { useToast } from "../ToastProvider";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import { COMING_SOON_PROVIDERS, ProviderLogo } from "./ConfigurationDialog/providerLogos";
import {
  detectImportProvider,
  hasPrintProfiles,
  isGrabOnlyList,
  listLinkOf,
  type ImportProviderKey,
} from "../../utils/importLinkDetection";
import type { MakerworldProfileScope } from "../../api/imports";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useProviders";
import { readImportLink } from "../../utils/bookmarklet";
import { MANIFESTS, manifestOf, PROVIDER_IDS } from "../../providers/index.generated";

const IMPORT_PROVIDERS: readonly ImportProviderKey[] = PROVIDER_IDS;

/** What the search palette's !import command calls. */
export type AddMenuHandle = {
  /** No link opens the import dialog. A supported link goes straight to the queue, unless something
   *  needs the dialog first (a captcha, a blocked or invalid link, several links), when it opens
   *  filled in with it. */
  importFromCommand: (link?: string) => void;
};

type Props = {
  categoryId?: string | null;
  onUploaded: () => void;
  onUnauthorized?: () => void;
};

/** The top bar's Add button. Lists of a provider that imports them through Thingport Grab only are blocked here. */
const AddMenu = React.forwardRef<AddMenuHandle, Props>(function AddMenu(
  { categoryId, onUploaded, onUnauthorized },
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
  const [bookmarkletGuideOpen, setBookmarkletGuideOpen] = React.useState(false);
  const upload = useUploadImport({
    categoryId,
    onUploaded,
    onUnauthorized,
    onTryAgain: (retryLinks, scope) => openImport(retryLinks, scope),
  });
  const captchaSettings = useCaptchaSettings();
  const [captcha, setCaptcha] = React.useState<CaptchaAnswer | null>(null);
  const needsCaptcha = Boolean(captchaSettings?.import);

  // A pasted block of links becomes one queue job; a single link keeps the existing flows
  // (collection pickers, zip inspection).
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
  const isBlockedCollection = isBatch ? links.some((link) => !!listLinkOf(link)) : isGrabOnlyList(linkValue);
  // Models with print profiles to pick between.
  const hasProfiles = links.some(hasPrintProfiles);

  const closeMenu = () => setAnchorEl(null);

  const handleUpload = () => {
    closeMenu();
    upload.triggerUpload();
  };

  const handleFolderUpload = () => {
    closeMenu();
    upload.triggerFolderUpload();
  };

  const openImport = (prefill = "", scope: MakerworldProfileScope = "url") => {
    closeMenu();
    setLinkValue(prefill);
    setExampleProvider(null);
    setProfileScope(scope);
    setImportOpen(true);
  };

  React.useImperativeHandle(ref, () => ({
    importFromCommand: (link) => {
      // The same rule as the Add button, which is disabled meanwhile.
      if (upload.isBusy) {
        showToast({ message: t("addMenu.finishFirst"), severity: "info" });
        return;
      }
      const url = link?.trim() ?? "";
      const direct = url && !/\s/.test(url) && detectImportProvider(url) && !isGrabOnlyList(url) && !needsCaptcha;
      if (direct) void upload.submitImport(url);
      else openImport(url);
    },
  }));

  // The bookmarklet's /import?url=: the dialog opens filled in, so the import is one click away.
  const location = useLocation();
  const navigate = useNavigate();
  React.useEffect(() => {
    const link = readImportLink(location.pathname, location.search);
    if (link === null) return;
    navigate("/", { replace: true });
    if (upload.isBusy) showToast({ message: t("addMenu.finishFirst"), severity: "info" });
    else openImport(link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const closeImport = () => {
    setImportOpen(false);
    // Each captcha works once; reopening shows a fresh one.
    setCaptcha(null);
  };

  /** Closes first: what's submitted goes on in the background, and says how it went in a toast. */
  const submitImport = () => {
    // Its button stays pressable while the dialog fades out.
    if (!importOpen) return;
    if (!links.length || isBlockedCollection) return;
    if (needsCaptcha && !captcha?.captcha_answer.trim()) return;
    const answer = needsCaptcha ? captcha : null;
    const scope = hasProfiles ? profileScope : "url";
    closeImport();
    if (isBatch) void upload.submitImportMany(links, answer, scope);
    else void upload.submitImport(linkValue, answer, scope);
  };

  const addLabel = upload.uploading ? t("uploadBar.uploading") : t("common:add");
  const canImport = !allProvidersOff(disabledProviders);

  return (
    <>
      {upload.fileInput}
      {upload.folderInput}
      <Tooltip title={addLabel}>
        <span>
          <IconButton
            size="small"
            aria-label={addLabel}
            disabled={upload.isBusy}
            onClick={(e) => setAnchorEl(e.currentTarget)}
            sx={{ ...topBarButtonSx, "&.Mui-disabled svg": { opacity: 0.45 } }}
          >
            {upload.uploading || upload.submitting ? <CircularProgress size={18} /> : <AddModelIcon />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 0.75 } } }}
      >
        {/* Nothing to import from with every provider turned off. */}
        {canImport && (
          <MenuItem onClick={() => openImport()}>
            <ListItemIcon>
              <ImportLinkIcon />
            </ListItemIcon>
            <ListItemText>{t("common:import")}</ListItemText>
          </MenuItem>
        )}
        {canImport && <Divider />}
        <MenuItem onClick={handleUpload}>
          <ListItemIcon>
            <UploadFilesIcon />
          </ListItemIcon>
          <ListItemText>{t("addMenu.uploadFiles")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleFolderUpload}>
          <ListItemIcon>
            <UploadFolderIcon />
          </ListItemIcon>
          <ListItemText>{t("addMenu.uploadFolder")}</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={importOpen} onClose={closeImport} fullWidth maxWidth="sm">
        <DialogTitle>{t("addMenu.importTitle")}</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={0.5} sx={{ mb: 1.5, flexWrap: "wrap" }}>
            {IMPORT_PROVIDERS.filter((key) => !disabledProviders.has(key)).map((key) => {
              const label = IMPORT_PROVIDER_INFO[key].label;
              // Lit when a pasted link is from it, or its example links are open.
              const lit = detectedProviders.has(key) || exampleProvider === key;
              return (
                <Tooltip key={key} title={label}>
                  <IconButton
                    size="small"
                    aria-label={label}
                    aria-pressed={exampleProvider === key}
                    onClick={() => setExampleProvider((prev) => (prev === key ? null : key))}
                    sx={{
                      p: 0.75,
                      "& svg": {
                        filter: lit ? "none" : "grayscale(1)",
                        opacity: lit ? 1 : 0.45,
                        transform: lit ? "scale(1.1)" : "none",
                        transition: "filter 150ms, opacity 150ms, transform 150ms",
                        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                      },
                      "&:hover svg, &:focus-visible svg": { filter: "none", opacity: 1 },
                    }}
                  >
                    <ProviderLogo id={key} size={22} />
                  </IconButton>
                </Tooltip>
              );
            })}
            {COMING_SOON_PROVIDERS.map(({ id, name }) => {
              const label = `${name}: ${t("providers.comingSoon")}`;
              return (
                <Tooltip key={id} title={label}>
                  {/* aria-disabled rather than disabled, so hover and focus still show the tooltip. */}
                  <IconButton
                    size="small"
                    aria-label={label}
                    aria-disabled="true"
                    disableRipple
                    sx={{
                      p: 0.75,
                      cursor: "default",
                      "&:hover": { bgcolor: "transparent" },
                      "& svg": { filter: "grayscale(1)", opacity: 0.2 },
                    }}
                  >
                    <ProviderLogo id={id} size={22} />
                  </IconButton>
                </Tooltip>
              );
            })}
          </Stack>

          {exampleProvider && (
            <Alert severity="info" sx={{ mb: 1.5 }} onClose={() => setExampleProvider(null)}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t("addMenu.exampleLinksFor", { provider: IMPORT_PROVIDER_INFO[exampleProvider].label })}
              </Typography>
              <Typography variant="caption" component="div" sx={{ wordBreak: "break-all" }}>
                {t("addMenu.exampleModel")}: {MANIFESTS[exampleProvider].examples.model}
              </Typography>
              <Typography variant="caption" component="div" sx={{ wordBreak: "break-all" }}>
                {t("addMenu.exampleCollection")}: {MANIFESTS[exampleProvider].examples.list}
                {manifestOf(exampleProvider).capabilities.listImport === "grab" &&
                  ` (${t("addMenu.makerworldCollectionExtensionOnly")})`}
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
          />
          {isBatch && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              {t("addMenu.linksDetected", { count: links.length })}
            </Typography>
          )}
          {hasProfiles && (
            <TextField
              select
              fullWidth
              size="small"
              margin="dense"
              label={t("addMenu.profilesLabel")}
              value={profileScope}
              onChange={(e) => setProfileScope(e.target.value as MakerworldProfileScope)}
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
              <CaptchaField onChange={setCaptcha} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            size="small"
            startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
            onClick={() => setBookmarkletGuideOpen(true)}
            sx={{ mr: "auto" }}
          >
            {t("bookmarklet.guide.open")}
          </Button>
          <Button onClick={closeImport}>{t("common:cancel")}</Button>
          <Button
            variant="contained"
            onClick={submitImport}
            disabled={!links.length || isBlockedCollection || (needsCaptcha && !captcha?.captcha_answer.trim())}
          >
            {t("common:import")}
          </Button>
        </DialogActions>
      </Dialog>

      <BookmarkletGuideDialog
        open={bookmarkletGuideOpen}
        onClose={() => setBookmarkletGuideOpen(false)}
        onGetExtension={() => {
          setBookmarkletGuideOpen(false);
          closeImport();
          navigate("/downloads");
        }}
      />
      {upload.modals}
    </>
  );
});

export default AddMenu;
