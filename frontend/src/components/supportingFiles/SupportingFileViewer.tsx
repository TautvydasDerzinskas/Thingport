import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import { type PrintFile, printsApi } from "../../api/prints";
import { neutralTint } from "../../theme";
import { extOf } from "../../utils/fileExtensions";
import { formatFileSize } from "../../utils/fileSize";
import { previewTable } from "../../utils/delimited";
import MarkdownDescription from "../MarkdownDescription";
import { useToastHost } from "../ToastProvider";
import TypeTile from "./TypeTile";
import SupportingFileMenu, { type FileMenuAnchor } from "./SupportingFileMenu";
import type { UploadingFile } from "./useSupportingFiles";

// What the viewer shows itself, as the backend serves it inline (printFileService's inlineContentType); the rest it
// offers to download.
const PICTURES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const MARKDOWN = new Set(["md", "markdown"]);
const TABLES = new Set(["csv", "tsv"]);
const TEXT = new Set(["txt", "scad", "log", "nfo", "ini", "cfg", "conf", "json", "yaml", "yml"]);
// Text is read whole into the page, so a large one is downloaded instead.
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const TABLE_ROWS = 200;

type PreviewKind = "pdf" | "picture" | "markdown" | "table" | "text";

function previewKind(filename: string): PreviewKind | null {
  const ext = extOf(filename);
  if (ext === "pdf") return "pdf";
  if (PICTURES.has(ext)) return "picture";
  if (MARKDOWN.has(ext)) return "markdown";
  if (TABLES.has(ext)) return "table";
  if (TEXT.has(ext)) return "text";
  return null;
}

const NONE_UPLOADING: UploadingFile[] = [];

const metaOf = (file: PrintFile) => `${extOf(file.filename).toUpperCase() || "FILE"} · ${formatFileSize(file.size)}`;

function NoPreview({ file, onDownload, reason }: { file: PrintFile; onDownload: () => void; reason: "type" | "size" }) {
  const { t } = useTranslation(["models", "common"]);
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ flex: 1, minHeight: 0, p: 3, textAlign: "center" }}
    >
      <TypeTile filename={file.filename} size={72} />
      <Typography variant="body2" fontWeight={600}>
        {reason === "size"
          ? t("models:supporting.tooLargeToPreview")
          : t("models:supporting.noPreview", { type: extOf(file.filename).toUpperCase() || file.filename })}
      </Typography>
      <Button
        variant="contained"
        size="small"
        startIcon={<DownloadOutlinedIcon fontSize="small" />}
        onClick={onDownload}
      >
        {t("common:download")}
      </Button>
    </Stack>
  );
}

