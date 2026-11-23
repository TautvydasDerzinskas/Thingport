import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import AddLinkIcon from "@mui/icons-material/AddLink";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AutoFixNormalIcon from "@mui/icons-material/AutoFixNormal";
import DeleteIcon from "@mui/icons-material/Delete";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import PrintIcon from "@mui/icons-material/Print";
import TuneIcon from "@mui/icons-material/Tune";
import { UnauthorizedError } from "../../api/client";
import { type Print, PrintApiError, printsApi } from "../../api/prints";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { aiDescriptionsApi } from "../../api/aiDescriptions";
import type { AuthUser } from "../../api/auth";
import { collectionsApi } from "../../api/collections";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import LinkSourceDialog from "../../components/linkSource/LinkSourceDialog";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import type { MenuPick } from "../../components/menus/menuAction";
import { importProviderInfo } from "../../constants/importProviders";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useProviders";
import { folderLabel, shortNames } from "../../utils/fileFolders";
import { adaptedInfo } from "./AdaptedInfoIcon";
import AddToCollectionModal from "./AddToCollectionModal";
import DownloadPickerDialog from "./DownloadPickerDialog";
import EditModelModal from "./EditModelModal";
import FillGapsDialog from "./FillGapsDialog";
import { fileRowText } from "./fileRowText";
import type { ModelAction } from "./modelMenuLayout";
import { useAdaptedOpen } from "./useAdaptedOpen";
import { useAiOutcomeWatch } from "./useAiOutcomeWatch";
import { useCopyToLibrary } from "./useCopyToLibrary";
import { useCustomize } from "./useCustomize";
import { useDownloadPrint } from "./useDownloadPrint";
import { type AdaptedTarget, type SlicerTarget, useOpenInSlicer } from "./useOpenInSlicer";
import { useOpenInStudio } from "./useOpenInStudio";

export type ModelActionsOptions = {
  print: Print;
  onUnauthorized?: () => void;
  onDeleted: () => void;
  onUpdated?: (print: Print) => void;
  /** Only for a real collection; adds "Remove from collection". */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  onCollectionCountChange?: (count: number, printId: string) => void;
  viewer?: AuthUser | null;
  /** Offers linking a model with no source to its page on a provider. */
  offerLink?: boolean;
  /** Closes the menu, for an action that leaves it open while it works. */
  closeMenu: () => void;
};

const THUMB = 28;

type DialogName = "collection" | "fillGaps" | "link";

/** Where a pick has no plate of its own (the prepared print file): a glyph the thumbnail's size. */
function printGlyph() {
  return (
    <Box
      sx={{ width: THUMB, height: THUMB, display: "grid", placeItems: "center", flexShrink: 0, color: "action.active" }}
    >
      <PrintIcon fontSize="small" />
    </Box>
  );
}

/**
 * Everything a model's "⋯" menu offers, as actions for TileMenu or NestedMenu to lay out, in the order they read
 * best in a plain list. Owns what they open (dialogs and the customizer), which live outside the menu: it unmounts
 * its contents as it closes. `working` is a delete or removal on its way, which the trigger shows.
 */
