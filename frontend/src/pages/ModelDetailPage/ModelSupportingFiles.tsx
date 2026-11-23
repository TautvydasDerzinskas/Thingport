import { useMemo } from "react";
import type { Print } from "../../api/prints";
import SupportingFilesList, { type SupportingItem } from "../../components/supportingFiles/SupportingFilesList";
import { useDownloadPrint } from "./useDownloadPrint";

/** The model page's Supporting files tab: the files kept beside its plates, to download or send. */
export default function ModelSupportingFiles({ print, onUnauthorized }: { print: Print; onUnauthorized?: () => void }) {
  const { downloadSupportingFile } = useDownloadPrint(print, onUnauthorized);
  const items = useMemo<SupportingItem[]>(
    () =>
      (print.supporting_files ?? []).map((file) => ({
        key: file.id,
        name: file.filename,
        folder: file.folder ?? null,
        size: file.size,
        url: file.url,
        kind: file.content_kind,
        caps: file.caps,
      })),
    [print.supporting_files],
  );
  const sendTo = useMemo(() => ({ printId: print.id, onUnauthorized }), [print.id, onUnauthorized]);
  return (
    <SupportingFilesList
      items={items}
      onDownload={(item) => {
        if (item.url) void downloadSupportingFile({ url: item.url, filename: item.name });
      }}
      sendTo={sendTo}
    />
  );
}
