import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import ConsumeSection from "./ConsumeSection";
import StorageSection from "./StorageSection";

type Props = {
  onUnauthorized?: () => void;
};

/** Where model files go: the folder layout, and the folder they're picked up from. */
export default function StoragePage({ onUnauthorized }: Props) {
  return (
    <Stack spacing={4} divider={<Divider />}>
      <StorageSection onUnauthorized={onUnauthorized} />
      <ConsumeSection onUnauthorized={onUnauthorized} />
    </Stack>
  );
}
