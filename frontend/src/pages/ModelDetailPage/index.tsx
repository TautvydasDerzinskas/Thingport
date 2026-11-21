import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { UnauthorizedError } from "../../api/client";
import { type License, type Print, printsApi } from "../../api/prints";
import { collectionsApi } from "../../api/collections";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { dividerBorderColor } from "../../theme";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import ProviderBadge from "../../components/ProviderBadge";
import { renderPreviewContent } from "../../components/media/renderPreviewContent";
import { ModelSnapshot } from "../../components/media/ModelViewer/ModelSnapshot";
import ModelRender from "../../components/media/ModelRender";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useSmartBack } from "../../components/Layout/NavigationHistoryContext";
import { ToolPart, useToolsWithPart, useToolWindowHost } from "../../components/tools/ToolParts";
import { ModelPageToolsProvider, type ModelPageTools } from "../../components/tools/modelPageTools";
import ToolIcon from "../../components/tools/ToolIcon";
import { translator } from "../../sdk/labels";
import { matchLanguage } from "../../constants/languages";
import type { Tool } from "../../api/tools";
import Model3DPreviewModal from "./Model3DPreviewModal";
import ModelActionsMenu from "./ModelActionsMenu";
import FavoriteButton from "./FavoriteButton";
import ModelSidePanel, { type CollectionCount } from "./ModelSidePanel";
import MarkdownDescription from "../../components/MarkdownDescription";
import LicenseStrip from "../../components/license/LicenseStrip";
import { useLicenseFill } from "../../components/license/useLicenseFill";
import AiDescriptionReview, { AiDescriptionChip } from "./AiDescriptionReview";
import Skeleton from "@mui/material/Skeleton";
import { useQualityCheck } from "./QualityCheck/useQualityCheck";
import QualityScanOverlay from "./QualityCheck/QualityScanOverlay";
import QualityBadge from "./QualityCheck/QualityBadge";
import { usePrintProfilesView } from "../../hooks/usePrintProfilesView";
import { usePrintProfiles } from "./PrintProfiles/usePrintProfiles";
import { profileEntries } from "./PrintProfiles/entries";

type Props = {
  theme: ResolvedTheme;
  onSelectCategory: (id: string) => void;
  onUnauthorized?: () => void;
  viewer?: AuthUser | null;
};

