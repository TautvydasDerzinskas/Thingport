import { useEffect, useState } from "react";
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
import Skeleton from "@mui/material/Skeleton";
import { keyframes } from "@mui/material/styles";
import FolderIcon from "@mui/icons-material/Folder";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import StorageIcon from "@mui/icons-material/Storage";
import VisibilityIcon from "@mui/icons-material/Visibility";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import PrintIcon from "@mui/icons-material/Print";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import type { Print } from "../../api/prints";
import { categoriesApi, type Category } from "../../api/categories";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import { FALLBACK_LANGUAGE, matchLanguage } from "../../constants/languages";
import { aiCategorizationApi } from "../../api/aiCategorization";
import { UnauthorizedError } from "../../api/client";
import { useToast } from "../../components/ToastProvider";
import type { AuthUser } from "../../api/auth";
import { switchSlicer } from "../../hooks/useSlicerPreference";
import { dividerBorderColor } from "../../theme";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { importProviderInfo } from "../../constants/importProviders";
import { useDownloadPrint } from "./useDownloadPrint";
import { useOpenInSlicer } from "./useOpenInSlicer";
import { useOpenInStudio } from "./useOpenInStudio";
import { hasGeneratorScript, useCustomize } from "./useCustomize";
import AdaptedOpenButton from "./AdaptedOpenButton";
import CopiedFromRemote from "./CopiedFromRemote";
import ModelFileSelect from "./ModelFileSelect";
import PrintProfilesSection from "./PrintProfiles";
import type { ProfileEntry } from "./PrintProfiles/entries";
import type { PrintProfilesView } from "../../api/settings";
import OpenInSlicerButton from "./OpenInSlicerButton";
import { useAdaptedOpen } from "./useAdaptedOpen";
import AddToCollectionModal from "./AddToCollectionModal";
import RollingNumber from "../../components/RollingNumber";
import { formatFileSize } from "../../utils/fileSize";
import AuthorHoverCard from "../../components/AuthorHoverCard";
import UserAvatar from "../../components/UserAvatar";
import { useCopyToLibrary } from "./useCopyToLibrary";

const statChipSx = { flex: 1, px: 0.5, py: 1, border: "1px solid", borderColor: "divider", borderRadius: 2 };

const fillUp = keyframes`
  from { clip-path: inset(100% 0 0 0); }
  to { clip-path: inset(0 0 0 0); }
`;

/** A bookmark filling up and draining again, while the model's collections load. */
function BookmarkLoader() {
  return (
    <Box component="span" sx={{ position: "relative", display: "inline-flex", color: "text.secondary" }}>
      <BookmarkBorderIcon fontSize="small" />
      <BookmarkIcon
        fontSize="small"
        sx={{
          position: "absolute",
          inset: 0,
          animation: `${fillUp} 700ms ease-in-out infinite alternate`,
          "@media (prefers-reduced-motion: reduce)": { display: "none" },
        }}
      />
    </Box>
  );
}

/** "failed" still opens the dialog, just without showing a number. */
export type CollectionCount = number | "loading" | "failed";

type Props = {
  print: Print;
  collectionCount: CollectionCount;
  onCollectionCountChange: (count: number) => void;
  onSelectCategory: (id: string) => void;
  onUnauthorized?: () => void;
  onUpdated?: (print: Print) => void;
  /** Shown as the author of a direct upload, which has none. */
  viewer?: AuthUser | null;
  /** The model's print profiles, the designer's first; empty for a model without (or from an older backend). */
  profileEntries?: ProfileEntry[] | null;
  /** How to show them: null while the setting loads, "off" as plain files. */
  profilesView?: PrintProfilesView | null;
  /** The file every action applies to, when the page keeps it (so the 3D preview opens on it too). */
  selectedKey?: string | null;
  onSelectKey?: (key: string) => void;
  /** Opens the 3D preview on one of a profile's build plates. */
  onPreviewPlate?: (key: string, plateIndex: number) => void;
};

