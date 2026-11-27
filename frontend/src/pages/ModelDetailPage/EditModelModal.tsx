import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { keyframes } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ImageIcon from "@mui/icons-material/Image";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  PlateUploadCapabilityError,
  PlateUploadOutcomeUnknownError,
  type LicenseFamily,
  type LicenseOption,
  type Print,
  printsApi,
} from "../../api/prints";
import { printProviderInfo } from "../../constants/importProviders";
import LicenseMarks from "../../components/license/LicenseMarks";
import { categoriesApi, type Category } from "../../api/categories";
import type { AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import TagInput from "../../components/TagInput";
import HelpTip from "../../components/HelpTip";
import DescriptionEditor from "./DescriptionEditor";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import { buildCategoryTree, flattenCategoryTree } from "../../utils/categoryTree";
import { newLocalId } from "../../utils/localId";
import { folderLabel } from "../../utils/fileFolders";
import { PlateUploadConfirmationError, savePlateChanges, type PlateItem } from "./plateSave";
import { reconcilePreviewUploads, type ImageItem } from "./previewImageSave";

function imageKey(img: ImageItem): string {
  return img.kind === "existing" ? img.id : img.localId;
}

function plateKey(p: PlateItem): string {
  return p.kind === "existing" ? p.id : p.localId;
}

function hasInvalidPlateFilename(items: PlateItem[]): boolean {
  return items.some((item) => !item.filename.trim());
}

function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const swapIndex = index + dir;
  if (index < 0 || swapIndex < 0 || swapIndex >= list.length) return list;
  const next = [...list];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next;
}

const LICENSE_GROUPS: LicenseFamily[] = ["cc", "open", "reserved"];

// The buttons over a picture: dark whatever the theme, so they read on any photo.
const overImageButtonSx = {
  bgcolor: "rgba(0,0,0,0.55)",
  color: "#fff",
  "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
} as const;

// The thumbnail band rises onto whichever picture is put first.
const thumbnailBandIn = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

type Props = {
  print: Print;
  onClose: () => void;
  onUnauthorized?: () => void;
  onUpdated: (print: Print) => void;
  /** Shown as the author of a direct upload, which has none. Label only. */
  viewer?: AuthUser | null;
};