export function useModelActions({
  print,
  onUnauthorized,
  onDeleted,
  onUpdated,
  collectionId,
  onRemovedFromCollection,
  onCollectionCountChange,
  viewer,
  offerLink = false,
  closeMenu,
}: ModelActionsOptions): { actions: ModelAction[]; dialogs: ReactNode; working: boolean } {
  const { t } = useTranslation(["models", "common"]);
  const toolOwned = Boolean(print.tool_id);
  // Another user's model, from one of their public collections: everything that uses it, nothing that changes it.
  const owner = print.owner ?? null;
  const disabledProviders = useDisabledProviders();
  const canLink = offerLink && !owner && !print.source_provider && !toolOwned && !allProvidersOff(disabledProviders);
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [descriptionsEnabled, setDescriptionsEnabled] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  const [improving, setImproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removingFromCollection, setRemovingFromCollection] = useState(false);
  // The page header keeps this menu across models, so a dialog is open for the model it was opened on, and closed on
  // leaving that model so coming back to it doesn't open it again.
  const [dialog, setDialog] = useState<{ name: DialogName; printId: string } | null>(null);
  if (dialog && dialog.printId !== print.id) setDialog(null);
  const dialogOpen = (name: DialogName) => dialog?.name === name && dialog.printId === print.id;
  // A new object per opening, which is how its own close knows it.
  const openDialog = (name: DialogName) => setDialog({ name, printId: print.id });
  /** Closes that dialog, if it's still the opening that's showing: one finishing after it was dismissed can't close
   *  the next. */
  const closeDialog = (name: DialogName) => {
    const opening = dialogOpen(name) ? dialog : null;
    return () => setDialog((current) => (opening && current === opening ? null : current));
  };
  const sourceGaps = print.source_gaps ?? [];
  // Driven by ?edit=<id> so links and the back button open/close it.
  const editOpen = searchParams.get("edit") === print.id;

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

  const {
    pickerOpen,
    setPickerOpen,
    downloading,
    handleDownload,
    downloadPlate,
    downloadAllZip,
    sortedPlates,
    zipFileCount,
    recordUse,
    downloadSupportingFile,
  } = useDownloadPrint(print, onUnauthorized, onUpdated);
  const customize = useCustomize(print, onUnauthorized);
  const studio = useOpenInStudio(print);
  const library = useCopyToLibrary(print, onUnauthorized, onUpdated);
  const libraryCopyId = print.library_copy_id ?? null;
  const providerInfo = importProviderInfo(print.source_provider);
  const { slicerOption, targets: slicerTargets, adaptedTargets } = useOpenInSlicer(print);
  const adapted = useAdaptedOpen(print.id, slicerOption?.id ?? null, recordUse, onUnauthorized);

  const closeEdit = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const removeFromCollection = async () => {
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
      showToast({ message: t("models:detail.removeFromCollectionFailed"), severity: "error" });
    } finally {
      setRemovingFromCollection(false);
    }
  };

  const remove = async () => {
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
      showToast({ message: t("models:detail.deleteFailed"), severity: "error" });
    } finally {
      setDeleting(false);
    }
  };

  // A model in a folder has no category yet as far as AI is concerned; categorizing it moves it out.
  const uncategorized = !print.category_id || print.category_kind === "folder";
  const queueWatched = useAiOutcomeWatch(print.id, onUpdated);
  const recategorize = async (force = false) => {
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

  /** A slicer's plates, named as the model's file lists name them. */
  const slicerPicks = <T extends SlicerTarget>(targets: T[], onPick: (target: T) => Partial<MenuPick>): MenuPick[] => {
    const names = shortNames(
      targets,
      (target) => target.key,
      (target) => target.filename,
      (target) => target.folder,
    );
    return targets.map((target) => {
      const text = target.plate
        ? fileRowText(t, target.filename, target.index, target.folder, names.get(target.key))
        : { primary: t("models:detail.preparedPrintFile"), secondary: target.filename };
      return {
        key: target.key,
        label: text.primary,
        secondary: text.secondary,
        title: target.filename,
        media: target.plate ? <PlateThumbnail plate={target.plate} size={THUMB} /> : printGlyph(),
        onSelect: () => undefined,
        ...onPick(target),
      };
    });
  };

  // Adapted copies stay open while they're made, so the item can show progress and then "ready".
  const openAdapted = (target: AdaptedTarget) => {
    void adapted.open(target).then((launched) => launched && closeMenu());
  };
  const adaptedPick = (target: AdaptedTarget, tooltip: string | undefined): Partial<MenuPick> => {
    const state = adapted.stateOf(target);
    // The folder stays beside the state: two files of one name are told apart by theirs.
    const withFolder = (status: string) => (target.folder ? `${folderLabel(target.folder)} · ${status}` : status);
    return {
      keepOpen: true,
      tooltip,
      disabled: state === "preparing",
      onSelect: () => openAdapted(target),
      ...(state === "preparing" && { secondary: withFolder(t("models:detail.adaptPreparingShort")) }),
      ...(state === "ready" && { secondary: withFolder(t("models:detail.adaptReadyShort")) }),
    };
  };

  const studioNames = shortNames(
    studio.files,
    (plate) => plate.id,
    (plate) => plate.filename,
    (plate) => plate.folder,
  );

  const actions: ModelAction[] = [];
  const add = (action: ModelAction | false | null | undefined) => {
    if (action) actions.push(action);
  };

  add({
    key: "addToCollection",
    group: "library",
    label: t("models:detail.addToCollection"),
    icon: <PlaylistAddIcon />,
    onSelect: () => openDialog("collection"),
  });
  add(
    Boolean(collectionId) && {
      key: "removeFromCollection",
      group: "library",
      label: t("models:detail.removeFromCollection"),
      icon: <PlaylistRemoveIcon />,
      busy: removingFromCollection,
      onSelect: () => void removeFromCollection(),
    },
  );
  if (owner) {
    add(
      libraryCopyId
        ? {
            key: "openCopy",
            group: "library",
            label: t("models:shared.openCopy"),
            icon: <LibraryAddCheckOutlinedIcon />,
            onSelect: () => library.openCopy(libraryCopyId),
          }
        : {
            key: "copy",
            group: "library",
            label: t("models:shared.copy"),
            icon: <LibraryAddOutlinedIcon />,
            busy: library.copying,
            onSelect: () => void library.copy(),
          },
    );
  }
  add({
    key: "download",
    group: "files",
    label: t("common:download"),
    icon: <DownloadIcon />,
    busy: downloading,
    onSelect: handleDownload,
  });
  add(
    customize.available && {
      key: "customize",
      group: "files",
      label: t("models:detail.customize"),
      icon: <TuneIcon />,
      onSelect: customize.start,
    },
  );
  if (!owner) {
    add(
      toolOwned
        ? // Kept as the tool needs it: it goes when the tool is uninstalled.
          {
            key: "toolOwned",
            group: "manage",
            label: t("models:detail.toolOwned"),
            secondary: t("models:detail.toolOwnedHint"),
            icon: <HandymanOutlinedIcon />,
            note: true,
            disabled: true,
          }
        : {
            key: "edit",
            group: "manage",
            label: t("common:edit"),
            icon: <EditIcon />,
            onSelect: () => navigate(`/models/${print.id}?edit=${print.id}`),
          },
    );
  }
  if (!toolOwned && !owner) {
    add(
      aiEnabled && {
        key: "categorize",
        group: "ai",
        label: t(uncategorized ? "models:aiCategorization.categorize" : "models:aiCategorization.recategorize"),
        shortLabel: t(uncategorized ? "models:actionsMenu.categorize" : "models:actionsMenu.recategorize"),
        secondary: print.ai_suggestion ? t("models:aiCategorization.suggestionPending") : undefined,
        icon: <AutoAwesomeIcon />,
        busy: recategorizing,
        // One suggestion at a time: the next waits until this one is accepted or rejected.
        disabled: Boolean(print.ai_suggestion),
        onSelect: () => void recategorize(),
      },
    );
    add(
      descriptionsEnabled && {
        key: "improve",
        group: "ai",
        label: t("models:aiDescriptions.improve"),
        shortLabel: t("models:actionsMenu.improve"),
        secondary: print.ai_description_pending ? t("models:aiDescriptions.suggestionPending") : undefined,
        icon: <AutoFixNormalIcon />,
        busy: improving,
        disabled: Boolean(print.ai_description_pending),
        onSelect: () => void improveDescription(),
      },
    );
  }
  // One target: a plain link to it. Several: the menu lists them to pick from.
  add({
    key: "slicer",
    group: "open",
    label: slicerOption
      ? t("models:detail.openInSlicer", { slicer: slicerOption.label })
      : t("models:detail.openInSlicerGeneric"),
    shortLabel: slicerOption?.label,
    icon: <LaunchIcon />,
    disabled: slicerTargets.length === 0,
    href: slicerTargets.length === 1 ? slicerTargets[0].href : undefined,
    onSelect: recordUse,
    picks:
      slicerOption && slicerTargets.length > 1
        ? slicerPicks(slicerTargets, (target) => ({ href: target.href, onSelect: recordUse }))
        : undefined,
  });
  if (slicerOption && adaptedTargets.length > 0) {
    const only = adaptedTargets.length === 1 ? adaptedTargets[0] : null;
    const state = only ? adapted.stateOf(only) : "idle";
    const idleLabel = t("models:detail.openAdaptedInSlicer", { slicer: slicerOption.label });
    // Files of different kinds are adapted differently: then each file explains its own copy.
    const infos = adaptedTargets.map((target) => adaptedInfo(t, slicerOption.label, target.plan));
    const sharedInfo = infos.every((info) => info === infos[0]) ? infos[0] : undefined;
    const stateLabel =
      state === "preparing"
        ? t("models:detail.adaptPreparing")
        : state === "ready"
          ? t("models:detail.adaptReady", { slicer: slicerOption.label })
          : null;
    add({
      key: "adapted",
      group: "open",
      label: stateLabel ?? idleLabel,
      shortLabel: stateLabel ?? t("models:actionsMenu.adapted", { slicer: slicerOption.label }),
      icon: <LightbulbIcon />,
      tone: "warning",
      tooltip: sharedInfo,
      busy: state === "preparing",
      keepOpen: true,
      onSelect: only ? () => openAdapted(only) : undefined,
      picks: only
        ? undefined
        : slicerPicks(adaptedTargets, (target) =>
            adaptedPick(target, sharedInfo ? undefined : infos[adaptedTargets.indexOf(target)]),
          ),
    });
  }
  // One file opens straight away; several are listed, as the slicer's are.
  add(
    studio.files.length > 0 && {
      key: "studio",
      group: "open",
      label: t("models:detail.openInStudio"),
      shortLabel: t("models:actionsMenu.studio"),
      icon: <DesignServicesOutlinedIcon />,
      onSelect: () => studio.open(studio.files[0]),
      picks:
        studio.files.length > 1
          ? studio.files.map((plate) => {
              const text = fileRowText(t, plate.filename, plate.position, plate.folder, studioNames.get(plate.id));
              return {
                key: plate.id,
                label: text.primary,
                secondary: text.secondary,
                title: plate.filename,
                media: <PlateThumbnail plate={plate} size={THUMB} />,
                onSelect: () => studio.open(plate),
              };
            })
          : undefined,
    },
  );
  add(
    Boolean(providerInfo && print.source_url) && {
      key: "provider",
      group: "open",
      label: t("models:detail.openInProvider", { provider: providerInfo?.label }),
      shortLabel: providerInfo?.label,
      icon: <OpenInNewIcon />,
      href: print.source_url ?? undefined,
      external: true,
    },
  );
  add(
    canLink && {
      key: "link",
      group: "source",
      label: t("models:linkSource.action"),
      icon: <AddLinkIcon />,
      onSelect: () => openDialog("link"),
    },
  );
  add(
    Boolean(owner) && {
      key: "moreFrom",
      group: "source",
      label: t("models:shared.moreFrom", { name: owner?.display_name }),
      icon: <PersonOutlineIcon />,
      onSelect: () => owner && navigate(`/explore/users/${owner.id}`),
    },
  );
  add(
    Boolean(providerInfo && print.source_url && sourceGaps.length > 0 && !toolOwned && !owner) && {
      key: "fillGaps",
      group: "source",
      label: t("models:detail.fillGaps", { provider: providerInfo?.label }),
      icon: <AutoFixHighIcon />,
      onSelect: () => openDialog("fillGaps"),
    },
  );
  add(
    !owner &&
      !toolOwned && {
        key: "delete",
        group: "danger",
        label: t("common:delete"),
        icon: <DeleteIcon />,
        tone: "error",
        onSelect: () => void remove(),
      },
  );

  const dialogs = (
    <>
      {adapted.dialog}
      {customize.window}

      <DownloadPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        downloading={downloading}
        sortedPlates={sortedPlates}
        zipFileCount={zipFileCount}
        downloadAllZip={() => void downloadAllZip()}
        downloadFolderZip={(folder) => void downloadAllZip(folder)}
        downloadPlate={downloadPlate}
        supportingFiles={print.supporting_files}
        downloadSupporting={(file) => void downloadSupportingFile(file)}
      />

      {/* The page header keeps this menu across models: a write on its way mustn't land on the next one's list. */}
      <AddToCollectionModal
        key={print.id}
        open={dialogOpen("collection")}
        onClose={closeDialog("collection")}
        printId={print.id}
        onUnauthorized={onUnauthorized}
        collectionId={collectionId}
        onRemovedFromCollection={onRemovedFromCollection}
        onCountChange={onCollectionCountChange}
      />

      {/* As the menu offers it: a link can't edit a model that's another user's or a tool's. */}
      {editOpen && !owner && !toolOwned && (
        <EditModelModal
          print={print}
          onClose={closeEdit}
          onUnauthorized={onUnauthorized}
          onUpdated={(updated) => onUpdated?.(updated)}
          viewer={viewer}
        />
      )}

      {dialogOpen("fillGaps") && (
        <FillGapsDialog
          open
          print={print}
          gaps={sourceGaps}
          onClose={closeDialog("fillGaps")}
          onUpdated={(updated) => onUpdated?.(updated)}
          onUnauthorized={onUnauthorized}
        />
      )}

      {dialogOpen("link") && (
        <LinkSourceDialog
          print={print}
          onClose={closeDialog("link")}
          onLinked={(updated) => onUpdated?.(updated)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );

  return { actions, dialogs, working: deleting || removingFromCollection };
}
