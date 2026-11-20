import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import { alpha, keyframes } from "@mui/material/styles";
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
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { type LicenseFamily, type LicenseOption, type Print, type PrintFile, printsApi } from "../../api/prints";
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
import {
  batchesByName,
  gltfFilesFromOthers,
  isPreparedName,
  sortAddedFiles,
  stagedFiles,
  storedModelFileName,
  withGltfFiles,
} from "../../utils/addedFiles";
import { formatFileSize } from "../../utils/fileSize";
import { inFolder, withExtensionOf } from "../../utils/fileExtensions";
import RenameDialog from "../../components/RenameDialog";
import TypeTile from "../../components/supportingFiles/TypeTile";
import SupportingFileMenu, { type FileMenuAnchor } from "../../components/supportingFiles/SupportingFileMenu";

type ImageItem =
  { kind: "existing"; id: string; url: string } | { kind: "new"; localId: string; file: File; previewUrl: string };

type PlateItem =
  // `wanted`: the name a file added in place of one of the same name was picked with, to be named back to.
  | { kind: "existing"; id: string; filename: string; folder: string | null; wanted?: string }
  // `packedWith`: the .bin and textures a .gltf points at, which go up with it and are packed into its .glb. `missing`:
  // those its pick didn't have, looked for among the other picks on saving.
  | { kind: "new"; localId: string; file: File; packedWith: File[]; missing: string[] };

type SupportingItem =
  | { kind: "existing"; file: PrintFile; renamedTo: string | null }
  // `picked`: the name it was picked by, which says whether it may take the prepared slot (see the upload below).
  | { kind: "new"; localId: string; file: File; picked: string };

const supportingKey = (item: SupportingItem) => (item.kind === "existing" ? item.file.id : item.localId);
const supportingName = (item: SupportingItem) =>
  item.kind === "existing" ? (item.renamedTo ?? item.file.filename) : item.file.name;
const existingItem = (file: PrintFile): SupportingItem => ({ kind: "existing", file, renamedTo: null });

// A file that just landed in the list, from either Add files, is lit up for a moment so it's seen where it went.
const landed = keyframes`from { background-color: var(--landed); } to { background-color: transparent; }`;

function imageKey(img: ImageItem): string {
  return img.kind === "existing" ? img.id : img.localId;
}

