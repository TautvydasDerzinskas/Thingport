import { useMemo, useState } from "react";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useTranslation } from "react-i18next";
import type { ContentKind, FileCaps } from "../../api/prints";
import type { ModelFile } from "../../pages/ModelDetailPage/useOpenInSlicer";
import { useSendTo } from "../../pages/ModelDetailPage/useSendTo";
import { legacyCaps } from "../../utils/fileCaps";
import { formatFileSize } from "../../utils/fileSize";
import SupportingFileMenu, { type FileMenuAnchor } from "./SupportingFileMenu";
import TypeTile from "./TypeTile";

/** One of the files kept beside a model's plates, as the list shows it. */
export type SupportingItem = {
  key: string;
  name: string;
  folder: string | null;
  size: number | null;
  /** API-relative; null where there's nothing to download, as for a partner's file it gave no address for. */
  url: string | null;
  kind?: ContentKind;
  caps?: FileCaps;
};

/** As Send to takes a file: by the key it sends (the file's own id) and the name each place's file types are read from. */
function toModelFile(item: SupportingItem): ModelFile {
  return {
    key: item.key,
    url: item.url ?? "",
    filename: item.name,
    launchFilename: item.name,
    index: -1,
    plate: null,
    folder: item.folder,
    caps: item.caps ?? legacyCaps(item.name, "supporting"),
  };
}

/** A model's supporting files: each with its type, folder and size, and a menu (also on right-click) to download it or,
 *  with `sendTo`, send it to one of the user's places. */
export default function SupportingFilesList({
  items,
  onDownload,
  sendTo,
}: {
  items: SupportingItem[];
  onDownload: (item: SupportingItem) => void;
  sendTo?: { printId: string; onUnauthorized?: () => void };
}) {
  const { t } = useTranslation(["models"]);
  const [menu, setMenu] = useState<{ item: SupportingItem; anchor: FileMenuAnchor } | null>(null);
  // Only the open menu's file is offered to the places, each filtering by its own file types.
  const entry = useMemo(() => (menu && sendTo && menu.item.url ? toModelFile(menu.item) : null), [menu, sendTo]);
  const send = useSendTo(sendTo?.printId ?? "", entry, sendTo?.onUnauthorized);
  const targets = useMemo(() => [...send.menu, ...send.buttons], [send.menu, send.buttons]);
  const opened = menu?.item;

  return (
    <>
      <List dense disablePadding>
        {items.map((item) => {
          const label = t("models:supporting.actionsFor", { name: item.name });
          const details = [item.folder, item.size == null ? null : formatFileSize(item.size)]
            .filter(Boolean)
            .join(" · ");
          return (
            <ListItem
              key={item.key}
              disableGutters
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ item, anchor: { top: event.clientY, left: event.clientX } });
              }}
              secondaryAction={
                <Tooltip title={label}>
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label={label}
                    aria-haspopup="menu"
                    onClick={(event) => setMenu({ item, anchor: { element: event.currentTarget } })}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemIcon sx={{ minWidth: 44 }}>
                <TypeTile kind={item.kind} view={item.caps?.view} size={32} />
              </ListItemIcon>
              <ListItemText
                primary={item.name}
                secondary={details || undefined}
                primaryTypographyProps={{ noWrap: true, title: item.name }}
              />
            </ListItem>
          );
        })}
      </List>
      <SupportingFileMenu
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        onDownload={opened?.url ? () => onDownload(opened) : undefined}
        sendTargets={targets}
        sending={send.sending}
        onSend={(target) => void send.send(target)}
      />
    </>
  );
}
