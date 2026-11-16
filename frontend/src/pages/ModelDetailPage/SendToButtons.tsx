import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import type { SendTargetSummary } from "../../api/sendTargets";
import { SendKindIcon, kindOf } from "../../components/sendTo/sendKinds";

type Props = {
  targets: SendTargetSummary[];
  sending: string | null;
  onSend: (target: SendTargetSummary) => void;
};

/** The Send to destinations the user wants as buttons of their own, under the model's Open button. */
export default function SendToButtons({ targets, sending, onSend }: Props) {
  const { t } = useTranslation("models");
  if (!targets.length) return null;
  return (
    <Stack spacing={1}>
      {targets.map((target) => (
        <Button
          key={target.id}
          variant="outlined"
          fullWidth
          disabled={sending === target.id}
          onClick={() => onSend(target)}
          startIcon={
            sending === target.id ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <SendKindIcon kind={kindOf(target)} size={20} />
            )
          }
          sx={{ minWidth: 0 }}
        >
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t(target.kind === "link" ? "models:detail.sendTo.openIn" : "models:detail.sendTo.button", {
              name: target.name,
            })}
          </Box>
        </Button>
      ))}
    </Stack>
  );
}