function TextPreview({
  file,
  kind,
  onDownload,
}: {
  file: PrintFile;
  kind: "markdown" | "table" | "text";
  onDownload: () => void;
}) {
  const { t } = useTranslation(["models"]);
  const [state, setState] = useState<{ id: string; text: string | null; failed: boolean } | null>(null);
  const url = printsApi.supportingFileUrl(file, true);
  const fileId = file.id;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setState({ id: fileId, text: await res.text(), failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: fileId, text: null, failed: true });
      });
    return () => controller.abort();
  }, [fileId, url]);

  if (!state || state.id !== file.id) {
    return (
      <Box sx={{ p: 2.5 }} aria-busy>
        {[92, 78, 85, 60, 70].map((width) => (
          <Skeleton key={width} variant="text" sx={{ width: `${width}%` }} />
        ))}
      </Box>
    );
  }
  if (state.failed || state.text === null) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ flex: 1, p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {t("models:supporting.previewFailed")}
        </Typography>
        <Button size="small" startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={onDownload}>
          {t("common:download")}
        </Button>
      </Stack>
    );
  }
  if (kind === "markdown") {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2 }}>
        <MarkdownDescription markdown={state.text} remote />
      </Box>
    );
  }
  if (kind === "table") {
    const { head, body, more } = previewTable(state.text, extOf(file.filename), TABLE_ROWS);
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Table size="small" stickyHeader>
          {head.length > 0 && (
            <TableHead>
              <TableRow>
                {head.map((cell, index) => (
                  <TableCell key={index} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
          )}
          <TableBody>
            {body.map((row, rowIndex) => (
              <TableRow key={rowIndex} hover>
                {row.map((cell, index) => (
                  <TableCell key={index} sx={{ whiteSpace: "nowrap" }}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {more && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ p: 1.5 }}>
            {t("models:supporting.firstRows", { count: TABLE_ROWS })}
          </Typography>
        )}
      </Box>
    );
  }
  return (
    <Box
      component="pre"
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        m: 0,
        px: 3,
        py: 2,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {state.text}
    </Box>
  );
}

/** Keyed by the file, so its loading state starts afresh with each. */
function PdfPreview({ file }: { file: PrintFile }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      {!loaded && <Skeleton variant="rectangular" sx={{ position: "absolute", inset: 0, height: "auto" }} />}
      {/* The browser's own PDF viewer: nothing to install, and it works offline and over plain HTTP. */}
      <Box
        component="iframe"
        src={printsApi.supportingFileUrl(file, true)}
        title={file.filename}
        onLoad={() => setLoaded(true)}
        sx={{ flex: 1, width: "100%", border: 0, bgcolor: (theme) => neutralTint(theme) }}
      />
    </Box>
  );
}

function FilePreview({ file, onDownload }: { file: PrintFile; onDownload: () => void }) {
  const kind = previewKind(file.filename);
  if (kind === "pdf") return <PdfPreview key={file.id} file={file} />;
  if (kind === "picture") {
    return (
      <Box
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: neutralTint(theme),
        })}
      >
        <Box
          component="img"
          src={printsApi.supportingFileUrl(file, true)}
          alt={file.filename}
          sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </Box>
    );
  }
  if (!kind) return <NoPreview file={file} onDownload={onDownload} reason="type" />;
  if (file.size > TEXT_PREVIEW_MAX_BYTES) return <NoPreview file={file} onDownload={onDownload} reason="size" />;
  return <TextPreview key={file.id} file={file} kind={kind} onDownload={onDownload} />;
}

type Props = {
  open: boolean;
  files: PrintFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  uploading?: UploadingFile[];
  onDownload: (file: PrintFile) => void;
  onOpenInTab: (file: PrintFile) => void;
  onCopyLink: (file: PrintFile) => void;
  /** The owner's alone. */
  onAdd?: () => void;
  onRename?: (file: PrintFile) => void;
  onRemove?: (file: PrintFile) => void;
};

