import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { extractLightBurnPreview } from "../../utils/lightburnExtract";

type PreviewState = "idle" | "loading" | "error";

type LightBurnPreviewProps = {
  url: string;
  assetId?: string;
  filename: string;
  imgSx?: SxProps<Theme>;
};

const previewCache = new Map<string, string>();

export default function LightBurnPreview({ url, assetId, filename, imgSx }: LightBurnPreviewProps) {
  const { t } = useTranslation(["library"]);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<PreviewState>("idle");

  useEffect(() => {
    let alive = true;
    const cacheKey = assetId ? `asset:${assetId}` : url;
    const cached = previewCache.get(cacheKey);
    if (cached) {
      setPreview(cached);
      setState("idle");
      return () => {
        alive = false;
      };
    }

    setPreview(null);
    setState("loading");
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Preview fetch failed: ${res.status}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const payload = await extractLightBurnPreview(bytes);
        if (!payload) {
          throw new Error("Preview not found in LightBurn file");
        }
        const objectUrl = URL.createObjectURL(
          new Blob([payload.data as Uint8Array<ArrayBuffer>], { type: payload.mime }),
        );
        previewCache.set(cacheKey, objectUrl);
        if (alive) {
          setPreview(objectUrl);
          setState("idle");
        }
      } catch (err) {
        console.warn("LightBurn preview failed:", err);
        if (alive) {
          setState("error");
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [url, assetId]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        bgcolor: "action.hover",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      {preview ? (
        <Box component="img" src={preview} alt={filename} sx={imgSx} />
      ) : state === "loading" ? (
        <Typography variant="caption" color="text.secondary">
          {t("library:lightburn.generatingPreview")}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t("library:lightburn.previewUnavailable")}
        </Typography>
      )}
    </Box>
  );
}