export default function ModelDetailPage({ theme, onSelectCategory, onUnauthorized, viewer }: Props) {
  const { printId } = useParams<{ printId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["models", "common", "library"]);
  const [print, setPrint] = useState<Print | null>(null);
  const [collectionCount, setCollectionCount] = useState<CollectionCount>("loading");
  // The header shows the last model until the next one loads: a count its dialog reports by then is that model's.
  const routeId = useRef(printId);
  useLayoutEffect(() => {
    routeId.current = printId;
  });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [loadedPreview, setLoadedPreview] = useState<{ source: string; aspect: number } | null>(null);
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const onRenderUnavailable = useCallback(() => setRenderUnavailable(true), []);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Where the 3D preview opens: the profile picked beside it, or one of its plates picked in the side panel.
  const [previewStart, setPreviewStart] = useState<{ plateId: string | null; plateIndex: number | null }>({
    plateId: null,
    plateIndex: null,
  });
  // The file the side panel's actions apply to; kept here so the 3D preview opens on the same profile.
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  // The plate the side panel has picked, which the tools' parts of the page draw for.
  const [pickedPlateId, setPickedPlateId] = useState<string | null>(null);
  // The description box's tab: the description itself, or a tool's by its id.
  const [descriptionTab, setDescriptionTab] = useState("description");
  const descriptionRef = useRef<HTMLDivElement>(null);
  const tabTools = useToolsWithPart("tab");
  const imageTools = useToolsWithPart("image");
  const toolPreviewHost = useRef<HTMLDivElement>(null);
  const toolWindow = useToolWindowHost(printId ?? "", onUnauthorized);
  const pageTools = useMemo<ModelPageTools>(
    () => ({
      showTab: (toolId) => {
        setDescriptionTab(toolId);
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        descriptionRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
      },
      selectFile: (fileId) => setSelectedFileKey(fileId),
      openWindow: toolWindow.open,
    }),
    [toolWindow.open],
  );
  const [profilesView] = usePrintProfilesView();
  const { profiles, filling: profilesFilling } = usePrintProfiles(print, onUnauthorized);
  // The tools' parts read the model's profiles, so they're drawn again once those have filled in.
  const partsRevision = profilesFilling ? "filling" : "filled";
  const entries = useMemo(
    () => (print ? profileEntries(print.plates, profiles, profilesFilling) : []),
    [print, profiles, profilesFilling],
  );
  const profilesOn = entries.length > 0 && Boolean(profilesView) && profilesView !== "off";
  const { quality, outcome } = useQualityCheck(printId ?? "", onUnauthorized);
  // The header's menu stays across models, so an answer for the one before (a copy finishing, say) can arrive here
  // after another has opened: it's dropped rather than shown as this one.
  const updatePrint = useCallback(
    (updated: Print) => setPrint((prev) => (prev && prev.id !== updated.id ? prev : updated)),
    [],
  );

  // An older import's licence is read the first time its owner opens it, and lands here once it's there.
  const licenseFill = useLicenseFill(
    print,
    useCallback(
      (id: string, license: License | null) =>
        setPrint((prev) =>
          prev && prev.id === id
            ? { ...prev, license, license_pending: false, license_filling: false, license_failed: false }
            : prev,
        ),
      [],
    ),
    onUnauthorized,
  );

  // Returns wherever the user came from; useSmartBack skips same-route history entries.
  const goBack = useSmartBack();

  usePageHeader({
    title: print ? print.title || print.name : undefined,
    subtitle: print ? t("models:detail.subtitle") : undefined,
    actions: print ? (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        {/* Another user's model is theirs to favourite; the viewer copies it instead (the side panel). */}
        {!print.owner && <FavoriteButton print={print} onUpdated={updatePrint} onUnauthorized={onUnauthorized} />}
        <ModelActionsMenu
          print={print}
          layout="tiles"
          onUnauthorized={onUnauthorized}
          onDeleted={goBack}
          onUpdated={updatePrint}
          onCollectionCountChange={(count) => {
            if (print.id === routeId.current) setCollectionCount(count);
          }}
          viewer={viewer}
          offerLink
        />
      </Stack>
    ) : undefined,
  });

  useEffect(() => {
    if (!printId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const data = await printsApi.get(printId);
        if (cancelled) return;
        setPrint(data);
        setActiveImageIndex(0);
        setSelectedFileKey(null);
        // The side panel says which plate is picked once it shows this model; until then, none of the last one's.
        setPickedPlateId(null);
        setDescriptionTab("description");
        setRenderUnavailable(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized?.();
          return;
        }
        console.error(err);
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [printId, onUnauthorized]);

  // Apart from the model, which shouldn't wait for it: only the side panel's chip does.
  useEffect(() => {
    if (!printId) return;
    let cancelled = false;
    setCollectionCount("loading");
    collectionsApi
      .listForPrint(printId)
      .then((memberships) => memberships.filter((c) => c.in_collection).length)
      .catch(() => "failed" as const)
      .then((count) => {
        // The dialog may have opened and answered first, and by now knows better.
        if (!cancelled) setCollectionCount((prev) => (prev === "loading" ? count : prev));
      });
    return () => {
      cancelled = true;
    };
  }, [printId]);

  if (loading) {
    return (
      <Box sx={{ maxWidth: "1390px", mx: "auto" }} aria-hidden>
        <Box
          sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" }, gap: "24px", alignItems: "start" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Skeleton
              variant="rounded"
              sx={{ width: "100%", height: "auto", aspectRatio: "16 / 10", borderRadius: "12px" }}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} variant="rounded" width={84} height={63} />
              ))}
            </Stack>
          </Box>
          <Stack spacing={1.5}>
            <Skeleton variant="text" sx={{ fontSize: "2rem", width: "85%" }} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Skeleton variant="circular" width={28} height={28} />
              <Skeleton variant="text" sx={{ width: "40%" }} />
            </Stack>
            <Stack direction="row" spacing={1}>
              {[64, 80, 52].map((width) => (
                <Skeleton key={width} variant="rounded" width={width} height={24} sx={{ borderRadius: 4 }} />
              ))}
            </Stack>
            <Skeleton variant="rounded" height={40} />
            {[90, 75, 82, 60].map((width) => (
              <Skeleton key={width} variant="text" sx={{ width: `${width}%` }} />
            ))}
          </Stack>
        </Box>
      </Box>
    );
  }

  if (notFound || !print) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:errors.notFound")}</Typography>
      </Stack>
    );
  }

  // The tinted render stands in for our own older renders, which are grey whatever the theme and accent.
  const showRender = Boolean(print.render_url) && !renderUnavailable;
  // Unless the model carries its own colours: then our own picture of it is a render in those, which is the
  // thing to show large. The grey one is still what the card and the thumbnail use, so a list stays one colour.
  const images = print.preview_images
    .filter((image) => !(showRender && image.generated && !print.own_colors))
    .toSorted((a, b) => a.position - b.position);
  const hasImages = images.length > 0;
  const activeImage = images[activeImageIndex] || images[0];
  const renderPlate = showRender && print.plates.find((plate) => plate.render_url === print.render_url);
  const previewKey = activeImage ? `image:${activeImage.id}` : renderPlate ? `render:${renderPlate.id}` : null;
  const previewSource = activeImage?.url ?? (showRender ? print.render_url : null);
  const previewAspect = loadedPreview?.source === previewSource ? loadedPreview.aspect : null;
  const recordPreviewSize = (image: HTMLImageElement) => {
    if (previewSource && image.naturalWidth && image.naturalHeight) {
      setLoadedPreview({ source: previewSource, aspect: image.naturalWidth / image.naturalHeight });
    }
  };
  const firstPlate = print.plates[0];
  const canPreview3d = Boolean(firstPlate) && MODEL_EXTS.has(extOf(firstPlate?.filename || ""));
  // With no preview image yet, show the live 3D view and generate a snapshot in the background.
  // The server's render doesn't need one: it saves its own picture.
  // Only for the owner, whose picture it saves.
  const needsGeneratedPreview =
    !print.owner &&
    print.preview_images.length === 0 &&
    !showRender &&
    Boolean(firstPlate) &&
    MODEL_EXTS.has(extOf(firstPlate?.filename || ""));

  const openPreview = (plateId: string | null, plateIndex: number | null = null) => {
    setPreviewStart({ plateId, plateIndex });
    setPreviewOpen(true);
  };

  const goPrevImage = () => setActiveImageIndex((i) => (i - 1 + images.length) % images.length);
  const goNextImage = () => setActiveImageIndex((i) => (i + 1) % images.length);

  // A tool's tab is titled in the reader's language where its labels have one.
  const language = matchLanguage(i18n.language);
  const tabTitle = (tool: Tool) => {
    const translated = translator(tool.locales ?? {}, language)("modelPage.tab");
    return translated === "modelPage.tab" ? (tool.manifest.modelPage?.tab?.title ?? tool.manifest.name) : translated;
  };
  const shownTab = tabTools.some((tool) => tool.id === descriptionTab) ? descriptionTab : "description";
  const shownTabTool = tabTools.find((tool) => tool.id === shownTab) ?? null;

  return (
    <ModelPageToolsProvider value={pageTools}>
      <Box sx={{ maxWidth: "1390px", mx: "auto" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
            gap: "24px",
            alignItems: "start",
          }}
        >
          {/* minWidth: 0 -- without it, a grid item defaults to min-width: auto, so a preview image
            with huge intrinsic pixel dimensions could still force this column wider than its "2fr"
            share (and skew the whole two-column layout) even though the image itself is capped
            below. */}
          <Box sx={{ minWidth: 0, position: "relative" }}>
            <Box
              sx={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 10",
                borderRadius: "12px",
                overflow: "hidden",
                bgcolor: "background.paper",
              }}
            >
              {hasImages ? (
                <>
                  {/* A blurred, edge-to-edge crop of the same image behind the sharp contained one --
                    the common "photo viewer" backdrop that fills the letterboxed bars around any
                    image whose aspect ratio doesn't match this box's 16:10, instead of showing flat
                    background color. scale(1.15) pushes the blur's own soft edge outside the box
                    so no unblurred fringe peeks in. */}
                  <Box
                    component="img"
                    src={printsApi.fileUrl(activeImage.url)}
                    alt=""
                    aria-hidden="true"
                    sx={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      maxWidth: "100%",
                      objectFit: "cover",
                      filter: "blur(30px)",
                      transform: "scale(1.15)",
                    }}
                  />
                  <Box
                    component="img"
                    key={activeImage.url}
                    src={printsApi.fileUrl(activeImage.url)}
                    alt={print.title || print.name}
                    onLoad={(event) => recordPreviewSize(event.currentTarget)}
                    sx={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      maxWidth: "100%",
                      objectFit: "contain",
                    }}
                  />
                </>
              ) : showRender ? (
                <ModelRender
                  key={print.id}
                  url={print.render_url!}
                  alt={print.title || print.name}
                  onUnavailable={onRenderUnavailable}
                  onImageLoad={recordPreviewSize}
                />
              ) : (
                firstPlate && renderPreviewContent(print, "modal", theme, t, "automatic", firstPlate)
              )}
              {previewKey && previewAspect && imageTools.length > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: activeImage ? 0 : "6%",
                    containerType: "size",
                    zIndex: 3,
                    pointerEvents: "none",
                  }}
                >
                  <Box
                    ref={toolPreviewHost}
                    sx={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      width: `min(100cqw, calc(100cqh * ${previewAspect}))`,
                      height: `min(100cqh, calc(100cqw / ${previewAspect}))`,
                    }}
                  />
                </Box>
              )}

              {images.length > 1 && (
                <>
                  <IconButton
                    onClick={goPrevImage}
                    aria-label={t("models:detail.previousImage") ?? undefined}
                    sx={{
                      position: "absolute",
                      left: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      bgcolor: "rgba(0, 0, 0, 0.45)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
                    }}
                  >
                    <ChevronLeftIcon />
                  </IconButton>
                  <IconButton
                    onClick={goNextImage}
                    aria-label={t("models:detail.nextImage") ?? undefined}
                    sx={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      bgcolor: "rgba(0, 0, 0, 0.45)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
                    }}
                  >
                    <ChevronRightIcon />
                  </IconButton>
                </>
              )}

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ position: "absolute", left: 12, bottom: 12, zIndex: 2 }}
              >
                {canPreview3d && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<ViewInArIcon fontSize="small" />}
                    onClick={() => openPreview(selectedFileKey ?? (profilesOn ? entries[0].key : null))}
                    sx={{
                      bgcolor: "rgba(0, 0, 0, 0.65)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0, 0, 0, 0.8)" },
                    }}
                  >
                    {t("models:detail.preview3d")}
                  </Button>
                )}
                <QualityBadge quality={quality} isAdmin={viewer?.role === "ADMIN"} />
              </Stack>
              {/* What the installed tools draw on the picture, top right. */}
              {imageTools.length > 0 && (
                <Stack spacing={1} alignItems="flex-end" sx={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}>
                  {imageTools.map((tool) => (
                    <ToolPart
                      key={tool.id}
                      tool={tool}
                      place="image"
                      modelId={print.id}
                      fileId={pickedPlateId}
                      preview={previewKey && previewAspect ? { key: previewKey, host: toolPreviewHost } : undefined}
                      revision={partsRevision}
                      onUnauthorized={onUnauthorized}
                    />
                  ))}
                </Stack>
              )}
              <QualityScanOverlay key={print.id} quality={quality} outcome={outcome} />
            </Box>
            <ProviderBadge
              provider={print.source_provider}
              size={40}
              sx={{ position: "absolute", top: 12, left: 12, zIndex: 1 }}
            />

            {images.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, overflowX: "auto", pb: 0.5 }}>
                {images.map((image, idx) => (
                  <ButtonBase
                    key={image.id}
                    onClick={() => setActiveImageIndex(idx)}
                    sx={{
                      width: 84,
                      height: 64,
                      borderRadius: 1.5,
                      overflow: "hidden",
                      border: "2px solid",
                      borderColor: idx === activeImageIndex ? "primary.main" : "divider",
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      component="img"
                      src={printsApi.fileUrl(image.url)}
                      alt=""
                      sx={{ width: "100%", height: "100%", maxWidth: "100%", objectFit: "cover" }}
                    />
                  </ButtonBase>
                ))}
              </Stack>
            )}

            {needsGeneratedPreview && firstPlate && (
              <Box
                sx={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  opacity: 0,
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                <ModelSnapshot
                  url={printsApi.fileUrl(firstPlate.url)}
                  ext={extOf(firstPlate.filename)}
                  plateId={firstPlate.id}
                  theme={theme}
                  mode="automatic"
                />
              </Box>
            )}

            <Paper
              ref={descriptionRef}
              variant="outlined"
              sx={{
                mt: 3,
                p: 2,
                borderRadius: "12px",
                borderColor: dividerBorderColor,
                scrollMarginTop: 80,
              }}
            >
              {/* With a tool that draws a tab of its own, the box is tabbed: the description, then each tool's. */}
              {tabTools.length > 0 && (
                <Tabs
                  value={shownTab}
                  onChange={(_event, next: string) => setDescriptionTab(next)}
                  variant="scrollable"
                  allowScrollButtonsMobile
                  sx={{ mx: -2, mt: -1, mb: 1.5, px: 1, minHeight: 42, borderBottom: 1, borderColor: "divider" }}
                >
                  <Tab value="description" label={t("models:detail.description")} sx={{ minHeight: 42 }} />
                  {tabTools.map((tool) => (
                    <Tab
                      key={tool.id}
                      value={tool.id}
                      icon={<ToolIcon iconUrl={tool.manifest.iconUrl} size={18} />}
                      iconPosition="start"
                      label={tabTitle(tool)}
                      sx={{ minHeight: 42, gap: 0.75 }}
                    />
                  ))}
                </Tabs>
              )}
              {shownTabTool ? (
                <ToolPart
                  key={shownTabTool.id}
                  tool={shownTabTool}
                  place="tab"
                  modelId={print.id}
                  fileId={pickedPlateId}
                  revision={partsRevision}
                  onUnauthorized={onUnauthorized}
                />
              ) : (
                <>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    {!tabTools.length && (
                      <Typography
                        variant="subtitle1"
                        fontWeight={700}
                        sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}
                      >
                        {t("models:detail.description")}
                      </Typography>
                    )}
                    <AiDescriptionChip print={print} onUpdated={updatePrint} onUnauthorized={onUnauthorized} />
                  </Stack>
                  {print.notes?.trim() ? (
                    <MarkdownDescription markdown={print.notes} />
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      {t("models:detail.noDescription")}
                    </Typography>
                  )}
                  <AiDescriptionReview print={print} onUpdated={updatePrint} onUnauthorized={onUnauthorized} />

                  <Typography
                    variant="subtitle1"
                    fontWeight={700}
                    sx={{ mt: 2.5, mb: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
                  >
                    {t("models:detail.tags")}
                  </Typography>
                  {print.tags.length ? (
                    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
                      {print.tags.map((tag) => (
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          variant="outlined"
                          // A tag's page lists the user's own library, which another user's tags say nothing about.
                          onClick={print.owner ? undefined : () => navigate(`/models/tags/${encodeURIComponent(tag)}`)}
                          sx={{
                            bgcolor: "background.paper",
                            borderColor: "divider",
                            color: "text.primary",
                            // !important: Chip's own clickable styles use a same-specificity selector.
                            "&:hover, &:focus-visible, &:active": {
                              backgroundColor: (muiTheme) => `${muiTheme.palette.background.paper} !important`,
                            },
                          }}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.disabled">
                      {t("models:detail.noTags")}
                    </Typography>
                  )}
                  <LicenseStrip
                    license={print.license ?? null}
                    loading={licenseFill.loading}
                    failed={licenseFill.failed}
                    onRetry={licenseFill.retry}
                    provider={print.source_provider}
                    credit={{
                      title: print.title || print.name,
                      // Named as the side panel names them.
                      creator: print.author?.name || print.author?.handle || print.creator,
                      sourceUrl: print.source_url,
                    }}
                    onChange={
                      print.owner || print.tool_id ? undefined : () => navigate(`/models/${print.id}?edit=${print.id}`)
                    }
                  />
                </>
              )}
            </Paper>
          </Box>

          {/* alignSelf: stretch overrides the grid's own alignItems: "start" just for this column,
            so this box is as tall as the (taller) left column -- giving the sticky panel inside
            it room to travel as the page scrolls instead of being stuck the moment its own
            (short) content ends. minWidth: 0, as on the left: a long file name with no spaces would
            otherwise widen this column past its "1fr". */}
          <Box sx={{ alignSelf: "stretch", minWidth: 0 }}>
            <ModelSidePanel
              print={print}
              collectionCount={collectionCount}
              onCollectionCountChange={setCollectionCount}
              onSelectCategory={onSelectCategory}
              onUnauthorized={onUnauthorized}
              onUpdated={updatePrint}
              viewer={viewer}
              profileEntries={entries}
              profilesView={profilesView}
              partsRevision={partsRevision}
              selectedKey={selectedFileKey}
              onSelectKey={setSelectedFileKey}
              onPickedPlate={setPickedPlateId}
              onPreviewPlate={(key, plateIndex) => openPreview(key, plateIndex)}
            />
          </Box>
        </Box>

        {previewOpen && (
          <Model3DPreviewModal
            print={print}
            onClose={() => setPreviewOpen(false)}
            profileEntries={profilesOn ? entries : null}
            profilesView={profilesView}
            initialPlateId={previewStart.plateId}
            initialPlateIndex={previewStart.plateIndex}
          />
        )}
        {toolWindow.element}
      </Box>
    </ModelPageToolsProvider>
  );
}
