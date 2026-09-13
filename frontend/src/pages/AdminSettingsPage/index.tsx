import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import type { PreviewMode } from "../../api/settings";
import StorageSection from "./StorageSection";
import PreviewsSection from "./PreviewsSection";
import ThingiverseSection from "./ThingiverseSection";

type Props = {
  onUnauthorized?: () => void;
  onPreviewModeChanged?: (mode: PreviewMode) => void;
};

// Instance-wide config, gated to admins by the sidebar link that opens this page -- unlike
// SettingsPage, nothing here is a per-user preference. All three settings are shown together on
// one page rather than behind separate click-through sections, since there are only three and
// none of them is long enough to need its own screen.
export default function AdminSettingsPage({ onUnauthorized, onPreviewModeChanged }: Props) {
  return (
    <Stack spacing={4} divider={<Divider />}>
      <ThingiverseSection onUnauthorized={onUnauthorized} />
      <StorageSection onUnauthorized={onUnauthorized} />
      <PreviewsSection onUnauthorized={onUnauthorized} onSaved={onPreviewModeChanged} />
    </Stack>
  );
}
