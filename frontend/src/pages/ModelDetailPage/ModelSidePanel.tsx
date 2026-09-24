import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import FolderIcon from "@mui/icons-material/Folder";
import StorageIcon from "@mui/icons-material/Storage";
import LaunchIcon from "@mui/icons-material/Launch";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import type { Print } from "../../api/prints";
import type { AuthUser } from "../../api/auth";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import { dividerBorderColor } from "../../theme";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import SlicerFileMenu from "./SlicerFileMenu";
import RollingNumber from "../../components/RollingNumber";
import { formatFileSize } from "../../utils/fileSize";
import AuthorHoverCard from "../../components/AuthorHoverCard";
import DownloadPickerDialog from "./DownloadPickerDialog";

type Props = {
  print: Print;
  onSelectCategory: (id: string) => void;
  onUnauthorized?: () => void;
  /** Receives the updated print after a download or Open in {Slicer} bumps its print count. */
  onUpdated?: (print: Print) => void;
  /** Only used as a fallback when the print has neither an Author nor a plain `creator` string --
   *  a direct upload has no import-source author at all, so it shows the viewer's own identity
   *  instead of "Unknown", since every print here is the viewer's own. */
  viewer?: AuthUser | null;
};

/** The model detail page's right-hand summary card, sticky so it stays in view while the
 *  description/tags column scrolls: the full title, author (jumps to their author page), category (jumps back
 *  to the Models grid filtered to it), "Open in {Slicer}" (only when both a preference is set
 *  and this print has a slicer_url, and a pick of which file when there are several -- see
 *  useOpenInSlicer, shared with ModelActionsMenu's menu item),
 *  "Download model files" (the same picker-or-direct-download flow as ModelActionsMenu's
 *  Download, via useDownloadPrint so the two can't drift), view/print counts, and -- only for an
 *  actually-imported print, per source_provider -- when it was imported. */
