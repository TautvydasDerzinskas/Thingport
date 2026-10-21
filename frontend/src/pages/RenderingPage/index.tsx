import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import type { PreviewMode } from "../../api/settings";
import PreviewsSection from "./PreviewsSection";
import SimplifySection from "./SimplifySection";
import QualityChecksSection from "./QualityChecksSection";

type Props = {
  onUnauthorized?: () => void;
  onPreviewModeChanged?: (mode: PreviewMode) => void;
};

export default function RenderingPage({ onUnauthorized, onPreviewModeChanged }: Props) {
  return (
    <Stack spacing={4} divider={<Divider />}>
      <PreviewsSection onUnauthorized={onUnauthorized} onSaved={onPreviewModeChanged} />
      <SimplifySection onUnauthorized={onUnauthorized} />
      <QualityChecksSection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
