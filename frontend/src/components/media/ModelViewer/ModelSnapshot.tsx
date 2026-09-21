import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { printsApi } from "../../../api/prints";
import { type ResolvedTheme } from "../../../constants/settingsOptions";
import { generateModelSnapshot, queueSnapshotJob, snapshotCache } from "../../../utils/modelSnapshotCache";

type SnapshotState = "idle" | "loading" | "error";
type ModelSnapshotProps = {
  url: string;
  ext: string;
  plateId?: string;
  theme: ResolvedTheme;
  mode?: "automatic" | "on-demand";
  /** For tiny slots (e.g. a plate list's 32px thumbnail): no status text or buttons, just the
   *  image once ready (a small spinner while generating). Also renders at a fixed card-sized
   *  resolution instead of the slot's own size -- the result is persisted as the plate's
   *  thumbnail (see uploadGeneratedThumbnail) and reused by full-size grid cards. */
  compact?: boolean;
};

// Render size for compact snapshots: the same 4:3 as a grid card, large enough to stay sharp there.
const COMPACT_RENDER_WIDTH = 480;
const COMPACT_RENDER_HEIGHT = 360;

// Every ModelSnapshot on the page shares one job queue (see queueSnapshotJob), so a single model
// that hangs mid-load (bad network response, pathological geometry) would otherwise wedge every
// other card's preview behind it forever. This bounds each job so the queue always keeps moving.
const SNAPSHOT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Snapshot generation timed out")), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function ModelSnapshot({ url, ext, plateId, mode = "automatic", compact = false }: ModelSnapshotProps) {
  const { t } = useTranslation(["library", "common"]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [state, setState] = useState<SnapshotState>("idle");
  const [requested, setRequested] = useState(mode === "automatic");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (mode === "automatic") setRequested(true);
  }, [mode]);

  useEffect(() => {
    let disposed = false;
    let observer: IntersectionObserver | null = null;
    const cacheKey = plateId ? `plate:${plateId}` : url;
    if (snapshotCache.has(cacheKey)) {
      setSnapshot(snapshotCache.get(cacheKey)!);
      return;
    }
    const load = async () => {
      if (!containerRef.current) return;
      setState("loading");
      try {
        const rect = containerRef.current.getBoundingClientRect();
        const width = compact ? COMPACT_RENDER_WIDTH : Math.max(120, Math.floor(rect.width || 240));
        const height = compact ? COMPACT_RENDER_HEIGHT : Math.max(120, Math.floor(rect.height || 180));
        const image = await queueSnapshotJob(async () => {
          if (disposed) return null;
          return withTimeout(generateModelSnapshot(url, ext, width, height, "light"), SNAPSHOT_TIMEOUT_MS);
        });
        if (disposed || !image) return;
        snapshotCache.set(cacheKey, image);
        setSnapshot(image);
        setState("idle");
        if (plateId) {
          try {
            const imageBlob = await fetch(image).then(response => response.blob());
            await printsApi.uploadGeneratedThumbnail(plateId, imageBlob);
          } catch (err) {
            console.warn("Generated preview could not be persisted:", err);
          }
        }
      } catch (err) {
        console.warn("Snapshot generation failed:", err);
        if (!disposed) {
          setState("error");
        }
      }
    };
    if (!requested) {
      setState("idle");
      return () => { disposed = true; };
    }
    if (mode === "automatic" && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer?.disconnect();
        void load();
      }, { rootMargin: "240px" });
      if (containerRef.current) observer.observe(containerRef.current);
    } else {
      void load();
    }
    return () => {
      disposed = true;
      observer?.disconnect();
    };
    // retryToken isn't read in the effect body -- it's a bump counter whose only job is to
    // force this effect to re-run when the user clicks Retry.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [url, ext, plateId, mode, requested, retryToken, compact]);

  return (
    <Box
      ref={containerRef}
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
      {snapshot ? (
        <Box
          component="img"
          src={snapshot}
          alt={t("library:modelViewer.previewAlt")}
          sx={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : compact ? (
        state === "loading" && <CircularProgress size={14} />
      ) : state === "loading" ? (
        <Typography variant="caption" color="text.secondary">
          {t("library:modelViewer.generatingPreview")}
        </Typography>
      ) : state === "error" ? (
        <Stack alignItems="center" spacing={0.5}>
          <Typography variant="caption" color="error.main">
            {t("library:modelViewer.previewFailed")}
          </Typography>
          <Button
            type="button"
            size="small"
            variant="outlined"
            onClick={event => {
              event.stopPropagation();
              setState("idle");
              setRetryToken(v => v + 1);
            }}
          >
            {t("common:retry")}
          </Button>
        </Stack>
      ) : mode === "on-demand" && !requested ? (
        <Button
          type="button"
          size="small"
          variant="outlined"
          onClick={event => { event.stopPropagation(); setRequested(true); }}
        >
          {t("library:modelViewer.generatePreview")}
        </Button>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t("library:modelViewer.waitingToGenerate")}
        </Typography>
      )}
    </Box>
  );
}
