import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import ButtonBase from "@mui/material/ButtonBase";
import FolderIcon from "@mui/icons-material/Folder";
import TuneIcon from "@mui/icons-material/Tune";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import type { Print } from "../../api/prints";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { UnauthorizedError } from "../../api/client";
import { useToast } from "../../components/ToastProvider";
import type { AuthUser } from "../../api/auth";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import { switchSlicer } from "../../hooks/useSlicerPreference";
import { dividerBorderColor } from "../../theme";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import { hasGeneratorScript } from "./useCustomize";
import NormalizedOpenButton from "./NormalizedOpenButton";
import ModelFileSelect from "./ModelFileSelect";
import OpenInSlicerButton from "./OpenInSlicerButton";
import { useNormalizedOpen } from "./useNormalizedOpen";
import RollingNumber from "../../components/RollingNumber";
import { formatFileSize } from "../../utils/fileSize";
import AuthorHoverCard from "../../components/AuthorHoverCard";

type Props = {
  print: Print;
  onSelectCategory: (id: string) => void;
  onUnauthorized?: () => void;
  onUpdated?: (print: Print) => void;
  /** Shown as the author of a direct upload, which has none. */
  viewer?: AuthUser | null;
};

/** The detail page's sticky summary card. */
export default function ModelSidePanel({ print, onSelectCategory, onUnauthorized, onUpdated, viewer }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const showToast = useToast();
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const viewerAvatarUrl = useGravatarUrl(viewer?.email, 56);
  const { downloading, downloadFile, downloadAllZip, recordUse } = useDownloadPrint(print, onUnauthorized, onUpdated);

  const { slicerOption, slicerOptions, files, canOpen, normalizedTargetFor } = useOpenInSlicer(print);
  // Every action below applies to this file; the first until one is picked.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedFile = files.find((file) => file.key === selectedKey) ?? files[0] ?? null;
  const normalizedTarget = normalizedTargetFor(selectedFile);
  const normalized = useNormalizedOpen(print.id, recordUse, onUnauthorized);

  const goToCategory = () => {
    if (!print.category_id) return;
    onSelectCategory(print.category_id);
    // Go straight to the filtered URL; landing on plain /models makes the grid flicker.
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
        // Stick just below the sticky TopBar, which can wrap taller.
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
              <Avatar
                src={authorAvatarUrl || undefined}
                sx={{ width: 28, height: 28, fontSize: 13, color: "inherit !important" }}
              >
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
              <Typography variant="body2" fontWeight={600}>
                {print.category_name}
              </Typography>
              {print.category_source === "ai" && (
                <Chip size="small" label={t("models:aiCategorization.byAi")} color="secondary" variant="outlined" />
              )}
            </ButtonBase>
          </Box>
        )}

        {hasGeneratorScript(print) && (
          <Tooltip title={t("models:detail.generatedFromScriptHint")}>
            <Chip
              size="small"
              icon={<TuneIcon />}
              label={t("models:detail.generatedFromScript")}
              variant="outlined"
              sx={{ alignSelf: "flex-start" }}
            />
          </Tooltip>
        )}

        {/* Why there is nothing to customise here, which otherwise looks like a model that never had a script. */}
        {print.generator_script_withheld && !hasGeneratorScript(print) && (
          <Tooltip title={t("models:detail.scriptWithheldHint")}>
            <Chip
              size="small"
              icon={<LockOutlinedIcon />}
              label={t("models:detail.scriptWithheld")}
              variant="outlined"
              sx={{ alignSelf: "flex-start", color: "text.secondary" }}
            />
          </Tooltip>
        )}

        {print.ai_suggestion && (
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                {t("models:aiCategorization.suggestionLabel")}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {print.ai_suggestion.category_path} · {Math.round(print.ai_suggestion.confidence * 100)}%
              </Typography>
              {print.ai_suggestion.reason && (
                <Typography variant="caption" color="text.secondary">
                  {print.ai_suggestion.reason}
                </Typography>
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={suggestionBusy}
                  onClick={() =>
                    void (async () => {
                      setSuggestionBusy(true);
                      try {
                        const result = await aiCategorizationApi.accept(print.id);
                        onUpdated?.(result.print);
                        showToast({ message: t("models:aiCategorization.accepted") });
                      } catch (err) {
                        if (err instanceof UnauthorizedError) onUnauthorized?.();
                        else
                          showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
                      } finally {
                        setSuggestionBusy(false);
                      }
                    })()
                  }
                >
                  {t("models:aiCategorization.accept")}
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  disabled={suggestionBusy}
                  onClick={() =>
                    void (async () => {
                      setSuggestionBusy(true);
                      try {
                        const result = await aiCategorizationApi.reject(print.id);
                        onUpdated?.(result.print);
                        showToast({ message: t("models:aiCategorization.rejected") });
                      } catch (err) {
                        if (err instanceof UnauthorizedError) onUnauthorized?.();
                        else
                          showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
                      } finally {
                        setSuggestionBusy(false);
                      }
                    })()
                  }
                >
                  {t("models:aiCategorization.reject")}
                </Button>
              </Stack>
            </Stack>
          </Paper>
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
              <Typography variant="body2" fontWeight={600}>
                {formatFileSize(print.total_size)}
              </Typography>
            </Stack>
          </Box>
        )}

        {selectedFile && files.length > 1 && (
          <ModelFileSelect files={files} selected={selectedFile} onSelect={(file) => setSelectedKey(file.key)} />
        )}
        {selectedFile && (
          <OpenInSlicerButton
            file={selectedFile}
            canOpen={canOpen}
            slicerOption={slicerOption}
            slicerOptions={slicerOptions}
            onOpened={(slicerId) => {
              recordUse();
              void switchSlicer(slicerId);
            }}
            downloading={downloading}
            onDownload={() => void downloadFile(selectedFile)}
            // The zip holds the plates and supporting files, not the prepared print.
            zipCount={files.filter((file) => file.plate).length}
            onDownloadZip={() => void downloadAllZip()}
          />
        )}
        {slicerOption && normalizedTarget && (
          <NormalizedOpenButton
            targets={[normalizedTarget]}
            slicerLabel={slicerOption.label}
            stateOf={normalized.stateOf}
            open={normalized.open}
            onPick={() => {}}
          />
        )}

        <Stack direction="row" spacing={1.5}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={0.75}
            sx={{ flex: 1, py: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
          >
            <VisibilityIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={600}>
              {print.view_count}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={0.75}
            sx={{ flex: 1, py: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
          >
            <PrintIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={600}>
              <RollingNumber value={print.print_count} />
            </Typography>
          </Stack>
        </Stack>

        {importedDate && (
          <Typography variant="caption" sx={{ textAlign: "right", fontSize: 12, color: "text.secondary" }}>
            {t("models:detail.imported", { date: importedDate })}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
