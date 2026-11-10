import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { KeyBlocks, Mono } from "./parts";

type Props = {
  fingerprint: string;
  /** Another instance's; this instance's own when left out. */
  name?: string;
  origin?: string | null;
  onClose: () => void;
};

/** A key large enough to read out to another admin, on the phone or side by side. */
export default function KeyDialog({ fingerprint, name, origin, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const k = (key: string) => `adminSettings.social.federation.keyDialog.${key}`;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{name ? t(k("theirs"), { name }) : t(k("ours"))}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {origin && <Mono>{origin}</Mono>}
          <KeyBlocks fingerprint={fingerprint} large />
          <Typography variant="body2" color="text.secondary">
            {name ? t(k("theirsText"), { name }) : t(k("oursText"))}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
