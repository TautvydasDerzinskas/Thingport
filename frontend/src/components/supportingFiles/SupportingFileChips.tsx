import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, keyframes } from "@mui/material/styles";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import { formatFileSize } from "../../utils/fileSize";
import { inFolder } from "../../utils/fileExtensions";
import { isFileDrag } from "../../utils/dragEvents";
import TypeTile from "./TypeTile";
import type { FileMenuAnchor } from "./SupportingFileMenu";
import type { UploadingFile } from "./useSupportingFiles";

export type ChipFile = { key: string; name: string; size?: number | null; folder?: string | null };

// Past this many, the last chip says how many more and opens them all, rather than the row running on.
const MAX_CHIPS = 8;

const NONE_UPLOADING: UploadingFile[] = [];

const appear = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;

const chipSx = {
  display: "inline-flex",
  alignItems: "center",
  maxWidth: 280,
  minWidth: 0,
  borderRadius: "10px",
  border: 1,
  borderColor: "divider",
  bgcolor: "background.paper",
  transition: "border-color 150ms, background-color 150ms",
  animation: `${appear} 200ms ease-out both`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

type Props = {
  files: ChipFile[];
  uploading?: UploadingFile[];
  /** A click: the viewer, where there is one. */
  onOpen: (key: string) => void;
  onDownload: (key: string) => void;
  /** The file's menu, at the pointer for a right-click. Without it a right-click is the browser's. */
  onMenu?: (key: string, anchor: FileMenuAnchor) => void;
  /** The owner's: a dashed chip that picks files to add, and the row takes files dropped on it. */
  onAdd?: () => void;
  onDropFiles?: (files: File[]) => void;
  /** No viewer to open the rest in: past the limit, the last chip shows every file in the row instead. */
  withoutViewer?: boolean;
};

/** A model's supporting files as attachments, under its pictures: type, name and size at a glance. */
export default function SupportingFileChips({
  files,
  uploading = NONE_UPLOADING,
  onOpen,
  onDownload,
  onMenu,
  onAdd,
  onDropFiles,
  withoutViewer = false,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const overflow = !expanded && files.length > MAX_CHIPS;
  const shown = overflow ? files.slice(0, MAX_CHIPS - 1) : files;
  const showRest = () => {
    if (!withoutViewer) {
      onOpen(files[MAX_CHIPS - 1].key);
      return;
    }
    setExpanded(true);
    // The button that had focus goes with it: focus moves on to the first file it showed.
    requestAnimationFrame(() =>
      rowRef.current?.querySelectorAll<HTMLElement>("[data-chip-open]")[MAX_CHIPS - 1]?.focus(),
    );
  };

  const dropProps = onDropFiles
    ? {
        onDragOver: (event: DragEvent) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          // Only on leaving the row, not on passing from one chip to the next.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setDragging(false);
          onDropFiles(Array.from(event.dataTransfer.files));
        },
      }
    : {};

  return (
    <Box
      // A fieldset has layout rules of its own, and this is only a row of attachments.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      aria-label={t("models:supporting.title")}
      ref={rowRef}
      {...dropProps}
      sx={(theme) => ({
        mt: 1,
        mx: -0.5,
        mb: -0.5,
        p: 0.5,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1,
        borderRadius: "12px",
        outline: "1.5px dashed",
        outlineColor: dragging ? theme.palette.primary.main : "transparent",
        bgcolor: dragging ? alpha(theme.palette.primary.main, 0.06) : "transparent",
        transition: "outline-color 150ms, background-color 150ms",
      })}
    >
      {shown.map((file) => (
        <Box
          key={file.key}
          onContextMenu={
            onMenu
              ? (event) => {
                  event.preventDefault();
                  onMenu(file.key, { top: event.clientY, left: event.clientX });
                }
              : undefined
          }
          sx={{
            ...chipSx,
            "&:hover, &:focus-within": { borderColor: "text.secondary", bgcolor: "action.hover" },
            "& .chip-download": { opacity: 0.6, transition: "opacity 150ms" },
            "&:hover .chip-download, &:focus-within .chip-download": { opacity: 1 },
          }}
        >
          <ButtonBase
            data-chip-open
            onClick={() => onOpen(file.key)}
            title={inFolder(file.name, file.folder)}
            sx={{
              gap: 1,
              pl: 0.625,
              pr: 0.5,
              py: 0.625,
              minWidth: 0,
              borderRadius: "10px",
              justifyContent: "flex-start",
              textAlign: "left",
              "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
            }}
          >
            <TypeTile filename={file.name} size={28} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }} noWrap>
                {inFolder(file.name, file.folder)}
              </Typography>
              {typeof file.size === "number" && (
                <Typography sx={{ fontSize: 11.5, lineHeight: 1.3, color: "text.secondary" }} noWrap>
                  {formatFileSize(file.size)}
                </Typography>
              )}
            </Box>
          </ButtonBase>
          <Tooltip title={t("common:download")}>
            <IconButton
              className="chip-download"
              size="small"
              aria-label={t("models:supporting.downloadNamed", { name: inFolder(file.name, file.folder) })}
              onClick={() => onDownload(file.key)}
              sx={{ mr: 0.375, color: "text.secondary" }}
            >
              <DownloadOutlinedIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      {overflow && (
        <ButtonBase
          onClick={showRest}
          sx={{
            ...chipSx,
            px: 1.5,
            height: 44,
            fontSize: 13,
            fontWeight: 700,
            color: "text.secondary",
            "&:hover": { borderColor: "text.secondary", bgcolor: "action.hover" },
            "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
          }}
        >
          {t("models:supporting.more", { count: files.length - shown.length })}
        </ButtonBase>
      )}
      {uploading.map((file) => (
        <Box key={file.key} aria-busy sx={{ ...chipSx, gap: 1, pl: 0.625, pr: 1.25, py: 0.625 }}>
          <TypeTile filename={file.name} size={28} />
          <Box sx={{ minWidth: 0, width: 140 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }} noWrap>
              {file.name}
            </Typography>
            <LinearProgress
              aria-label={t("models:supporting.uploading", { name: file.name })}
              sx={{ mt: 0.75, height: 3, borderRadius: 2 }}
            />
          </Box>
        </Box>
      ))}
      {onAdd && (
        <Tooltip title={t("models:supporting.add")}>
          <ButtonBase
            onClick={onAdd}
            aria-label={t("models:supporting.add")}
            sx={(theme) => ({
              width: 44,
              height: 44,
              borderRadius: "10px",
              border: "1.5px dashed",
              borderColor: alpha(theme.palette.text.secondary, 0.55),
              color: "text.secondary",
              transition: "border-color 150ms, color 150ms, background-color 150ms",
              "&:hover, &.Mui-focusVisible": {
                borderColor: "primary.main",
                color: "primary.main",
                bgcolor: alpha(theme.palette.primary.main, 0.06),
              },
            })}
          >
            <UploadFileOutlinedIcon fontSize="small" />
          </ButtonBase>
        </Tooltip>
      )}
    </Box>
  );
}
