import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
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
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import LinkIcon from "@mui/icons-material/Link";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { type PrintFile, printsApi } from "../../api/prints";
import { neutralTint } from "../../theme";
import { extOf } from "../../utils/fileExtensions";
import { formatFileSize } from "../../utils/fileSize";
import { previewTable } from "../../utils/delimited";
import MarkdownDescription from "../MarkdownDescription";
import { useToastHost } from "../ToastProvider";
import TypeTile from "./TypeTile";

// Text is read whole into the page, so a large one is downloaded instead.
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const TABLE_ROWS = 200;
// A row of a million commas is well under the size a preview reads: past this many columns, the rest are left out.
const TABLE_COLUMNS = 50;

/** The file as the server shows it in place (`?inline=1`): a PDF or a picture as itself, anything else as plain text.
 *  Only a file whose caps say how it shows is asked for so; the server downloads anything else regardless. */
const inlineUrl = (file: PrintFile) => printsApi.fileUrl(`${file.url}?inline=1`);

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
      <TypeTile kind={file.content_kind} view={file.caps?.view} size={72} />
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
  const url = inlineUrl(file);
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
    const { head, body, more, wider } = previewTable(state.text, extOf(file.filename), TABLE_ROWS, TABLE_COLUMNS);
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
        {(more || wider) && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ p: 1.5 }}>
            {[
              more && t("models:supporting.firstRows", { count: TABLE_ROWS }),
              wider && t("models:supporting.firstColumns", { count: TABLE_COLUMNS }),
            ]
              .filter(Boolean)
              .join(" · ")}
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
        src={inlineUrl(file)}
        title={file.filename}
        onLoad={() => setLoaded(true)}
        sx={{ flex: 1, width: "100%", border: 0, bgcolor: (theme) => neutralTint(theme) }}
      />
    </Box>
  );
}

function FilePreview({ file, onDownload }: { file: PrintFile; onDownload: () => void }) {
  const kind = file.caps?.view ?? null;
  if (kind === "pdf") return <PdfPreview key={file.id} file={file} />;
  if (kind === "image") {
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
          src={inlineUrl(file)}
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
  onDownload: (file: PrintFile) => void;
  onCopyLink: (file: PrintFile) => void;
};

/** A model's supporting files, read where they are: the list beside the one open. */
export default function SupportingFileViewer({
  open,
  files,
  selectedId,
  onSelect,
  onClose,
  onDownload,
  onCopyLink,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const toastHost = useToastHost(open);
  const file = files.find((item) => item.id === selectedId) ?? files[0] ?? null;
  // A new tab shows what the page would, so only a file that shows in place gets one.
  const openInTab = (item: PrintFile) => window.open(inlineUrl(item), "_blank", "noopener,noreferrer");

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
            <TypeTile kind={item.content_kind} view={item.caps?.view} size={34} />
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
                  {file.caps?.view && (
                    <Tooltip title={t("models:supporting.openInTab")}>
                      <IconButton
                        size="small"
                        aria-label={t("models:supporting.openInTab")}
                        onClick={() => openInTab(file)}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
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
                  {file.caps?.view && (
                    <Button size="small" startIcon={<OpenInNewIcon fontSize="small" />} onClick={() => openInTab(file)}>
                      {t("models:supporting.newTab")}
                    </Button>
                  )}
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
              <Tooltip title={t("models:supporting.copyLink")}>
                <IconButton size="small" aria-label={t("models:supporting.copyLink")} onClick={() => onCopyLink(file)}>
                  <LinkIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <FilePreview file={file} onDownload={() => onDownload(file)} />
          </Box>
        ) : (
          <Box />
        )}
      </Box>
    </Dialog>
  );
}