/** The detail page's sticky summary card. */
export default function ModelSidePanel({
  print,
  collectionCount,
  onCollectionCountChange,
  onSelectCategory,
  onUnauthorized,
  onUpdated,
  viewer,
  profileEntries,
  profilesView,
  selectedKey: pageSelectedKey,
  onSelectKey,
  onPreviewPlate,
}: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const [category, setCategory] = useState<Category | null>(null);
  // Only a starter category's name has translations, and English needs none, so English skips the request.
  const translating = matchLanguage(i18n.language) !== FALLBACK_LANGUAGE;
  useEffect(() => {
    if (!print.category_id || !translating) return;
    let active = true;
    void categoriesApi.listShared(print.category_id).then(
      (categories) => {
        if (active) setCategory(categories.find((item) => item.id === print.category_id) ?? null);
      },
      () => {
        if (active) setCategory(null);
      },
    );
    return () => {
      active = false;
    };
  }, [print.category_id, translating]);
  const categoryName =
    translating && category && category.id === print.category_id && category.name === print.category_name
      ? translateCategoryDisplay(category, i18n).name
      : print.category_name;
  const navigate = useNavigate();
  const showToast = useToast();
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  // The provider whose own category this maps from, when it isn't AI's answer.
  const suggestedBy = importProviderInfo(print.ai_suggestion?.provider)?.label;
  const viewerAvatarUrl = viewer?.avatar_url;
  const { downloading, downloadFile, downloadAllZip, recordUse } = useDownloadPrint(print, onUnauthorized, onUpdated);

  const { slicerOption, slicerOptions, files, canOpen, adaptedTargetFor } = useOpenInSlicer(print);
  // Every action below applies to this file; until one is picked, the first profile (the designer's, where there is
  // one), else the first file.
  const [ownSelectedKey, setOwnSelectedKey] = useState<string | null>(null);
  const selectedKey = onSelectKey ? (pageSelectedKey ?? null) : ownSelectedKey;
  const selectKey = onSelectKey ?? setOwnSelectedKey;
  const entries = profileEntries ?? [];
  const profilesShown = entries.length > 0 && !!profilesView && profilesView !== "off";
  // The setting isn't known yet: a placeholder, rather than files that turn into profiles a moment later.
  const profilesUnsettled = entries.length > 0 && profilesView == null;
  const firstProfileFile = profilesShown ? files.find((file) => file.key === entries[0].key) : undefined;
  const selectedFile = files.find((file) => file.key === selectedKey) ?? firstProfileFile ?? files[0] ?? null;
  const otherFiles = profilesShown ? files.filter((file) => !entries.some((entry) => entry.key === file.key)) : [];
  const adaptedTarget = adaptedTargetFor(selectedFile);

  // A 3D file of the model's own, while the instance has Studio on, opens there as a new design.
  const studio = useOpenInStudio(print, onUnauthorized);
  const studioPlate = studio.files.find((plate) => plate.id === selectedFile?.plate?.id) ?? null;
  const adapted = useAdaptedOpen(print.id, slicerOption?.id ?? null, recordUse, onUnauthorized);
  // Opened from the button below rather than a menu, so there is no menu to close.
  const customize = useCustomize(print, () => {}, onUnauthorized);
  // Another user's model, from one of their public collections.
  const owner = print.owner ?? null;
  const library = useCopyToLibrary(print, onUnauthorized, onUpdated);
  const libraryCopyId = print.library_copy_id ?? null;

  const goToCategory = () => {
    if (!print.category_id) return;
    onSelectCategory(print.category_id);
    // Go straight to the filtered URL; landing on plain /models makes the grid flicker.
    navigate(`/models?category=${print.category_id}`);
  };

  const importedDate = print.source_provider
    ? new Date(print.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  // A direct upload is its uploader's: the viewer's own, or on another user's model its owner's, whom "Shared by"
  // already names.
  const unauthored = !print.author?.name && !print.author?.handle && !print.creator && !print.source_provider;
  const showViewerAsAuthor = unauthored && !owner && Boolean(viewer);
  const showAuthor = !(unauthored && owner);
  const authorName =
    print.author?.name || print.author?.handle || print.creator || (showViewerAsAuthor ? viewer!.display_name : null);
  const authorAvatarUrl = print.author?.avatar_url || (showViewerAsAuthor ? viewerAvatarUrl : undefined);
  const collectionsLabel =
    typeof collectionCount === "number" && collectionCount > 0
      ? t("models:detail.addToCollectionAlreadyIn", { count: collectionCount })
      : t("models:detail.addToCollection");

  // The model's collections: which of the user's hold it, or for another user's model, the user's copy of it.
  const collectionsChip = (extraSx: Record<string, unknown> = {}) => (
    <Tooltip title={collectionsLabel}>
      <ButtonBase
        onClick={() => setCollectionsOpen(true)}
        aria-label={collectionsLabel}
        aria-busy={collectionCount === "loading"}
        sx={{
          ...statChipSx,
          ...extraSx,
          gap: 0.75,
          transition: (muiTheme) => muiTheme.transitions.create("background-color", { duration: 150 }),
          "&:hover": { bgcolor: "action.hover" },
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
        {collectionCount === "loading" ? (
          <>
            <BookmarkLoader />
            <Skeleton
              variant="text"
              width={8}
              sx={{
                fontSize: "0.875rem",
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            />
          </>
        ) : (
          <>
            {typeof collectionCount === "number" && collectionCount > 0 ? (
              <BookmarkIcon fontSize="small" color="primary" />
            ) : (
              <BookmarkBorderIcon fontSize="small" sx={{ color: "text.secondary" }} />
            )}
            {typeof collectionCount === "number" && (
              <Typography variant="body2" fontWeight={600}>
                <RollingNumber value={collectionCount} />
              </Typography>
            )}
          </>
        )}
      </ButtonBase>
    </Tooltip>
  );

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
      {/* Flex gap rather than margins: a part hidden at this size takes no room. */}
      <Stack spacing={2} useFlexGap>
        {/* Below md the page is one column and the header cuts a long name short (phones can't hover for the whole
            of it), so the full name shows here; wider screens give the header the room. */}
        <Box sx={{ display: { xs: "block", md: "none" } }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("models:detail.title")}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: (muiTheme) => muiTheme.thingport.headingText, overflowWrap: "anywhere" }}
          >
            {print.title || print.name}
          </Typography>
        </Box>
        {print.copied_from_remote && <CopiedFromRemote origin={print.copied_from_remote} />}

        {owner && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("models:shared.sharedByLabel")}
            </Typography>
            <ButtonBase
              onClick={() => navigate(`/explore/users/${owner.id}`)}
              sx={{
                borderRadius: 1,
                px: 0.5,
                py: 0.25,
                mx: -0.5,
                gap: 1,
                color: (muiTheme) => muiTheme.thingport.headingText,
                "&:hover": { color: "primary.main" },
                "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
              }}
            >
              <UserAvatar user={owner} size={28} />
              <Typography variant="body2" fontWeight={600}>
                {owner.display_name}
              </Typography>
            </ButtonBase>
          </Box>
        )}

        {showAuthor && (
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
        )}

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
                {categoryName}
              </Typography>
              {print.category_source === "ai" && (
                <Chip size="small" label={t("models:aiCategorization.byAi")} color="secondary" variant="outlined" />
              )}
            </ButtonBase>
          </Box>
        )}

        {/* Why there is nothing to customise here, which otherwise looks like a model that never had a script.
            A model that does have one needs no chip: it leads with Customize. */}
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
                {suggestedBy
                  ? t("models:aiCategorization.suggestionFromProvider", { provider: suggestedBy })
                  : t("models:aiCategorization.suggestionLabel")}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {print.ai_suggestion.category_path}
                {!suggestedBy && ` · ${Math.round(print.ai_suggestion.confidence * 100)}%`}
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
                        showToast({
                          message: t(
                            suggestedBy
                              ? "models:aiCategorization.suggestionAccepted"
                              : "models:aiCategorization.accepted",
                          ),
                        });
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
                        showToast({
                          message: t(
                            suggestedBy
                              ? "models:aiCategorization.suggestionRejected"
                              : "models:aiCategorization.rejected",
                          ),
                        });
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

        {owner && (
          // Another user's model: copied into the user's library, or filed into their collections (which copies it).
          <Stack direction="row" spacing={1.5}>
            {libraryCopyId ? (
              <Button
                variant="outlined"
                startIcon={<LibraryAddCheckOutlinedIcon />}
                onClick={() => library.openCopy(libraryCopyId)}
                sx={{ flex: 1 }}
              >
                {t("models:shared.openCopy")}
              </Button>
            ) : (
              <Button
                variant="outlined"
                disabled={library.copying}
                startIcon={
                  library.copying ? <CircularProgress size={16} color="inherit" /> : <LibraryAddOutlinedIcon />
                }
                onClick={() => void library.copy()}
                sx={{ flex: 1 }}
              >
                {t("models:shared.copy")}
              </Button>
            )}
            {collectionsChip({ flex: "0 0 auto", px: 1.75 })}
          </Stack>
        )}

        {profilesShown ? (
          <PrintProfilesSection
            view={profilesView}
            entries={entries}
            otherFiles={otherFiles}
            selectedKey={selectedFile?.key ?? null}
            onSelect={selectKey}
            onPreviewPlate={onPreviewPlate}
          />
        ) : profilesUnsettled ? (
          <Skeleton variant="rounded" height={58} sx={{ borderRadius: 2 }} />
        ) : (
          selectedFile &&
          files.length > 1 && (
            <ModelFileSelect files={files} selected={selectedFile} onSelect={(file) => selectKey(file.key)} />
          )
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
            onCustomize={customize.available ? customize.start : undefined}
            onOpenInStudio={studioPlate ? () => void studio.open(studioPlate) : undefined}
            openingInStudio={studio.opening}
          />
        )}
        {slicerOption && adaptedTarget && (
          <AdaptedOpenButton
            targets={[adaptedTarget]}
            slicerLabel={slicerOption.label}
            stateOf={adapted.stateOf}
            open={adapted.open}
            onPick={() => {}}
          />
        )}
        {adapted.dialog}

        {/* Another user's model counts their views and prints, not the viewer's: its collections sit by the copy. */}
        {!owner && (
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.75} sx={statChipSx}>
              <VisibilityIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Typography variant="body2" fontWeight={600}>
                {print.view_count}
              </Typography>
            </Stack>
            {collectionsChip()}
            <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.75} sx={statChipSx}>
              <PrintIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Typography variant="body2" fontWeight={600}>
                <RollingNumber value={print.print_count} />
              </Typography>
            </Stack>
          </Stack>
        )}

        {importedDate && (
          <Typography variant="caption" sx={{ textAlign: "right", fontSize: 12, color: "text.secondary" }}>
            {t("models:detail.imported", { date: importedDate })}
          </Typography>
        )}
      </Stack>
      {customize.window}
      <AddToCollectionModal
        open={collectionsOpen}
        onClose={() => setCollectionsOpen(false)}
        printId={print.id}
        onUnauthorized={onUnauthorized}
        onCountChange={onCollectionCountChange}
      />
    </Paper>
  );
}
