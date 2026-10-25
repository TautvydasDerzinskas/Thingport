import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import ThreeDRotationIcon from "@mui/icons-material/ThreeDRotation";
import { dashboardApi } from "../../api/dashboard";
import { printsApi, type Print } from "../../api/prints";
import { UnauthorizedError } from "../../api/client";
import ModelViewer from "../../components/media/ModelViewer";
import { extOf } from "../../utils/fileExtensions";
import DashboardCard, { DashboardCardTitle } from "./DashboardCard";

// Further than this between press and release is a spin, not a click to open the model.
const CLICK_SLOP_PX = 6;

const pad = (n: number) => String(n).padStart(2, "0");

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type Props = { onUnauthorized?: () => void };

/** One of the user's models a day, spinning slowly; drag to turn it, click to open it. */
export default function FeaturedModelCard({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const [print, setPrint] = useState<Print | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    dashboardApi
      .getFeatured(localDate(new Date()))
      .then((result) => {
        if (active) setPrint(result.print);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const plate = print?.plates[0];
  const open = () => print && navigate(`/models/${print.id}`);

  let body: React.ReactNode;
  if (failed) body = <Typography color="text.secondary">{t("dashboard.featuredModel.loadError")}</Typography>;
  else if (print === undefined)
    body = (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
        <CircularProgress size={22} />
      </Box>
    );
  else if (!print || !plate)
    body = <Typography color="text.secondary">{t("dashboard.featuredModel.empty")}</Typography>;
  else
    body = (
      // Fills whatever height the card is given, so the viewport follows the layout.
      <Box
        onPointerDown={(event) => (pressedAt.current = { x: event.clientX, y: event.clientY })}
        onClick={(event) => {
          const from = pressedAt.current;
          if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) < CLICK_SLOP_PX) open();
        }}
        title={t("dashboard.featuredModel.hint")}
        sx={{ position: "relative", flex: 1, minHeight: 240, cursor: "grab" }}
      >
        <Box sx={{ position: "absolute", inset: 0 }}>
          <ModelViewer
            key={plate.id}
            url={printsApi.fileUrl(plate.url)}
            ext={extOf(plate.filename)}
            viewKey={`featured-${print.id}-${plate.id}`}
            theme={mode}
            previewGlbUrl={plate.preview_glb_url ? printsApi.fileUrl(plate.preview_glb_url) : null}
            initialCameraView="topFront"
            // The default near-white model all but vanishes against the card it now sits on.
            colorOverride={muiTheme.palette.primary.main}
            showBuildPlate={false}
            showOrientationGizmo={false}
            background="transparent"
            autoRotate
          />
        </Box>
      </Box>
    );

  return (
    <DashboardCard sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <DashboardCardTitle icon={<ThreeDRotationIcon />} title={t("dashboard.featuredModel.title")} />
      {body}
    </DashboardCard>
  );
}
