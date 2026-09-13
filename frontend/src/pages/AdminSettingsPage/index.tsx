import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import type { PreviewMode } from "../../api/settings";
import StorageSection from "./StorageSection";
import PreviewsSection from "./PreviewsSection";
import ThingiverseSection from "./ThingiverseSection";
import UpdateCheckSection from "./UpdateCheckSection";

type Props = {
  onUnauthorized?: () => void;
  onPreviewModeChanged?: (mode: PreviewMode) => void;
};

// Instance-wide config, gated to admins by the sidebar link that opens this page -- unlike
// SettingsPage, nothing here is a per-user preference. All sections are shown together on one
// page rather than behind separate click-through sections, since none of them is long enough to
// need its own screen. Update Checker goes first since it's a quick at-a-glance status, not a
// setting to configure.
export default function AdminSettingsPage({ onUnauthorized, onPreviewModeChanged }: Props) {
  return (
    <Stack spacing={4} divider={<Divider />}>
      <UpdateCheckSection onUnauthorized={onUnauthorized} />
      <ThingiverseSection onUnauthorized={onUnauthorized} />
      <StorageSection onUnauthorized={onUnauthorized} />
      <PreviewsSection onUnauthorized={onUnauthorized} onSaved={onPreviewModeChanged} />
    </Stack>
  );
}