/** Edits are staged locally and committed only on "Update"; "Cancel" discards them. */
export default function EditModelModal({ print, onClose, onUnauthorized, onUpdated, viewer }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const showToast = useToast();

  const [title, setTitle] = useState(print.title || print.name);
  const [categoryId, setCategoryId] = useState<string | null>(print.category_id ?? null);
  const [notes, setNotes] = useState(print.notes ?? "");
  const [tags, setTags] = useState<string[]>(print.tags);
  const hasImportedAuthor = Boolean(print.author || print.creator || print.source_provider);
  const showViewerAsAuthor = !hasImportedAuthor && Boolean(viewer);
  const [authorResetPending, setAuthorResetPending] = useState(false);
  const [images, setImages] = useState<ImageItem[]>(() =>
    print.preview_images.map((img): ImageItem => ({ kind: "existing", id: img.id, url: img.url })),
  );
  // Removals are tracked explicitly rather than diffed: a new upload's thumbnail may still be
  // generating, and a diff would delete it as soon as it appeared.
  const [removedImageIds, setRemovedImageIds] = useState<Set<string>>(new Set());
  const [plateItems, setPlateItems] = useState<PlateItem[]>(() =>
    print.plates.map((p): PlateItem => ({
      kind: "existing",
      id: p.id,
      filename: p.filename,
      filenameEdited: false,
      folder: p.folder ?? null,
    })),
  );
  const [removedPlateIds, setRemovedPlateIds] = useState<Set<string>>(new Set());
  const latestPrint = useRef(print);
  const [categories, setCategories] = useState<Category[] | null>(null);
  // "source": what its source lists; "": none, for a model with no source; otherwise a licence id the owner picks.
  const initialLicense =
    print.license?.source === "user" ? (print.license.id ?? "") : print.source_provider ? "source" : "";
  const [license, setLicense] = useState(initialLicense);
  const [licenses, setLicenses] = useState<LicenseOption[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasUnconfirmedImages = images.some((image) => image.kind === "unconfirmed");

  const createdUrlsRef = useRef<string[]>([]);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    latestPrint.current = print;
  }, [print]);

  useEffect(() => {
    categoriesApi
      .list()
      .then(setCategories)
      .catch(() => setCategories([]));
    printsApi
      .listLicenses()
      .then(setLicenses)
      .catch(() => setLicenses([]));
  }, []);

  const markDirty = () => setDirty(true);

  // Each kind is ordered on its own, as in its box on the models page; categories come first.
  const [flatCategories, flatFolders] = useMemo(
    () =>
      (["category", "folder"] as const).map((kind) =>
        flattenCategoryTree(buildCategoryTree((categories ?? []).filter((c) => c.kind === kind))),
      ),
    [categories],
  );
  const categoryName = (c: Category) => translateCategoryDisplay(c, i18n).name;
  // The pickable licences under a heading for each kind.
  const licenseMenu = useMemo(() => {
    const entries: ({ kind: "group"; family: LicenseFamily } | { kind: "option"; option: LicenseOption })[] = [];
    for (const family of LICENSE_GROUPS) {
      const group = (licenses ?? []).filter((option) => option.family === family);
      if (!group.length) continue;
      entries.push({ kind: "group", family });
      for (const option of group) entries.push({ kind: "option", option });
    }
    return entries;
  }, [licenses]);

  const onAddImages = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const newItems: ImageItem[] = Array.from(fileList).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      createdUrlsRef.current.push(previewUrl);
      return { kind: "new", localId: newLocalId(), file, previewUrl };
    });
    setImages((prev) => [...prev, ...newItems]);
    markDirty();
  };
  const removeImage = (key: string) => {
    const target = images.find((img) => imageKey(img) === key);
    if (!target || target.kind === "unconfirmed") return;
    if (target.kind === "existing") {
      setRemovedImageIds((ids) => new Set(ids).add(target.id));
    }
    setImages((prev) => prev.filter((img) => imageKey(img) !== key));
    markDirty();
  };
  // First is the thumbnail: the picture model cards show.
  const makeThumbnail = (key: string) => {
    setImages((prev) => {
      const target = prev.find((img) => imageKey(img) === key);
      return target ? [target, ...prev.filter((img) => img !== target)] : prev;
    });
    markDirty();
  };
  const moveImageBy = (key: string, dir: -1 | 1) => {
    setImages((prev) =>
      moveItem(
        prev,
        prev.findIndex((img) => imageKey(img) === key),
        dir,
      ),
    );
    markDirty();
  };

  const onAddFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const newItems: PlateItem[] = Array.from(fileList).map((file) => ({
      kind: "new",
      localId: newLocalId(),
      file,
      filename: file.name,
    }));
    setPlateItems((prev) => [...prev, ...newItems]);
    markDirty();
  };
  const renamePlateItem = (key: string, filename: string) => {
    const updatedItems = plateItems.map((item) => {
      if (plateKey(item) !== key) return item;
      return item.kind === "existing" ? { ...item, filename, filenameEdited: true } : { ...item, filename };
    });
    setPlateItems(updatedItems);
    setError(hasInvalidPlateFilename(updatedItems) ? t("models:edit.fileNameRequired") : null);
    markDirty();
  };
  const removePlateItem = (key: string) => {
    if (plateItems.length <= 1) return;
    const target = plateItems.find((item) => plateKey(item) === key);
    if (target?.kind === "new" && target.uploadAttempted) return;
    if (target?.kind === "existing") {
      setRemovedPlateIds((prev) => new Set(prev).add(target.id));
    }
    setPlateItems((prev) => prev.filter((p) => plateKey(p) !== key));
    markDirty();
  };
  const movePlateItemBy = (key: string, dir: -1 | 1) => {
    setPlateItems((prev) =>
      moveItem(
        prev,
        prev.findIndex((p) => plateKey(p) === key),
        dir,
      ),
    );
    markDirty();
  };

  const requestClose = async () => {
    if (saving) return;
    if (dirty) {
      const confirmed = await confirmDialog({
        message: t("models:edit.confirmDiscard"),
        confirmLabel: t("models:edit.discardConfirmLabel"),
        destructive: true,
      });
      if (!confirmed) return;
    }
    onClose();
  };

  const handleUpdate = async () => {
    if (hasUnconfirmedImages) return;
    if (hasInvalidPlateFilename(plateItems)) {
      setError(t("models:edit.fileNameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    let latest: Print = latestPrint.current;
    try {
      const metaRes = await printsApi.updateMeta(print.id, {
        title,
        notes,
        ...(license !== initialLicense ? { license: license || null } : {}),
      });
      latest = metaRes.print ?? latest;

      const catRes = await printsApi.updateCategory(print.id, categoryId);
      latest = catRes.print ?? latest;

      const tagsRes = await printsApi.setTags(print.id, tags);
      latest = tagsRes.print ?? latest;

      if (authorResetPending) {
        const authorRes = await printsApi.resetAuthor(print.id);
        latest = authorRes.print ?? latest;
      }

      for (const id of removedImageIds) {
        const res = await printsApi.deletePreviewImage(print.id, id);
        latest = res.print ?? latest;
        setRemovedImageIds((pending) => new Set([...pending].filter((imageId) => imageId !== id)));
      }
      const newImageFiles = images.filter((img) => img.kind === "new").map((img) => img.file);
      let stagedImages = images;
      if (newImageFiles.length) {
        const uploadRes = await printsApi.addPreviewImages(print.id, newImageFiles);
        latest = uploadRes.print;
        stagedImages = reconcilePreviewUploads(images, latest.preview_images, uploadRes.added_image_ids);
        setImages(stagedImages);
        if (stagedImages.some((image) => image.kind === "unconfirmed")) {
          latestPrint.current = latest;
          onUpdated(latest);
          return;
        }
      }
      if (stagedImages.length) {
        // Our own render gives way to the first picture uploaded, so it may be gone by now.
        const present = new Set(latest.preview_images.map((img) => img.id));
        const known = stagedImages
          .flatMap((img) => (img.kind === "existing" ? [img.id] : []))
          .filter((id) => present.has(id));
        // Reorder needs an exhaustive id list; images this modal never saw go after, in their order.
        const knownIds = new Set(known);
        const unknown = latest.preview_images
          .filter((img) => !knownIds.has(img.id))
          .toSorted((a, b) => a.position - b.position)
          .map((img) => img.id);
        const finalOrder = [...known, ...unknown];
        if (finalOrder.length) {
          const reorderRes = await printsApi.reorderPreviewImages(print.id, finalOrder);
          latest = reorderRes.print ?? latest;
        }
      }

      latestPrint.current = latest;
      latest = await savePlateChanges(latest, plateItems, removedPlateIds, printsApi, (progress) => {
        latest = progress.print;
        latestPrint.current = progress.print;
        setPlateItems(progress.items);
        setRemovedPlateIds(progress.removedPlateIds);
      });
      latestPrint.current = latest;

      onUpdated(latest);
      showToast({ message: t("models:edit.updateSuccess") });
      onClose();
    } catch (err) {
      latestPrint.current = latest;
      onUpdated(latest);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      if (err instanceof PlateUploadCapabilityError) {
        setError(t("models:edit.uploadCapabilityCheckFailed"));
        return;
      }
      setError(
        err instanceof PlateUploadConfirmationError || err instanceof PlateUploadOutcomeUnknownError
          ? t("models:edit.uploadConfirmationFailed")
          : err instanceof Error
            ? err.message
            : t("models:edit.updateFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={requestClose} fullWidth maxWidth="md">
      <DialogTitle>{t("models:edit.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 0.5 }}>
          {hasUnconfirmedImages && <Alert severity="warning">{t("models:edit.previewUploadUnconfirmed")}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t("models:edit.titleLabel")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            disabled={saving}
            fullWidth
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />

          <FormControl fullWidth disabled={saving || !categories}>
            <InputLabel id="edit-model-category-label">{t("models:edit.categoryOrFolder")}</InputLabel>
            <Select
              labelId="edit-model-category-label"
              label={t("models:edit.categoryOrFolder")}
              value={categoryId ?? ""}
              onChange={(e) => {
                setCategoryId(e.target.value || null);
                markDirty();
              }}
            >
              <MenuItem value="">{t("models:edit.noCategory")}</MenuItem>
              {flatCategories.map(({ category, depth }) =>
                depth === 0 ? (
                  // Top-level categories are headings. A disabled MenuItem, not ListSubheader: MUI's Select
                  // still handles clicks on the latter and gets stuck open.
                  <MenuItem key={category.id} disabled divider sx={{ fontWeight: 700, opacity: "1 !important" }}>
                    {categoryName(category)}
                  </MenuItem>
                ) : (
                  <MenuItem key={category.id} value={category.id} sx={{ pl: 1 + depth * 2 }}>
                    {categoryName(category)}
                  </MenuItem>
                ),
              )}
              {flatFolders.length > 0 && (
                <MenuItem disabled divider sx={{ fontWeight: 700, opacity: "1 !important" }}>
                  {t("models:folders.title")}
                </MenuItem>
              )}
              {/* Unlike a top-level category, a top-level folder holds models itself (uploads land there). */}
              {flatFolders.map(({ category, depth }) => (
                <MenuItem key={category.id} value={category.id} sx={{ pl: 2 + depth * 2 }}>
                  {categoryName(category) || t("models:categories.untitled")}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth disabled={saving || !licenses}>
            <InputLabel id="edit-model-license-label">{t("models:license.title")}</InputLabel>
            <Select
              labelId="edit-model-license-label"
              label={t("models:license.title")}
              value={licenses ? license : ""}
              onChange={(e) => {
                setLicense(e.target.value);
                markDirty();
              }}
            >
              {print.source_provider ? (
                <MenuItem value="source">
                  {t("models:license.fromSource", { site: printProviderInfo(print.source_provider).label })}
                  {print.license?.source === "provider" && (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                      {print.license.short}
                    </Typography>
                  )}
                </MenuItem>
              ) : (
                <MenuItem value="">{t("models:license.none")}</MenuItem>
              )}
              {licenseMenu.map((entry) =>
                entry.kind === "group" ? (
                  // A disabled MenuItem rather than ListSubheader, as for the categories above.
                  <MenuItem
                    key={`group-${entry.family}`}
                    disabled
                    divider
                    sx={{ fontWeight: 700, opacity: "1 !important" }}
                  >
                    {t(`models:license.groups.${entry.family}`)}
                  </MenuItem>
                ) : (
                  <MenuItem key={entry.option.id} value={entry.option.id} sx={{ pl: 3, gap: 1 }}>
                    <LicenseMarks marks={entry.option.marks} family={entry.option.family} size={14} />
                    {entry.option.short}
                  </MenuItem>
                ),
              )}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("models:detail.author")}
            </Typography>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="body2">
                {authorResetPending
                  ? t("models:edit.authorWillBeYou")
                  : print.author?.name ||
                    print.author?.handle ||
                    print.creator ||
                    (showViewerAsAuthor ? viewer!.display_name : null) ||
                    t("models:card.unknownAuthor")}
              </Typography>
              {hasImportedAuthor &&
                (authorResetPending ? (
                  <Button size="small" disabled={saving} onClick={() => setAuthorResetPending(false)}>
                    {t("models:edit.undoResetAuthor")}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    disabled={saving}
                    startIcon={<RestartAltIcon fontSize="small" />}
                    onClick={() => {
                      setAuthorResetPending(true);
                      markDirty();
                    }}
                  >
                    {t("models:edit.resetAuthor")}
                  </Button>
                ))}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
              {t("models:edit.previewImages")}
              <HelpTip text={t("models:edit.previewImagesHelp")} />
            </Typography>
            <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
              {images.map((img, idx) => {
                const key = imageKey(img);
                const src = img.kind === "existing" ? printsApi.fileUrl(img.url) : img.previewUrl;
                const isThumbnail = idx === 0;
                return (
                  <Box
                    key={key}
                    sx={{
                      position: "relative",
                      flexShrink: 0,
                      width: 96,
                      height: 96,
                      borderRadius: 1,
                      overflow: "hidden",
                      border: isThumbnail ? "2px solid" : "1px solid",
                      borderColor: isThumbnail ? "primary.main" : "divider",
                      "&:hover .use-as-thumbnail, &:focus-within .use-as-thumbnail": { opacity: 1 },
                    }}
                  >
                    <Box
                      component="img"
                      src={src}
                      alt=""
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    {isThumbnail ? (
                      <Box
                        sx={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: 20,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0.5,
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          fontSize: 10.5,
                          fontWeight: 600,
                          animation: `${thumbnailBandIn} 200ms ease-out`,
                          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                        }}
                      >
                        <ImageIcon sx={{ fontSize: 12 }} />
                        {t("models:edit.thumbnailBadge")}
                      </Box>
                    ) : (
                      <Box
                        className="use-as-thumbnail"
                        sx={{
                          position: "absolute",
                          top: 2,
                          left: 2,
                          opacity: 0,
                          transition: "opacity 150ms",
                          "@media (hover: none)": { opacity: 1 },
                        }}
                      >
                        <Tooltip title={t("models:edit.useAsThumbnail")}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={saving}
                              aria-label={t("models:edit.useAsThumbnail")}
                              onClick={() => makeThumbnail(key)}
                              sx={overImageButtonSx}
                            >
                              <ImageOutlinedIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    )}
                    <IconButton
                      size="small"
                      disabled={saving || img.kind === "unconfirmed"}
                      aria-label={t("models:edit.removeImage")}
                      onClick={() => removeImage(key)}
                      sx={{ ...overImageButtonSx, position: "absolute", top: 2, right: 2 }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <Stack direction="row" sx={{ position: "absolute", bottom: isThumbnail ? 22 : 2, right: 2 }}>
                      {!isThumbnail && (
                        <IconButton
                          size="small"
                          disabled={saving}
                          aria-label={t("models:edit.moveImageLeft")}
                          onClick={() => moveImageBy(key, -1)}
                          sx={overImageButtonSx}
                        >
                          <ChevronLeftIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        disabled={saving || idx === images.length - 1}
                        aria-label={t("models:edit.moveImageRight")}
                        onClick={() => moveImageBy(key, 1)}
                        sx={overImageButtonSx}
                      >
                        <ChevronRightIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Stack>
                  </Box>
                );
              })}
              <Box
                component="button"
                type="button"
                disabled={saving}
                onClick={() => addImageInputRef.current?.click()}
                sx={{
                  flexShrink: 0,
                  width: 96,
                  height: 96,
                  borderRadius: 1,
                  border: "1px dashed",
                  borderColor: "divider",
                  bgcolor: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.5,
                  color: "text.secondary",
                }}
              >
                <AddPhotoAlternateIcon fontSize="small" />
                <Typography variant="caption">{t("common:add")}</Typography>
              </Box>
              <input
                ref={addImageInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  onAddImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </Stack>
          </Box>

          <DescriptionEditor
            value={notes}
            onChange={(next) => {
              setNotes(next);
              markDirty();
            }}
            disabled={saving}
          />

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t("models:detail.tags")}
            </Typography>
            <TagInput
              value={tags}
              onChange={(v) => {
                setTags(v);
                markDirty();
              }}
            />
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("models:edit.modelFiles")}
            </Typography>
            <Stack spacing={1}>
              {plateItems.map((p, idx) => {
                const key = plateKey(p);
                const folder = p.kind === "existing" ? p.folder : null;
                const uploadPending = p.kind === "new" && p.uploadAttempted === true;
                return (
                  <Stack
                    key={key}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}
                  >
                    <InsertDriveFileIcon fontSize="small" color="action" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label={t("models:edit.fileName")}
                        value={p.filename}
                        error={!p.filename.trim()}
                        helperText={!p.filename.trim() ? t("models:edit.fileNameRequired") : undefined}
                        disabled={saving}
                        onChange={(event) => renamePlateItem(key, event.target.value)}
                      />
                      {/* Its order is the model's, across folders, so the folder is said on each file. */}
                      {folder && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          component="div"
                          title={folder}
                          sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                        >
                          <FolderOutlinedIcon aria-hidden sx={{ fontSize: 13, flexShrink: 0 }} />
                          <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {folderLabel(folder)}
                          </Box>
                        </Typography>
                      )}
                    </Box>
                    {p.kind === "new" && <Chip label={t("models:edit.newBadge")} size="small" />}
                    <IconButton size="small" disabled={saving || idx === 0} onClick={() => movePlateItemBy(key, -1)}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={saving || idx === plateItems.length - 1}
                      onClick={() => movePlateItemBy(key, 1)}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <Tooltip title={uploadPending ? t("models:edit.uploadPending") : t("models:edit.removeFile")}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={saving || plateItems.length <= 1 || uploadPending}
                          aria-label={t("models:edit.removeFile")}
                          onClick={() => removePlateItem(key)}
                        >
                          <DeleteIcon fontSize="small" color="error" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                );
              })}
              <Button
                size="small"
                disabled={saving}
                startIcon={<UploadFileIcon fontSize="small" />}
                onClick={() => addFileInputRef.current?.click()}
                sx={{ alignSelf: "flex-start" }}
              >
                {t("models:edit.addFiles")}
              </Button>
              <input
                ref={addFileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  onAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={requestClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleUpdate}
          disabled={saving || hasUnconfirmedImages || hasInvalidPlateFilename(plateItems)}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t("models:edit.update")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
