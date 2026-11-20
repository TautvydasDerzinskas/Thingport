import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DownloadIcon from "@mui/icons-material/Download";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AutoFixNormalIcon from "@mui/icons-material/AutoFixNormal";
import LaunchIcon from "@mui/icons-material/Launch";
import AddLinkIcon from "@mui/icons-material/AddLink";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import type { SxProps, Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import { type Print, type PrintFile, PrintApiError, printsApi } from "../../api/prints";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { aiDescriptionsApi } from "../../api/aiDescriptions";
import { useToast } from "../../components/ToastProvider";
import type { AuthUser } from "../../api/auth";
import { collectionsApi } from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import { importProviderInfo } from "../../constants/importProviders";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useProviders";
import LinkSourceDialog from "../../components/linkSource/LinkSourceDialog";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import { useOpenInStudio } from "./useOpenInStudio";
import StudioFileMenu from "./StudioFileMenu";
import SlicerFileMenu, { type MenuAnchor } from "./SlicerFileMenu";
import AdaptedInfoIcon from "./AdaptedInfoIcon";
import { useAdaptedOpen } from "./useAdaptedOpen";
import DownloadPickerDialog, { type SupportingFilesState } from "./DownloadPickerDialog";
import AddToCollectionModal from "./AddToCollectionModal";
import EditModelModal from "./EditModelModal";
import FillGapsDialog from "./FillGapsDialog";
import { useAiOutcomeWatch } from "./useAiOutcomeWatch";
import { useCustomize } from "./useCustomize";
import { useCopyToLibrary } from "./useCopyToLibrary";
import { useSupportingFiles } from "../../components/supportingFiles/useSupportingFiles";
import { reopenContextMenuBelow } from "../../components/Layout/ConfigurationDialog/AppTiles";

type Props = {
  print: Print;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  onUpdated?: (print: Print) => void;
  /** A download's count, for the owner of the model's state to put in (useDownloadPrint). */
  onCounted?: (printId: string, printCount: number) => void;
  /** Only for a real collection; shows "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  onCollectionCountChange?: (count: number) => void;
  triggerSx?: SxProps<Theme>;
  /** Glyph size in px; defaults to fontSize="small". */
  iconFontSize?: number;
  viewer?: AuthUser | null;
  /** Opens the menu at this point instead of at the trigger, as on a right-click. */
  contextMenuAt?: { top: number; left: number } | null;
  onContextMenuClose?: () => void;
  /** Offers linking a model with no source to its page on a provider. */
  offerLink?: boolean;
  /** "Add supporting files" through the page's own, so its uploads show there; a card's menu adds them itself. */
  onAddSupportingFiles?: () => void;
};

/** The "..." menu for a model, shared by the detail header and grid cards. */
export default function ModelActionsMenu({
  print,
  onUnauthorized,
  onDeleted,
  onUpdated,
  onCounted,
  collectionId,
  onRemovedFromCollection,
  onCollectionCountChange,
  triggerSx,
  iconFontSize,
  viewer,
  contextMenuAt,
  onContextMenuClose,
  offerLink = false,
  onAddSupportingFiles,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const toolOwned = Boolean(print.tool_id);
  // Another user's model, from one of their public collections: everything that uses it, nothing that changes it.
  const owner = print.owner ?? null;
  const disabledProviders = useDisabledProviders();
  const canLink = offerLink && !owner && !print.source_provider && !toolOwned && !allProvidersOff(disabledProviders);
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [descriptionsEnabled, setDescriptionsEnabled] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  const [improving, setImproving] = useState(false);
  useEffect(() => {
    let active = true;
    void aiCategorizationApi
      .status()
      .then((status) => {
        if (active) setAiEnabled(status.enabled);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    void aiDescriptionsApi
      .status()
      .then((status) => {
        if (active) setDescriptionsEnabled(status.enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onUnauthorized]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [slicerMenuAnchor, setSlicerMenuAnchor] = useState<MenuAnchor>(null);
  const [adaptedMenuAnchor, setAdaptedMenuAnchor] = useState<MenuAnchor>(null);
  const [studioMenuAnchor, setStudioMenuAnchor] = useState<MenuAnchor>(null);
  const [deleting, setDeleting] = useState(false);
  const [removingFromCollection, setRemovingFromCollection] = useState(false);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [fillGapsOpen, setFillGapsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const sourceGaps = print.source_gaps ?? [];
  // Driven by ?edit=<id> so links and the back button open/close it.
  const editOpen = searchParams.get("edit") === print.id;
  const {
    pickerOpen,
    setPickerOpen,
    downloading,
    handleDownload,
    downloadPlate,
    downloadAllZip,
    sortedPlates,
    recordUse,
  } = useDownloadPrint(print, onUnauthorized, onUpdated, onCounted);

  // A point rather than anchorPosition, so the slicer pickers this menu hands over to open in the same place.
  const menuAnchor: MenuAnchor =
    anchorEl ??
    (contextMenuAt
      ? { nodeType: 1, getBoundingClientRect: () => new DOMRect(contextMenuAt.left, contextMenuAt.top, 0, 0) }
      : null);

  const closeMenu = () => {
    setAnchorEl(null);
    onContextMenuClose?.();
  };

  // A card's model has only how many supporting files it holds: the picker reads them when it opens. They're kept with
  // the model they're of, as the page header keeps this menu across models, and shown only while it has some. Null
  // files: the read failed, which the picker says, with a retry.
  const [readSupporting, setReadSupporting] = useState<{ printId: string; files: PrintFile[] | null } | null>(null);
  // Only the newest read lands, a retry's too: one for a model the menu has since left would put that model's answer
  // in place of this one's.
  const latestSupportingRead = useRef(0);
  // Taken when an answer lands, so a new function from the page doesn't read the files again.
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  });
  const readSupportingFiles = useCallback((printId: string) => {
    const read = ++latestSupportingRead.current;
    printsApi.listFiles(printId).then(
      (files) => {
        if (read === latestSupportingRead.current) setReadSupporting({ printId, files });
      },
      (err: unknown) => {
        if (read !== latestSupportingRead.current) return;
        // A session that ended goes where the app renews it or signs in again; still said as failed, with a retry, in
        // case the server couldn't be reached to renew it.
        if (err instanceof UnauthorizedError) unauthorized.current?.();
        setReadSupporting({ printId, files: null });
      },
    );
  }, []);
  useEffect(() => {
    if (!pickerOpen || print.supporting_files || !print.supporting_file_count) return;
    readSupportingFiles(print.id);
    return () => {
      latestSupportingRead.current += 1;
      // Each opening reads them afresh, and shows them loading till then: the list the last one read may be gone.
      setReadSupporting(null);
    };
  }, [pickerOpen, print.id, print.supporting_files, print.supporting_file_count, readSupportingFiles]);
  const supportingRead =
    !print.supporting_files && print.supporting_file_count && readSupporting?.printId === print.id
      ? readSupporting
      : null;
  const supportingFiles = print.supporting_files ?? supportingRead?.files ?? undefined;
  const supportingState: SupportingFilesState | undefined =
    print.supporting_files || !print.supporting_file_count
      ? undefined
      : !supportingRead
        ? "loading"
        : supportingRead.files === null
          ? "failed"
          : undefined;
  const retrySupporting = () => {
    setReadSupporting(null);
    readSupportingFiles(print.id);
  };

  const customize = useCustomize(print, closeMenu, onUnauthorized);
  const studio = useOpenInStudio(print, onUnauthorized);
  const library = useCopyToLibrary(print, onUnauthorized, onUpdated);
  const libraryCopyId = print.library_copy_id ?? null;

  const openEdit = () => {
    closeMenu();
    navigate(`/models/${print.id}?edit=${print.id}`);
  };

  const closeEdit = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const onDownloadClick = () => {
    closeMenu();
    handleDownload();
  };

  const handleRemoveFromCollection = async () => {
    closeMenu();
    if (!collectionId) return;
    const confirmed = await confirmDialog({
      message: t("models:detail.confirmRemoveFromCollection", { name: print.title || print.name }),
      confirmLabel: t("common:remove"),
    });
    if (!confirmed) return;
    setRemovingFromCollection(true);
    try {
      await collectionsApi.removeItem(collectionId, print.id);
      onRemovedFromCollection?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:detail.removeFromCollectionFailed"));
    } finally {
      setRemovingFromCollection(false);
    }
  };

  const handleDelete = async () => {
    closeMenu();
    const confirmed = await confirmDialog({
      message: t("models:detail.confirmDelete", { name: print.title || print.name }),
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await printsApi.delete(print.id);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      alert(t("models:detail.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  // A model in a folder has no category yet as far as AI is concerned; categorizing it moves it out.
  const uncategorized = !print.category_id || print.category_kind === "folder";
  const queueWatched = useAiOutcomeWatch(print.id, onUpdated);
  const recategorize = async (force = false) => {
    closeMenu();
    setRecategorizing(true);
    try {
      await queueWatched(() => printsApi.recategorize(print.id, force));
      showToast({ message: t("models:aiCategorization.queued") });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof PrintApiError && err.code === "manual_category" && !force) {
        const confirmed = await confirmDialog({
          message: t("models:aiCategorization.confirmManual", { name: print.title || print.name }),
          confirmLabel: t("models:aiCategorization.recategorize"),
        });
        if (confirmed) await recategorize(true);
      } else {
        showToast({
          message: err instanceof Error ? err.message : t("models:aiCategorization.failed"),
          severity: "error",
        });
      }
    } finally {
      setRecategorizing(false);
    }
  };

  // A description streams for as long as the model keeps writing; on a CPU that's minutes.
  const queueDescription = useAiOutcomeWatch(print.id, onUpdated, 60 * 60_000);
  const improveDescription = async () => {
    closeMenu();
    setImproving(true);
    try {
      await queueDescription(() => aiDescriptionsApi.improve(print.id).then(() => undefined));
      showToast({ message: t("models:aiDescriptions.queued") });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else
        showToast({
          message: err instanceof Error ? err.message : t("models:aiDescriptions.failed"),
          severity: "error",
        });
    } finally {
      setImproving(false);
    }
  };

  const providerInfo = importProviderInfo(print.source_provider);
  const { slicerOption, targets: slicerTargets, adaptedTargets } = useOpenInSlicer(print);
  const openInSlicerHref = slicerTargets.length === 1 ? slicerTargets[0].href : undefined;
  const adapted = useAdaptedOpen(print.id, slicerOption?.id ?? null, recordUse, onUnauthorized);
  // Only where the page has none of its own to hand the picking to.
  const {
    pick: pickOwnSupporting,
    bindInput: bindOwnSupportingInput,
    onPicked: onOwnSupportingPicked,
    download: downloadSupportingFile,
  } = useSupportingFiles(onAddSupportingFiles ? undefined : print.id, onUpdated, onUnauthorized);
  const addSupportingFiles = onAddSupportingFiles ?? pickOwnSupporting;
  // Busy like the picker's other downloads, so a second click doesn't start another: by the model it's of, as theirs
  // (useDownloadPrint), so one still on its way after the header's menu has moved on doesn't hold the next model's.
  const [supportingBusy, setSupportingBusy] = useState<readonly string[]>([]);
  const downloadingSupporting = supportingBusy.includes(print.id);
  const downloadSupporting = async (file: PrintFile) => {
    const id = print.id;
    setSupportingBusy((ids) => [...ids, id]);
    try {
      await downloadSupportingFile(file);
    } finally {
      setSupportingBusy((ids) => {
        const at = ids.indexOf(id);
        return at < 0 ? ids : ids.toSpliced(at, 1);
      });
    }
  };
  const adaptedMenuLabel = (slicer: string) => {
    const state = adaptedTargets.length === 1 ? adapted.stateOf(adaptedTargets[0]) : "idle";
    if (state === "preparing") return t("models:detail.adaptPreparing");
    if (state === "ready") return t("models:detail.adaptReady", { slicer });
    return t("models:detail.openAdaptedInSlicer", { slicer });
  };

  return (
    <>
      {!onAddSupportingFiles && (
        <input
          ref={bindOwnSupportingInput}
          type="file"
          multiple
          hidden
          onChange={(event) => onOwnSupportingPicked(event.currentTarget)}
        />
      )}
      <Tooltip title={t("common:moreActions")}>
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={t("common:moreActions") ?? undefined}
            disabled={deleting || removingFromCollection}
            sx={triggerSx}
          >
            {deleting || removingFromCollection ? (
              <CircularProgress size={18} />
            ) : iconFontSize ? (
              <MoreVertIcon sx={{ fontSize: iconFontSize }} />
            ) : (
              <MoreVertIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        onContextMenu={(event) => reopenContextMenuBelow(event, closeMenu)}
      >
        <MenuItem
          onClick={() => {
            closeMenu();
            setAddToCollectionOpen(true);
          }}
        >
          <ListItemIcon>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:detail.addToCollection")}</ListItemText>
        </MenuItem>
        {collectionId && (
          <MenuItem onClick={handleRemoveFromCollection}>
            <ListItemIcon>
              <PlaylistRemoveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.removeFromCollection")}</ListItemText>
          </MenuItem>
        )}
        {owner &&
          (libraryCopyId ? (
            <MenuItem
              onClick={() => {
                closeMenu();
                library.openCopy(libraryCopyId);
              }}
            >
              <ListItemIcon>
                <LibraryAddCheckOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("models:shared.openCopy")}</ListItemText>
            </MenuItem>
          ) : (
            <MenuItem
              disabled={library.copying}
              onClick={() => {
                closeMenu();
                void library.copy();
              }}
            >
              <ListItemIcon>
                {library.copying ? <CircularProgress size={18} /> : <LibraryAddOutlinedIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText>{t("models:shared.copy")}</ListItemText>
            </MenuItem>
          ))}
        <MenuItem onClick={onDownloadClick} disabled={downloading}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("common:download")}</ListItemText>
        </MenuItem>
        {customize.item}
        {owner ? null : toolOwned ? (
          // Kept as the tool needs it: it goes when the tool is uninstalled.
          <MenuItem disabled>
            <ListItemIcon>
              <HandymanOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText secondary={t("models:detail.toolOwnedHint")}>{t("models:detail.toolOwned")}</ListItemText>
          </MenuItem>
        ) : (
          [
            <MenuItem key="edit" onClick={openEdit}>
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("common:edit")}</ListItemText>
            </MenuItem>,
            <MenuItem
              key="supporting"
              onClick={() => {
                closeMenu();
                addSupportingFiles();
              }}
            >
              <ListItemIcon>
                <AttachFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("models:supporting.addMenu")}</ListItemText>
            </MenuItem>,
            <MenuItem key="delete" onClick={handleDelete}>
              <ListItemIcon>
                <DeleteIcon fontSize="small" color="error" />
              </ListItemIcon>
              <ListItemText sx={{ color: "error.main" }}>{t("common:delete")}</ListItemText>
            </MenuItem>,
          ]
        )}
        {aiEnabled && !toolOwned && !owner && (
          // One suggestion at a time: the next waits until this one is accepted or rejected.
          <MenuItem onClick={() => void recategorize()} disabled={recategorizing || Boolean(print.ai_suggestion)}>
            <ListItemIcon>
              {recategorizing ? <CircularProgress size={18} /> : <AutoAwesomeIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText secondary={print.ai_suggestion ? t("models:aiCategorization.suggestionPending") : undefined}>
              {t(uncategorized ? "models:aiCategorization.categorize" : "models:aiCategorization.recategorize")}
            </ListItemText>
          </MenuItem>
        )}
        {descriptionsEnabled && !toolOwned && !owner && (
          <MenuItem
            onClick={() => void improveDescription()}
            disabled={improving || Boolean(print.ai_description_pending)}
          >
            <ListItemIcon>
              {improving ? <CircularProgress size={18} /> : <AutoFixNormalIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText
              secondary={print.ai_description_pending ? t("models:aiDescriptions.suggestionPending") : undefined}
            >
              {t("models:aiDescriptions.improve")}
            </ListItemText>
          </MenuItem>
        )}
        <Divider />
        {/* One target: a plain link to it. Several: this menu hands over to SlicerFileMenu,
            anchored on the same trigger, to pick which. */}
        <MenuItem
          component="a"
          href={openInSlicerHref}
          onClick={() => {
            if (slicerTargets.length > 1) {
              setSlicerMenuAnchor(menuAnchor);
              closeMenu();
              return;
            }
            closeMenu();
            recordUse();
          }}
          disabled={slicerTargets.length === 0}
        >
          <ListItemIcon>
            <LaunchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {slicerOption
              ? t("models:detail.openInSlicer", { slicer: slicerOption.label })
              : t("models:detail.openInSlicerGeneric")}
          </ListItemText>
        </MenuItem>
        {slicerOption && adaptedTargets.length > 0 && (
          <MenuItem
            disabled={adaptedTargets.length === 1 && adapted.stateOf(adaptedTargets[0]) === "preparing"}
            onClick={() => {
              if (adaptedTargets.length > 1) {
                setAdaptedMenuAnchor(menuAnchor);
                closeMenu();
                return;
              }
              // Stays open while preparing, so the item can show progress and then "ready".
              void adapted.open(adaptedTargets[0]).then((launched) => launched && closeMenu());
            }}
            sx={{ color: "warning.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              {adaptedTargets.length === 1 && adapted.stateOf(adaptedTargets[0]) === "preparing" ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <AdaptedInfoIcon slicerLabel={slicerOption.label} plan={adaptedTargets[0].plan} />
              )}
            </ListItemIcon>
            <ListItemText>{adaptedMenuLabel(slicerOption.label)}</ListItemText>
          </MenuItem>
        )}
        {studio.files.length > 0 && (
          // One file opens straight away; several hand over to a picker, as the slicer's do.
          <MenuItem
            disabled={studio.opening}
            onClick={() => {
              if (studio.files.length > 1) {
                setStudioMenuAnchor(menuAnchor);
                closeMenu();
                return;
              }
              closeMenu();
              void studio.open(studio.files[0]);
            }}
          >
            <ListItemIcon>
              {studio.opening ? <CircularProgress size={18} /> : <DesignServicesOutlinedIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{t("models:detail.openInStudio")}</ListItemText>
          </MenuItem>
        )}
        {canLink && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setLinkOpen(true);
            }}
          >
            <ListItemIcon>
              <AddLinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:linkSource.action")}</ListItemText>
          </MenuItem>
        )}
        {providerInfo && print.source_url && (
          <MenuItem component="a" href={print.source_url} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
            <ListItemIcon>
              <OpenInNewIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.openInProvider", { provider: providerInfo.label })}</ListItemText>
          </MenuItem>
        )}
        {owner && (
          <MenuItem
            onClick={() => {
              closeMenu();
              navigate(`/explore/users/${owner.id}`);
            }}
          >
            <ListItemIcon>
              <PersonOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:shared.moreFrom", { name: owner.display_name })}</ListItemText>
          </MenuItem>
        )}
        {providerInfo && print.source_url && sourceGaps.length > 0 && !toolOwned && !owner && (
          <MenuItem
            onClick={() => {
              closeMenu();
              setFillGapsOpen(true);
            }}
          >
            <ListItemIcon>
              <AutoFixHighIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("models:detail.fillGaps", { provider: providerInfo.label })}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {slicerOption && adaptedTargets.length > 1 && (
        <SlicerFileMenu
          anchorEl={adaptedMenuAnchor}
          onClose={() => setAdaptedMenuAnchor(null)}
          slicerLabel={slicerOption.label}
          title={t("models:detail.openAdaptedInSlicer", { slicer: slicerOption.label })}
          targets={adaptedTargets}
          onOpen={recordUse}
          adapted={adapted}
        />
      )}
      {adapted.dialog}
      {slicerOption && slicerTargets.length > 1 && (
        <SlicerFileMenu
          anchorEl={slicerMenuAnchor}
          onClose={() => setSlicerMenuAnchor(null)}
          slicerLabel={slicerOption.label}
          targets={slicerTargets}
          onOpen={recordUse}
        />
      )}

      <StudioFileMenu
        anchorEl={studioMenuAnchor}
        onClose={() => setStudioMenuAnchor(null)}
        files={studio.files}
        onOpen={(plate) => void studio.open(plate)}
      />

      {customize.window}

      <DownloadPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        downloading={downloading || downloadingSupporting}
        sortedPlates={sortedPlates}
        supportingCount={print.supporting_file_count}
        supportingFiles={supportingFiles}
        supportingState={supportingState}
        onRetrySupporting={retrySupporting}
        downloadSupporting={(file) => void downloadSupporting(file)}
        downloadAllZip={() => void downloadAllZip()}
        downloadFolderZip={(folder) => void downloadAllZip(folder)}
        downloadPlate={downloadPlate}
      />

      {/* The page header keeps this menu across models: a write on its way mustn't land on the next one's list. */}
      <AddToCollectionModal
        key={print.id}
        open={addToCollectionOpen}
        onClose={() => setAddToCollectionOpen(false)}
        printId={print.id}
        onUnauthorized={onUnauthorized}
        collectionId={collectionId}
        onRemovedFromCollection={onRemovedFromCollection}
        onCountChange={onCollectionCountChange}
      />

      {editOpen && !owner && (
        <EditModelModal
          print={print}
          onClose={closeEdit}
          onUnauthorized={onUnauthorized}
          onUpdated={(updated) => onUpdated?.(updated)}
          viewer={viewer}
        />
      )}

      {fillGapsOpen && (
        <FillGapsDialog
          open
          print={print}
          gaps={sourceGaps}
          onClose={() => setFillGapsOpen(false)}
          onUpdated={(updated) => onUpdated?.(updated)}
          onUnauthorized={onUnauthorized}
        />
      )}

      {linkOpen && (
        <LinkSourceDialog
          print={print}
          onClose={() => setLinkOpen(false)}
          onLinked={(updated) => onUpdated?.(updated)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}
