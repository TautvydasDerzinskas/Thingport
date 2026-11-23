import { useMemo } from "react";
import type { Print } from "../../api/prints";
import SupportingFileViewer from "../../components/supportingFiles/SupportingFileViewer";
import SupportingFilesList, { type SupportingItem } from "../../components/supportingFiles/SupportingFilesList";
import { useDownloadPrint } from "./useDownloadPrint";
import { useViewedFile } from "./useViewedFile";

type Props = { print: Print; onUnauthorized?: () => void };

const NO_FILES: NonNullable<Print["supporting_files"]> = [];

/** The model page's Supporting files tab: the files kept beside its plates, to open, download, link to or send. */
export default function ModelSupportingFiles({ print, onUnauthorized }: Props) {
  const files = print.supporting_files ?? NO_FILES;
  const { downloadSupportingFile } = useDownloadPrint(print, onUnauthorized);
  const viewer = useViewedFile(files);
  const items = useMemo<SupportingItem[]>(
    () =>
      files.map((file) => ({
        key: file.id,
        name: file.filename,
        folder: file.folder ?? null,
        size: file.size,
        url: file.url,
        kind: file.content_kind,
        caps: file.caps,
      })),
    [files],
  );
  const sendTo = useMemo(() => ({ printId: print.id, onUnauthorized }), [print.id, onUnauthorized]);
  return (
    <SupportingFilesList
      items={items}
      onOpen={(item) => viewer.open(item.key)}
      onDownload={(item) => {
        if (item.url) void downloadSupportingFile({ url: item.url, filename: item.name });
      }}
      onCopyLink={(item) => viewer.copyLink(item.key)}
      sendTo={sendTo}
    />
  );
}

/** The viewer, on the page itself rather than in the tab, so a link to a file opens it whichever tab is showing. */
export function ModelSupportingFileViewer({ print, onUnauthorized }: Props) {
  const files = print.supporting_files ?? NO_FILES;
  const { downloadSupportingFile } = useDownloadPrint(print, onUnauthorized);
  const viewer = useViewedFile(files);
  return (
    <SupportingFileViewer
      open={Boolean(viewer.viewing)}
      files={files}
      selectedId={viewer.viewing}
      onSelect={viewer.open}
      onClose={viewer.close}
      onDownload={(file) => void downloadSupportingFile({ url: file.url, filename: file.filename })}
      onCopyLink={(file) => viewer.copyLink(file.id)}
    />
  );
}