function plateKey(p: PlateItem): string {
  return p.kind === "existing" ? p.id : p.localId;
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
  // The model's plates removed here, until each is deleted: tracked rather than diffed against the model, which can
  // gain a plate from another tab while the dialog is open, and that one isn't this dialog's to delete.
  const [removedPlateIds, setRemovedPlateIds] = useState<Set<string>>(new Set());
  // Whether the plates were moved here: only then is their order this dialog's to send. Added ones go last, as the
  // server puts them, and an order sent from what the dialog read would undo one another tab chose meanwhile.
  const [platesMoved, setPlatesMoved] = useState(false);
  const [plateItems, setPlateItems] = useState<PlateItem[]>(() =>
    print.plates.map((p): PlateItem => ({
      kind: "existing",
      id: p.id,
      filename: p.filename,
      folder: p.folder ?? null,
    })),
  );
  const [categories, setCategories] = useState<Category[] | null>(null);
  // "source": what its source lists; "": none, for a model with no source; otherwise a licence id the owner picks.
  const initialLicense =
    print.license?.source === "user" ? (print.license.id ?? "") : print.source_provider ? "source" : "";
  const [license, setLicense] = useState(initialLicense);
  const [licenses, setLicenses] = useState<LicenseOption[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A model opened from a card has only their count, so its supporting files are read here.
  const [supportingItems, setSupportingItems] = useState<SupportingItem[]>(() =>
    (print.supporting_files ?? []).map(existingItem),
  );
  const [supportingLoading, setSupportingLoading] = useState(
    !print.supporting_files && print.supporting_file_count > 0,
  );
  const [supportingLoadFailed, setSupportingLoadFailed] = useState(false);
  const [removedSupportingIds, setRemovedSupportingIds] = useState<Set<string>>(new Set());
  const [supportingMenu, setSupportingMenu] = useState<{ key: string; anchor: FileMenuAnchor } | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const createdUrlsRef = useRef<string[]>([]);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const addSupportingInputRef = useRef<HTMLInputElement>(null);
  // A sliced print this dialog added became the model's prepared print: the ones after it, in this save or a retry of
  // it, are kept as supporting files rather than each replacing the one before.
  const preparedAdded = useRef(false);

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

  // Numbers each read of the files, so only the latest one's answer lands, and none once the dialog has gone.
  const supportingRead = useRef(0);
  // Taken when an answer lands, so a new function from the page doesn't read the files again.
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  });
  const readSupportingFiles = useCallback(() => {
    const read = ++supportingRead.current;
    setSupportingLoadFailed(false);
    setSupportingLoading(true);
    printsApi
      .listFiles(print.id)
      .then((files) => {
        // Before any added while they were read.
        if (read === supportingRead.current) setSupportingItems((current) => [...files.map(existingItem), ...current]);
      })
      .catch((err: unknown) => {
        if (read !== supportingRead.current) return;
        // A session that ended goes where the app renews it or signs in again; still said as failed, with a retry, in
        // case the server couldn't be reached to renew it.
        if (err instanceof UnauthorizedError) unauthorized.current?.();
        // Said, with a retry: the empty list would claim the model has none, and leave them out of reach here.
        setSupportingLoadFailed(true);
      })
      .finally(() => {
        if (read === supportingRead.current) setSupportingLoading(false);
      });
  }, [print.id]);

  useEffect(() => {
    if (print.supporting_files) return;
    // None now (taken away while they were read): nothing to wait for or retry. The read before was given up already.
    if (!print.supporting_file_count) {
      setSupportingLoading(false);
      setSupportingLoadFailed(false);
      return;
    }
    readSupportingFiles();
    return () => {
      supportingRead.current += 1;
    };
  }, [print.supporting_files, print.supporting_file_count, readSupportingFiles]);
  // A model read in full since the dialog opened, passed in from a card, lists its files: taken from it while the read
  // of them is still under way, or failed, so the list and Update aren't left waiting for a read that won't land.
  useEffect(() => {
    if (!print.supporting_files || !(supportingLoading || supportingLoadFailed)) return;
    supportingRead.current += 1;
    const files = print.supporting_files;
    setSupportingItems((current) => [...files.map(existingItem), ...current]);
    setSupportingLoadFailed(false);
    setSupportingLoading(false);
  }, [print.supporting_files, supportingLoading, supportingLoadFailed]);

  const markDirty = () => setDirty(true);
  // Picks not in the lists yet, their .gltf or an earlier pick's still being read for the files it points at: Update
  // waits for them.
  const [adding, setAdding] = useState(0);

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
    if (target?.kind === "existing") {
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

  // Each pick goes into the lists after the one before, though that one's .gltf may take longer to read: the first
  // plate and the first sliced print, which becomes the prepared print, are those picked first.
  const picks = useRef<Promise<unknown>>(Promise.resolve());
  const onAddFiles = (fileList: FileList | null, addedTo: "model" | "supporting") => {
    if (!fileList?.length) return Promise.resolve();
    const sorted = sortAddedFiles(Array.from(fileList), addedTo);
    markDirty();
    setAdding((count) => count + 1);
    // Read at once, beside the picks before it; caught here too, so one that fails while it waits its turn isn't
    // reported as unhandled.
    const reading = withGltfFiles(sorted, (file) => file);
    reading.catch(() => undefined);
    const inLists = picks.current
      .then(() => reading)
      .then(({ model, supporting, packedWith, ambiguous, missing }) => {
        // Nothing of a pick whose .gltf names a file two picked files could be: the server couldn't tell which either.
        if (ambiguous.length) {
          setError(t("models:supporting.gltfAmbiguous", { names: ambiguous.join(", ") }));
          return;
        }
        const packed = new Set([...packedWith.values()].flat());
        if (model.length) {
          setPlateItems((prev) => [
            ...prev,
            ...model
              .filter((file) => !packed.has(file))
              .map((file): PlateItem => ({
                kind: "new",
                localId: newLocalId(),
                file,
                packedWith: packedWith.get(file) ?? [],
                missing: missing.get(file) ?? [],
              })),
          ]);
        }
        if (supporting.length) {
          setSupportingItems((prev) => [
            ...prev,
            ...supporting.map((file): SupportingItem => ({
              kind: "new",
              localId: newLocalId(),
              file,
              picked: file.name,
            })),
          ]);
        }
      })
      .finally(() => setAdding((count) => count - 1));
    picks.current = inLists.catch(() => undefined);
    return inLists;
  };
  const removeSupportingItem = (key: string) => {
    const target = supportingItems.find((item) => supportingKey(item) === key);
    if (target?.kind === "existing") setRemovedSupportingIds((ids) => new Set(ids).add(target.file.id));
    setSupportingItems((prev) => prev.filter((item) => supportingKey(item) !== key));
    markDirty();
  };
  const renameSupportingItem = (key: string, name: string) => {
    setSupportingItems((prev) =>
      prev.map((item) => {
        if (supportingKey(item) !== key) return item;
        if (item.kind === "existing") return { ...item, renamedTo: name === item.file.filename ? null : name };
        // A file still to upload is uploaded under its new name, keeping its extension where the name gives none, as
        // a stored file's rename does.
        return {
          ...item,
          file: new File([item.file], withExtensionOf(name, item.file.name), { type: item.file.type }),
        };
      }),
    );
    markDirty();
  };
  const removePlateItem = (key: string) => {
    if (plateItems.length <= 1) return;
    const target = plateItems.find((p) => plateKey(p) === key);
    if (target?.kind === "existing") setRemovedPlateIds((ids) => new Set(ids).add(target.id));
    setPlateItems((prev) => prev.filter((p) => plateKey(p) !== key));
    markDirty();
  };
  const movePlateItemBy = (key: string, dir: -1 | 1) => {
    setPlatesMoved(true);
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
    // A scene picked apart from files it points at takes them from the other picks now, as the server packs a .gltf only
    // with what's sent with it. Two picked files one could be are said before anything is saved.
    type Staged = Extract<PlateItem, { kind: "new" }> | Extract<SupportingItem, { kind: "new" }>;
    const staged = stagedFiles<Staged>(
      [
        ...plateItems.flatMap((p) => (p.kind === "new" ? [p] : [])),
        ...supportingItems.flatMap((item) => (item.kind === "new" ? [item] : [])),
      ],
      (item) => item.file,
      plateItems.flatMap((p) => (p.kind === "new" ? p.packedWith : [])),
    );
    const across = gltfFilesFromOthers(
      plateItems.flatMap((p) =>
        p.kind === "new" && p.missing.length ? [{ scene: p, file: p.file, missing: p.missing }] : [],
      ),
      staged,
      (each) => each.file,
    );
    if (across.ambiguous.length) {
      setError(t("models:supporting.gltfAmbiguous", { names: across.ambiguous.join(", ") }));
      return;
    }
    const taken = new Set<Staged>([...across.took.values()].flat().flatMap((each) => (each.item ? [each.item] : [])));
    const takenIn = (list: PlateItem[]) =>
      list.flatMap((p): PlateItem[] => {
        if (p.kind !== "new") return [p];
        if (taken.has(p)) return [];
        const took = across.took.get(p);
        return took
          ? [
              {
                ...p,
                packedWith: [
                  ...p.packedWith,
                  ...took.map((each) => each.file).filter((file) => !p.packedWith.includes(file)),
                ],
                missing: across.missing.get(p) ?? [],
              },
            ]
          : [p];
      });
    const takenOut = (list: SupportingItem[]) => list.filter((item) => item.kind !== "new" || !taken.has(item));
    const plateList = across.took.size ? takenIn(plateItems) : plateItems;
    const supportingList = across.took.size ? takenOut(supportingItems) : supportingItems;
    if (across.took.size) {
      setPlateItems(takenIn);
      setSupportingItems(takenOut);
    }
    setSaving(true);
    setError(null);
    // A file's menu left open would change what this save has already read.
    setSupportingMenu(null);
    let latest: Print = print;
    // Renames of files another tab took away meanwhile: nothing to rename, said once the rest is saved, or with what
    // stopped it.
    const renamesGone: string[] = [];
    const goneSaid = () =>
      renamesGone.length ? t("models:edit.renamesGone", { names: renamesGone.join(", ") }) : null;
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
        // Gone now: a retry after a later step fails doesn't ask again, which the server would answer with a 404.
        setRemovedImageIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      const newImages = images.flatMap((img) => (img.kind === "new" ? [img] : []));
      // Up now: each new picture is the stored one it became, so a retry doesn't upload it again. By the ids the upload
      // gave back: a picture another tab added meanwhile is new to this dialog too, and isn't one of these. One a
      // request, each settled as it's up: a request the server failed part-way through would have kept some of its
      // pictures without saying which, and a retry would add them again.
      const storedImages = new Map<string, { id: string; url: string }>();
      const unsavedPhotos: string[] = [];
      for (const img of newImages) {
        const uploadRes = await printsApi.addPreviewImages(print.id, [img.file]);
        latest = uploadRes.print;
        const id = uploadRes.image_ids?.[0];
        const url = id ? latest.preview_images.find((each) => each.id === id)?.url : undefined;
        if (!id || !url) {
          // One the server couldn't keep stays in the list, to be said below and tried again or taken out.
          unsavedPhotos.push(img.file.name);
          continue;
        }
        storedImages.set(img.localId, { id, url });
        // Our own render gives way to the first picture stored: out of the list now, not after the last, so a later
        // photo failing doesn't leave it there to be removed, a removal the next try would fail on.
        const present = new Set(latest.preview_images.map((each) => each.id));
        setImages((current) =>
          current.flatMap((each): ImageItem[] => {
            if (each.kind === "new") return [each.localId === img.localId ? { kind: "existing", id, url } : each];
            return present.has(each.id) ? [each] : [];
          }),
        );
      }
      if (images.length) {
        // Our own render gives way to the first picture uploaded, so it may be gone by now: left out of the order, and
        // of the dialog's list, so a retry doesn't send it either.
        const present = new Set(latest.preview_images.map((img) => img.id));
        setImages((current) => current.filter((img) => img.kind !== "existing" || present.has(img.id)));
        const known = images.flatMap((img) => {
          const id = img.kind === "existing" ? img.id : storedImages.get(img.localId)?.id;
          return id && present.has(id) ? [id] : [];
        });
        // Reorder needs an exhaustive id list; images this modal never saw go after, in their order.
        const knownIds = new Set(known);
        const unknown = latest.preview_images
          .filter((img) => !knownIds.has(img.id))
          .toSorted((a, b) => a.position - b.position)
          .map((img) => img.id);
        const finalOrder = [...known, ...unknown];
        // None when every picture added was one the server couldn't read, and the model had none.
        if (finalOrder.length) {
          const reorderRes = await printsApi.reorderPreviewImages(print.id, finalOrder);
          latest = reorderRes.print ?? latest;
        }
      }

      // Upload before delete so a model's only file can be swapped in one save. `plates` follows each step as it's
      // done, for the steps after it, and so does the dialog's list, for a retry after a later step fails.
      let plates = plateList;
      // One plate each: a .gltf's files are packed into it, and one two scenes share is sent once. Two files of one
      // name go in requests apart (picked with two scenes, "scene.bin" each), as the server matches a scene's by name.
      const filesOf = (p: PlateItem) => (p.kind === "new" ? [p.file, ...p.packedWith] : []);
      for (const batch of batchesByName(
        plates.filter((p) => p.kind === "new"),
        filesOf,
      )) {
        const sent = [...new Set(batch.flatMap(filesOf))];
        const uploadRes = await printsApi.addPlates(print.id, sent);
        latest = uploadRes.print;
        // Up now: each new file is the stored plate it became, so a retry doesn't upload it again. By what the upload
        // said of its own file: a plate another tab added meanwhile is new to this dialog too, and isn't one of these,
        // and a file a .gltf sent with it took in became no plate, so it's gone from the list rather than given one.
        const became = new Map<string, PlateItem>();
        const packedInto = new Set<string>();
        // Up, by the answer, but not on the model it answered with: taken away by another tab, as it may be. Said,
        // with the dialog left open, rather than saved as if it were there.
        const unsettled: string[] = [];
        for (const p of batch) {
          if (p.kind !== "new") continue;
          const result = uploadRes.uploaded?.[sent.indexOf(p.file)];
          if (result?.packed) {
            packedInto.add(p.localId);
            continue;
          }
          const stored = latest.plates.find((each) => each.id === result?.plate_id);
          if (!stored) {
            unsettled.push(p.file.name);
            continue;
          }
          became.set(p.localId, {
            kind: "existing",
            id: stored.id,
            filename: stored.filename,
            folder: stored.folder ?? null,
            wanted: storedModelFileName(p.file.name),
          });
        }
        const settle = (list: PlateItem[]) =>
          list.flatMap((p) =>
            p.kind === "new" && packedInto.has(p.localId) ? [] : [(p.kind === "new" && became.get(p.localId)) || p],
          );
        plates = settle(plates);
        setPlateItems(settle);
        if (unsettled.length) throw new Error(t("models:edit.platesUnsettled", { names: unsettled.join(", ") }));
      }
      for (const id of removedPlateIds) {
        // One another tab took away already is as good as done: the model is read to be sure it's gone, as no view of it.
        const res = await printsApi.deletePlate(print.id, id).catch(async (err: unknown) => {
          const now = await printsApi.get(print.id, { record: false }).catch(() => null);
          if (!now || now.plates.some((each) => each.id === id)) throw err;
          return { print: now };
        });
        latest = res.print ?? latest;
        setRemovedPlateIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      // A file added in place of one of the same name got a " (2)" from it: named back now that one's gone.
      for (const p of plates) {
        if (p.kind !== "existing" || p.wanted === undefined) continue;
        const current = latest.plates.find((each) => each.id === p.id);
        if (current && current.filename !== p.wanted) {
          const res = await printsApi.renamePlate(print.id, p.id, p.wanted);
          latest = res.print ?? latest;
        }
        const filename = latest.plates.find((each) => each.id === p.id)?.filename ?? p.filename;
        const named = (list: PlateItem[]) =>
          list.map((each) =>
            each.kind === "existing" && each.id === p.id ? { ...each, filename, wanted: undefined } : each,
          );
        plates = named(plates);
        setPlateItems(named);
      }
      {
        // Only plates still on the model: one another tab took away meanwhile leaves the list, as the order would be
        // refused with it in. Reorder needs an exhaustive id list; plates this dialog never saw go after, in order.
        const present = new Set(latest.plates.map((each) => each.id));
        const stillThere = (list: PlateItem[]) => list.filter((p) => p.kind !== "existing" || present.has(p.id));
        plates = stillThere(plates);
        setPlateItems(stillThere);
        const known = plates.flatMap((p) => (p.kind === "existing" ? [p.id] : []));
        const knownIds = new Set(known);
        const unknown = latest.plates
          .filter((p) => !knownIds.has(p.id))
          .toSorted((a, b) => a.position - b.position)
          .map((p) => p.id);
        if (platesMoved) {
          const reorderRes = await printsApi.reorderPlates(print.id, [...known, ...unknown]);
          latest = reorderRes.print ?? latest;
          // Sent, so a retry after a later step fails doesn't send it again over one another tab chose since.
          setPlatesMoved(false);
        }
      }

      // Each change that's done leaves what's staged, so a retry after a later step fails sends only what's left.
      for (const id of removedSupportingIds) {
        // One another tab took away already, or whose answer was lost, is as good as done: the model is read to be sure
        // it's gone, as no view of it, and the dialog goes on from what it read, which no longer lists the file.
        const res = await printsApi.deleteFile(print.id, id).catch(async (err: unknown) => {
          const now = await printsApi.get(print.id, { record: false }).catch(() => null);
          if (!now || (now.supporting_files ?? []).some((file) => file.id === id)) throw err;
          return { print: now };
        });
        latest = res.print ?? latest;
        setRemovedSupportingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      for (const item of supportingList) {
        if (item.kind !== "existing" || !item.renamedTo) continue;
        // One that's gone is read to be sure, as no view of it, and leaves the list; the rest of the save goes on.
        const res = await printsApi.renameFile(print.id, item.file.id, item.renamedTo).catch(async (err: unknown) => {
          const now = await printsApi.get(print.id, { record: false }).catch(() => null);
          if (!now || (now.supporting_files ?? []).some((file) => file.id === item.file.id)) throw err;
          return { print: now, gone: true };
        });
        latest = res.print ?? latest;
        if ("gone" in res) {
          renamesGone.push(item.file.filename);
          setSupportingItems((current) => current.filter((entry) => entry !== item));
          continue;
        }
        // Named as the server named it now, so a later rename is measured from that, not from the name it had.
        const renamed = latest.supporting_files?.find((file) => file.id === item.file.id) ?? {
          ...item.file,
          filename: item.renamedTo,
        };
        setSupportingItems((current) => current.map((entry) => (entry === item ? existingItem(renamed) : entry)));
      }
      for (const item of supportingList) {
        if (item.kind !== "new") continue;
        // Only one picked as a sliced print may take the prepared slot: renamed to one here, it's still an attachment.
        const res = await printsApi.uploadFile(print.id, item.file, {
          keepPrepared: preparedAdded.current || !isPreparedName(item.picked),
        });
        if (res.prepared) preparedAdded.current = true;
        latest = res.print ?? latest;
        // By the id the server gave it: a file another tab added meanwhile is new to this list too, and isn't this one.
        const stored = latest.supporting_files?.find((file) => file.id === res.file_id);
        // Up now: listed as the model's own file, and not sent again.
        setSupportingItems((current) =>
          stored
            ? current.map((entry) => (entry === item ? existingItem(stored) : entry))
            : current.filter((entry) => entry !== item),
        );
      }

      onUpdated(latest);
      const gone = goneSaid();
      if (unsavedPhotos.length) {
        setError(
          [t("models:edit.photosNotSaved", { names: unsavedPhotos.join(", ") }), gone].filter(Boolean).join(" "),
        );
        return;
      }
      showToast(gone ? { message: gone, severity: "warning" } : { message: t("models:edit.updateSuccess") });
      onClose();
    } catch (err) {
      onUpdated(latest);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      // An error with nothing to say (an answer that couldn't be read) still says something.
      setError(
        [err instanceof Error && err.message ? err.message : t("models:edit.updateFailed"), goneSaid()]
          .filter(Boolean)
          .join(" "),
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
                      disabled={saving}
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
                const filename = p.kind === "existing" ? (p.wanted ?? p.filename) : p.file.name;
                const folder = p.kind === "existing" ? p.folder : null;
                const packedWith = p.kind === "new" ? p.packedWith.map((file) => file.name).join(", ") : "";
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
                      <Typography variant="body2" noWrap title={filename}>
                        {filename}
                      </Typography>
                      {packedWith && (
                        <Typography variant="caption" color="text.secondary" noWrap component="div" title={packedWith}>
                          + {packedWith}
                        </Typography>
                      )}
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
                    <IconButton
                      size="small"
                      disabled={saving || plateItems.length <= 1}
                      onClick={() => removePlateItem(key)}
                    >
                      <DeleteIcon fontSize="small" color="error" />
                    </IconButton>
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
                  void onAddFiles(e.target.files, "model");
                  e.target.value = "";
                }}
              />
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">{t("models:supporting.title")}</Typography>
              <HelpTip text={t("models:supporting.editHelp")} />
            </Stack>
            <Stack spacing={1}>
              {supportingLoading && <Skeleton variant="rounded" height={38} />}
              {supportingLoadFailed && (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={readSupportingFiles}>
                      {t("common:retry")}
                    </Button>
                  }
                >
                  {t("models:supporting.loadFailed")}
                </Alert>
              )}
              {!supportingLoading && !supportingLoadFailed && !supportingItems.length && (
                <Typography variant="body2" color="text.secondary">
                  {t("models:supporting.editEmpty")}
                </Typography>
              )}
              {supportingItems.map((item) => {
                const key = supportingKey(item);
                const name = supportingName(item);
                const folder = item.kind === "existing" ? item.file.folder : null;
                const openMenu = (anchor: FileMenuAnchor) => setSupportingMenu({ key, anchor });
                return (
                  <Stack
                    key={key}
                    direction="row"
                    alignItems="center"
                    spacing={1.25}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!saving) openMenu({ top: event.clientY, left: event.clientX });
                    }}
                    sx={(theme) => ({
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      pl: 0.75,
                      pr: 0.5,
                      py: 0.5,
                      "--landed": alpha(theme.palette.primary.main, 0.16),
                      ...(item.kind === "new" && {
                        animation: `${landed} 1.2s ease-out`,
                        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                      }),
                    })}
                  >
                    <TypeTile filename={name} size={28} />
                    <Typography variant="body2" noWrap title={inFolder(name, folder)} sx={{ flex: 1, minWidth: 0 }}>
                      {inFolder(name, folder)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {formatFileSize(item.file.size)}
                    </Typography>
                    {item.kind === "new" && <Chip label={t("models:edit.newBadge")} size="small" />}
                    <IconButton
                      size="small"
                      disabled={saving}
                      aria-label={t("models:supporting.moreActionsNamed", { name: inFolder(name, folder) })}
                      aria-haspopup="menu"
                      onClick={(event) => openMenu({ element: event.currentTarget })}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                );
              })}
              <Button
                size="small"
                disabled={saving}
                startIcon={<UploadFileIcon fontSize="small" />}
                onClick={() => addSupportingInputRef.current?.click()}
                sx={{ alignSelf: "flex-start" }}
              >
                {t("models:edit.addFiles")}
              </Button>
              <input
                ref={addSupportingInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void onAddFiles(e.target.files, "supporting");
                  e.target.value = "";
                }}
              />
            </Stack>
            {(() => {
              const target = supportingMenu
                ? supportingItems.find((item) => supportingKey(item) === supportingMenu.key)
                : undefined;
              return (
                <SupportingFileMenu
                  anchor={target ? (supportingMenu?.anchor ?? null) : null}
                  onClose={() => setSupportingMenu(null)}
                  // A file still to upload has no address yet.
                  onOpenInTab={
                    target?.kind === "existing"
                      ? () =>
                          window.open(printsApi.supportingFileUrl(target.file, true), "_blank", "noopener,noreferrer")
                      : undefined
                  }
                  onRename={target ? () => setRenamingKey(supportingKey(target)) : undefined}
                  onRemove={target ? () => removeSupportingItem(supportingKey(target)) : undefined}
                />
              );
            })()}
            <RenameDialog
              value={(() => {
                const target = supportingItems.find((item) => supportingKey(item) === renamingKey);
                return target ? supportingName(target) : null;
              })()}
              title={t("models:supporting.renameTitle")}
              maxLength={255}
              onClose={() => setRenamingKey(null)}
              onSave={(name) => {
                if (renamingKey) renameSupportingItem(renamingKey, name);
              }}
            />
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
          // Not until the model's supporting files are in the list, nor after a read of them failed until a retry
          // brings them, nor while files just picked are being sorted: a save before would leave them out of it.
          disabled={saving || adding > 0 || supportingLoading || supportingLoadFailed}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t("models:edit.update")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
