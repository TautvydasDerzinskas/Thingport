import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import StorageSection from "./StorageSection";
import ConsumeSection from "./ConsumeSection";
import ThingiverseSection from "./ThingiverseSection";
import SessionSection from "./SessionSection";
import AiCategorizationSection from "./AiCategorizationSection";

type Props = {
  onUnauthorized?: () => void;
};

// Instance-wide settings, all on one page.
export default function AdminSettingsPage({ onUnauthorized }: Props) {
  return (
    <Stack spacing={4} divider={<Divider />}>
      <ThingiverseSection onUnauthorized={onUnauthorized} />
      <AiCategorizationSection onUnauthorized={onUnauthorized} />
      <StorageSection onUnauthorized={onUnauthorized} />
      <ConsumeSection onUnauthorized={onUnauthorized} />
      <SessionSection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
