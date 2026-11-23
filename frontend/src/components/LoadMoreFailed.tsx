import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

/** Where a list's next page couldn't be read: says so with a retry, rather than the list asking again on its own. */
export default function LoadMoreFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      spacing={1}
      sx={{ color: "text.secondary", py: 1 }}
    >
      <Typography variant="body2">{message}</Typography>
      <Button size="small" onClick={onRetry}>
        {t("common:retry")}
      </Button>
    </Stack>
  );
}