/** A model's supporting files, read where they are: the list beside the one open. */
export default function SupportingFileViewer({
  open,
  files,
  selectedId,
  onSelect,
  onClose,
  uploading = NONE_UPLOADING,
  onDownload,
  onOpenInTab,
  onCopyLink,
  onAdd,
  onRename,
  onRemove,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const toastHost = useToastHost(open);
  const [menu, setMenu] = useState<FileMenuAnchor>(null);
  const file = files.find((item) => item.id === selectedId) ?? files[0] ?? null;

  // The last one removed leaves nothing to show.
  useEffect(() => {
    if (open && !files.length && !uploading.length) onClose();
  }, [open, files.length, uploading.length, onClose]);

  const list = (
    <Stack
      component="nav"
      aria-label={t("models:supporting.title")}
      direction={narrow ? "row" : "column"}
      sx={{
        p: 1.25,
        gap: 0.25,
        minHeight: 0,
        overflow: "auto",
        borderRight: narrow ? 0 : 1,
        borderBottom: narrow ? 1 : 0,
        borderColor: "divider",
      }}
    >
      {files.map((item) => {
        const current = item.id === file?.id;
        return (
          <ButtonBase
            key={item.id}
            onClick={() => onSelect(item.id)}
            aria-current={current ? "true" : undefined}
            title={item.filename}
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              px: 1,
              py: 0.75,
              maxWidth: narrow ? 220 : "none",
              borderRadius: "10px",
              justifyContent: "flex-start",
              textAlign: "left",
              bgcolor: current ? "action.selected" : "transparent",
              transition: "background-color 150ms",
              "&:hover": { bgcolor: current ? "action.selected" : "action.hover" },
              "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
            }}
          >
            <TypeTile filename={item.filename} size={34} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {item.filename}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {metaOf(item)}
              </Typography>
            </Box>
          </ButtonBase>
        );
      })}
      {uploading.map((item) => (
        <Stack
          key={item.key}
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{ px: 1, py: 0.75, flexShrink: 0 }}
          aria-busy
        >
          <TypeTile filename={item.name} size={34} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {item.name}
            </Typography>
            <LinearProgress
              aria-label={t("models:supporting.uploading", { name: item.name })}
              sx={{ mt: 0.75, height: 3, borderRadius: 2 }}
            />
          </Box>
        </Stack>
      ))}
      {onAdd && !narrow && <Box sx={{ flex: 1 }} />}
      {onAdd && (
        <ButtonBase
          onClick={onAdd}
          sx={{
            flexShrink: 0,
            gap: 1,
            py: 1,
            px: 1.5,
            borderRadius: "10px",
            border: "1.5px dashed",
            borderColor: alpha(theme.palette.text.secondary, 0.45),
            color: "text.secondary",
            transition: "border-color 150ms, color 150ms",
            "&:hover, &.Mui-focusVisible": { borderColor: "primary.main", color: "primary.main" },
          }}
        >
          <UploadFileOutlinedIcon fontSize="small" />
          <Typography variant="body2" fontWeight={700} sx={{ color: "inherit" }}>
            {t("models:supporting.addShort")}
          </Typography>
        </ButtonBase>
      )}
    </Stack>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={narrow}
      aria-labelledby="supporting-files-title"
      PaperProps={{
        ref: toastHost,
        sx: { height: narrow ? "100%" : "min(86vh, 860px)", display: "flex", flexDirection: "column" },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ pl: 2.5, pr: 1, py: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography id="supporting-files-title" variant="h6" component="h2" sx={{ fontSize: 18 }}>
          {t("models:supporting.title")}
        </Typography>
        <Box
          component="span"
          sx={(muiTheme) => ({
            px: 0.75,
            minWidth: 20,
            height: 20,
            borderRadius: "10px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11.5,
            fontWeight: 700,
            color: "text.secondary",
            bgcolor: neutralTint(muiTheme),
          })}
        >
          {files.length}
        </Box>
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={onClose} aria-label={t("common:close")}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: narrow ? "1fr" : "280px 1fr",
          gridTemplateRows: narrow ? "auto 1fr" : "1fr",
        }}
      >
        {list}
        {file ? (
          <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={700} noWrap title={file.filename}>
                  {file.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {metaOf(file)}
                </Typography>
              </Box>
              {narrow ? (
                <>
                  <Tooltip title={t("models:supporting.openInTab")}>
                    <IconButton
                      size="small"
                      aria-label={t("models:supporting.openInTab")}
                      onClick={() => onOpenInTab(file)}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("common:download")}>
                    <IconButton
                      size="small"
                      color="primary"
                      aria-label={t("common:download")}
                      onClick={() => onDownload(file)}
                    >
                      <DownloadOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Button size="small" startIcon={<OpenInNewIcon fontSize="small" />} onClick={() => onOpenInTab(file)}>
                    {t("models:supporting.newTab")}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    startIcon={<DownloadOutlinedIcon fontSize="small" />}
                    onClick={() => onDownload(file)}
                  >
                    {t("common:download")}
                  </Button>
                </>
              )}
              <Tooltip title={t("common:moreActions")}>
                <IconButton
                  size="small"
                  aria-label={t("common:moreActions")}
                  aria-haspopup="menu"
                  onClick={(event) => setMenu({ element: event.currentTarget })}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <FilePreview file={file} onDownload={() => onDownload(file)} />
            <SupportingFileMenu
              anchor={menu}
              onClose={() => setMenu(null)}
              onCopyLink={() => onCopyLink(file)}
              onRename={onRename ? () => onRename(file) : undefined}
              onRemove={onRemove ? () => onRemove(file) : undefined}
            />
          </Box>
        ) : (
          <Box />
        )}
      </Box>
    </Dialog>
  );
}
