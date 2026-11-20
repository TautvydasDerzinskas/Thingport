import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import type { Print, PrintFile } from "../../api/prints";
import RenameDialog from "../RenameDialog";
import SupportingFileChips from "./SupportingFileChips";
import SupportingFileMenu, { type FileMenuAnchor } from "./SupportingFileMenu";
import SupportingFileViewer from "./SupportingFileViewer";
import type { useSupportingFiles } from "./useSupportingFiles";

type Actions = ReturnType<typeof useSupportingFiles>;

type Props = {
  print: Print;
  /** The page's, so the header's "Add supporting files" shows its uploads here too. Its file input is the page's
   *  (SupportingFilesInput). */
  actions: Omit<Actions, "bindInput" | "onPicked">;
  /** The owner's own model, and not a tool's: files can be added, renamed and removed. */
  canEdit: boolean;
};

/** The file input "Add supporting files" opens. The page keeps it apart from the list, in place while another model
 *  loads: the header's menu, still the last model's then, opens it too. */
export function SupportingFilesInput({ actions }: { actions: Pick<Actions, "bindInput" | "onPicked"> }) {
  const { bindInput, onPicked } = actions;
  return <input ref={bindInput} type="file" multiple hidden onChange={(event) => onPicked(event.currentTarget)} />;
}

/** A model's supporting files on its page: attachments under its pictures, each opening in the viewer. Nothing shows
 *  while it has none; its owner adds them from the ⋮ menu or Edit model. */
export default function SupportingFiles({ print, actions: fileActions, canEdit }: Props) {
  const { t } = useTranslation(["models"]);
  const files = useMemo(() => print.supporting_files ?? [], [print.supporting_files]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: FileMenuAnchor } | null>(null);
  const [renaming, setRenaming] = useState<PrintFile | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linked = searchParams.get("file");

  // A copied link opens the model with that file in the viewer, once: a rename or an upload hands over a new list, and
  // what was picked since stays. Closing the viewer drops the link, so the same one opens it again; going Back past the
  // link closes the viewer it opened, but not one opened from the list.
  const opened = useRef<string | null>(null);
  const openedByLink = useRef(false);
  useEffect(() => {
    if (!linked) {
      opened.current = null;
      if (openedByLink.current) setViewing(null);
      openedByLink.current = false;
      return;
    }
    if (opened.current === linked) return;
    // A link to a file that isn't there (taken away in another tab, then gone Back to): the viewer another link opened
    // doesn't stay open under it. Not held as opened, so it opens should the file be listed after all.
    if (!files.some((file) => file.id === linked)) {
      opened.current = null;
      if (openedByLink.current) setViewing(null);
      openedByLink.current = false;
      return;
    }
    opened.current = linked;
    openedByLink.current = true;
    setViewing(linked);
  }, [linked, files]);

  const openViewer = useCallback((id: string) => {
    openedByLink.current = false;
    setViewing(id);
  }, []);

  const closeViewer = useCallback(() => {
    openedByLink.current = false;
    setViewing(null);
    if (!searchParams.has("file")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("file");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const byId = (id: string) => files.find((file) => file.id === id);
  const menuFile = menu ? byId(menu.id) : undefined;

  return (
    <>
      {(files.length > 0 || fileActions.uploading.length > 0) && (
        <SupportingFileChips
          files={files.map((file) => ({ key: file.id, name: file.filename, size: file.size, folder: file.folder }))}
          uploading={fileActions.uploading}
          busy={fileActions.downloading}
          onOpen={openViewer}
          onDownload={(id) => {
            const file = byId(id);
            if (file) void fileActions.download(file);
          }}
          onMenu={(id, anchor) => setMenu({ id, anchor })}
          onAdd={canEdit ? fileActions.pick : undefined}
          onDropFiles={canEdit ? (dropped) => void fileActions.upload(dropped) : undefined}
        />
      )}
      <SupportingFileMenu
        anchor={menuFile ? (menu?.anchor ?? null) : null}
        onClose={() => setMenu(null)}
        onOpen={menuFile ? () => openViewer(menuFile.id) : undefined}
        onOpenInTab={menuFile ? () => fileActions.openInTab(menuFile) : undefined}
        onDownload={menuFile ? () => void fileActions.download(menuFile) : undefined}
        onCopyLink={menuFile ? () => void fileActions.copyLink(menuFile) : undefined}
        onRename={canEdit && menuFile ? () => setRenaming(menuFile) : undefined}
        onRemove={canEdit && menuFile ? () => void fileActions.remove(menuFile) : undefined}
      />
      <SupportingFileViewer
        open={viewing !== null}
        files={files}
        selectedId={viewing}
        onSelect={setViewing}
        onClose={closeViewer}
        uploading={fileActions.uploading}
        onDownload={(file) => void fileActions.download(file)}
        onOpenInTab={fileActions.openInTab}
        onCopyLink={(file) => void fileActions.copyLink(file)}
        onAdd={canEdit ? fileActions.pick : undefined}
        onRename={canEdit ? setRenaming : undefined}
        onRemove={canEdit ? (file) => void fileActions.remove(file) : undefined}
      />
      <RenameDialog
        value={renaming ? renaming.filename : null}
        title={t("models:supporting.renameTitle")}
        maxLength={255}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (renaming) void fileActions.rename(renaming, name);
        }}
      />
    </>
  );
}
