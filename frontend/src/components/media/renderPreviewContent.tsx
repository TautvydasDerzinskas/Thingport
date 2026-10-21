import { useCallback, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type Print, type Plate, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { MODEL_EXTS, LIGHTBURN_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import ModelViewer from "./ModelViewer";
import { ModelSnapshot } from "./ModelViewer/ModelSnapshot";
import LightBurnPreview from "./LightBurnPreview";
import ModelRender from "./ModelRender";
import { useCardPreview } from "../../hooks/useCardPreview";

export type PreviewVariant = "card" | "modal";

function PreviewPlaceholder({ text }: { text: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
      <Typography variant="body2" color="text.disabled">
        {text}
      </Typography>
    </Box>
  );
}

/**
 * A model card's picture, as the user chose: its own pictures first with our tinted render standing in where there are
 * none, or the render first with the pictures standing in. The render needs a file the server can draw, and
 * generation not turned off; `fallback` is what the card showed before renders existed.
 */
function CardPicture({
  print,
  previewMode,
  fallback,
}: {
  print: Print;
  previewMode: PreviewMode;
  fallback: ReactNode;
}) {
  const [preference] = useCardPreview();
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const onUnavailable = useCallback(() => setRenderUnavailable(true), []);
  // Hidden until the choice is known, so cards don't flash the wrong picture.
  if (preference === null) return null;
  const canRender = Boolean(print.render_url) && previewMode !== "disabled" && !renderUnavailable;
  const hasOwnImage = Boolean(print.thumb_url) && !print.thumb_generated;
  if (canRender && (preference === "renders" || !hasOwnImage)) {
    // The model's own picture holds the place while the render is made; a render to come can't stand in for itself.
    const placeholder = print.thumb_url ? (
      <Box
        component="img"
        src={printsApi.fileUrl(print.thumb_url)}
        alt=""
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : undefined;
    return (
      <ModelRender
        url={print.render_url!}
        alt={print.title || print.name}
        onUnavailable={onUnavailable}
        placeholder={placeholder}
      />
    );
  }
  return fallback;
}

// Picks the preview widget for a print's active plate.
export function renderPreviewContent(
  print: Print,
  variant: PreviewVariant,
  theme: ResolvedTheme,
  t: TFunction,
  previewMode: PreviewMode = "automatic",
  activePlate?: Plate,
) {
  const plate = variant === "modal" ? activePlate || print.plates[0] : print.plates[0];
  const imgSx =
    variant === "card"
      ? { width: "100%", height: "100%", objectFit: "cover" as const }
      : { width: "100%", height: "100%", objectFit: "contain" as const, bgcolor: "action.hover" };

  if (!plate) {
    return <PreviewPlaceholder text={t("library:modelViewer.noPreview")} />;
  }

  const ext = extOf(plate.filename);
  const plateUrl = printsApi.fileUrl(plate.url);
  const thumbUrl =
    variant === "card"
      ? print.thumb_url
        ? printsApi.fileUrl(print.thumb_url)
        : null
      : plate.thumb_url
        ? printsApi.fileUrl(plate.thumb_url)
        : null;
  const is3d = MODEL_EXTS.has(ext);
  const isLightBurn = LIGHTBURN_EXTS.has(ext);

  if (variant === "card") {
    let fallback: ReactNode;
    if (thumbUrl) {
      fallback = <Box component="img" src={thumbUrl} alt={plate.filename} sx={imgSx} />;
    } else if (ext === "svg") {
      fallback = <Box component="img" src={plateUrl} alt={plate.filename} sx={imgSx} />;
    } else if (is3d) {
      fallback =
        previewMode === "disabled" ? (
          <PreviewPlaceholder text={t("library:modelViewer.previewDisabled")} />
        ) : (
          <ModelSnapshot url={plateUrl} ext={ext} plateId={plate.id} theme={theme} mode={previewMode} />
        );
    } else if (isLightBurn) {
      fallback = <LightBurnPreview url={plateUrl} assetId={plate.id} filename={plate.filename} imgSx={imgSx} />;
    } else {
      fallback = <PreviewPlaceholder text={t("library:modelViewer.noPreview")} />;
    }
    return (
      <CardPicture
        key={`${print.id}:${print.render_url ?? ""}`}
        print={print}
        previewMode={previewMode}
        fallback={fallback}
      />
    );
  }

  if (is3d) {
    return (
      <ModelViewer
        key={`${variant}-${print.id}-${plate.id}`}
        url={plateUrl}
        ext={ext}
        viewKey={`${print.id}-${plate.id}`}
        theme={theme}
        previewGlbUrl={plate.preview_glb_url ? printsApi.fileUrl(plate.preview_glb_url) : undefined}
      />
    );
  }
  if (thumbUrl || ext === "svg") {
    const src = thumbUrl || plateUrl;
    return <Box component="img" src={src} alt={plate.filename} sx={imgSx} />;
  }
  if (isLightBurn) {
    return <LightBurnPreview url={plateUrl} assetId={plate.id} filename={plate.filename} imgSx={imgSx} />;
  }
  return <PreviewPlaceholder text={t("library:modelViewer.previewUnavailable")} />;
}