export default function ModelSidePanel({ print, onSelectCategory, onUnauthorized, onUpdated, viewer }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const viewerAvatarUrl = useGravatarUrl(viewer?.email, 56);
  const { pickerOpen, setPickerOpen, downloading, handleDownload, downloadPlate, downloadAllZip, sortedPlates, recordUse } =
    useDownloadPrint(print, onUnauthorized, onUpdated);

  const { slicerOption, targets: slicerTargets } = useOpenInSlicer(print);
  const [slicerMenuAnchor, setSlicerMenuAnchor] = useState<HTMLElement | null>(null);

  const goToCategory = () => {
    if (!print.category_id) return;
    onSelectCategory(print.category_id);
    // Carries the category straight into the URL instead of navigating to plain "/models" and
    // letting ModelsPage's mount-time effects reconcile categoryId against the (momentarily
    // absent) ?category= param -- those two effects each only no-op once state and URL already
    // agree, so landing with them disagreeing made the grid flicker between the category and
    // "All" for a render or two before settling.
    navigate(`/models?category=${print.category_id}`);
  };

  const importedDate = print.source_provider
    ? new Date(print.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  const showViewerAsAuthor =
    !print.author?.name && !print.author?.handle && !print.creator && !print.source_provider && Boolean(viewer);
  const authorName =
    print.author?.name || print.author?.handle || print.creator || (showViewerAsAuthor ? viewer!.display_name : null);
  const authorAvatarUrl = print.author?.avatar_url || (showViewerAsAuthor ? viewerAvatarUrl : undefined);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: "12px",
        borderColor: dividerBorderColor,
        position: { xs: "static", md: "sticky" },
        // TopBar is sticky too (see its own doc comment) and sits above this in stacking order --
        // sticking at a fixed offset from the viewport top would land this panel right underneath
        // it once both are pinned simultaneously. --topbar-height (set by TopBar itself, since it
        // can wrap taller on narrow widths) keeps this just below it instead -- no extra gap added
        // on top, since TopBar's own pb: 2 already is that gap, now that it's real padding on the
        // sticky element itself rather than a separate margin outside it.
        top: "var(--topbar-height, 80px)",
      }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("models:detail.title")}
          </Typography>
          {/* Full title, wrapped -- unlike the page header, this box never truncates it. */}
          <Typography
            variant="body2"
            sx={{ color: (muiTheme) => muiTheme.thingport.headingText, overflowWrap: "anywhere" }}
          >
            {print.title || print.name}
          </Typography>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("models:detail.author")}
          </Typography>
          <AuthorHoverCard
            authorId={print.author ? print.author.id : SELF_AUTHOR_ID}
            viewer={viewer}
            disabled={!print.author && !showViewerAsAuthor}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{
                width: "fit-content",
                cursor: print.author || showViewerAsAuthor ? "pointer" : "default",
                color: (muiTheme) => muiTheme.thingport.headingText,
                ...(print.author || showViewerAsAuthor ? { "&:hover": { color: "primary.main" } } : undefined),
              }}
              onClick={() => {
                if (print.author) navigate(`/authors/${print.author.id}`);
                else if (showViewerAsAuthor) navigate(`/authors/${SELF_AUTHOR_ID}`);
              }}
            >
              <Avatar src={authorAvatarUrl || undefined} sx={{ width: 28, height: 28, fontSize: 13, color: "inherit !important" }}>
                {(authorName || "?").slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography variant="body2" sx={{ color: "inherit" }}>
                {authorName || t("models:card.unknownAuthor")}
              </Typography>
            </Stack>
          </AuthorHoverCard>
        </Box>

        {print.category_id && print.category_name && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("models:detail.category")}
            </Typography>
            <ButtonBase
              onClick={goToCategory}
              sx={{
                borderRadius: 1,
                px: 0.5,
                py: 0.25,
                mx: -0.5,
                gap: 0.75,
                color: (muiTheme) => muiTheme.thingport.headingText,
                "&:hover": { color: "primary.main" },
              }}
            >
              <FolderIcon fontSize="small" />
              <Typography variant="body2" fontWeight={600}>{print.category_name}</Typography>
            </ButtonBase>
          </Box>
        )}

        {typeof print.total_size === "number" && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("models:detail.size")}
            </Typography>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.75}
              title={t("models:detail.sizeHint")}
              sx={{ width: "fit-content", color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              <StorageIcon fontSize="small" />
              <Typography variant="body2" fontWeight={600}>{formatFileSize(print.total_size)}</Typography>
            </Stack>
          </Box>
        )}

        {slicerOption && slicerTargets.length > 0 && (
          <Button
            // One target: a plain link to it. Several: pick which (see SlicerFileMenu).
            {...(slicerTargets.length === 1
              ? { component: "a" as const, href: slicerTargets[0].href, onClick: recordUse }
              : { onClick: (e: React.MouseEvent<HTMLElement>) => setSlicerMenuAnchor(e.currentTarget), endIcon: <ArrowDropDownIcon /> })}
            startIcon={<LaunchIcon fontSize="small" />}
            fullWidth
            sx={{
              bgcolor: "background.paper",
              color: "primary.main",
              border: "1.5px solid",
              borderColor: "primary.main",
              "&:hover": { bgcolor: "action.hover", borderColor: "primary.dark" },
            }}
          >
            {t("models:detail.openInSlicer", { slicer: slicerOption.label })}
          </Button>
        )}
        {slicerOption && slicerTargets.length > 1 && (
          <SlicerFileMenu
            anchorEl={slicerMenuAnchor}
            onClose={() => setSlicerMenuAnchor(null)}
            slicerLabel={slicerOption.label}
            targets={slicerTargets}
            onOpen={recordUse}
            matchAnchorWidth
          />
        )}

        <Button
          onClick={handleDownload}
          disabled={downloading}
          startIcon={<DownloadIcon fontSize="small" />}
          fullWidth
          sx={{
            bgcolor: "primary.main",
            color: "primary.contrastText",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          {t("models:detail.downloadModelFiles")}
        </Button>

        <Stack direction="row" spacing={1.5}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={0.75}
            sx={{ flex: 1, py: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
          >
            <VisibilityIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={600}>{print.view_count}</Typography>
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={0.75}
            sx={{ flex: 1, py: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
          >
            <PrintIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={600}><RollingNumber value={print.print_count} /></Typography>
          </Stack>
        </Stack>

        {importedDate && (
          <Typography variant="caption" sx={{ textAlign: "right", fontSize: 12, color: "text.secondary" }}>
            {t("models:detail.imported", { date: importedDate })}
          </Typography>
        )}
      </Stack>

      <DownloadPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        downloading={downloading}
        sortedPlates={sortedPlates}
        downloadAllZip={downloadAllZip}
        downloadPlate={downloadPlate}
      />
    </Paper>
  );
}
