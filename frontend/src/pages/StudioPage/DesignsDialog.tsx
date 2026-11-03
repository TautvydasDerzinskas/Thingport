import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import { studioApi, type StudioDesignSummary } from "../../api/studio";
import { relativeTime } from "../../utils/relativeTime";
import { BoxIcon } from "./studioIcons";

type Props = {
  open: boolean;
  currentId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onError: (error: unknown) => void;
};

/** The user's designs, newest change first, to open one. */
export default function DesignsDialog({ open, currentId, onClose, onOpen, onNew, onError }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const [designs, setDesigns] = useState<StudioDesignSummary[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setDesigns(null);
    studioApi.list().then(setDesigns, (error: unknown) => {
      setDesigns([]);
      onError(error);
    });
  }, [open, onError]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("studio.design.openTitle")}</DialogTitle>
      <DialogContent sx={{ px: 1.5 }}>
        {designs === null ? (
          <ListRowSkeletons count={4} leadSize={28} twoLines />
        ) : designs.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
            {t("studio.design.empty")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {designs.map((design) => (
              <ListItemButton
                key={design.id}
                selected={design.id === currentId}
                onClick={() => onOpen(design.id)}
                sx={{ borderRadius: 1.5 }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: "text.secondary" }}>
                  <BoxIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={design.name}
                  secondary={`${t("studio.design.features", { count: design.feature_count })} · ${relativeTime(
                    design.updated_at,
                    i18n.language,
                  )}`}
                  primaryTypographyProps={{ noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<AddBoxOutlinedIcon />} onClick={onNew}>
          {t("studio.design.new")}
        </Button>
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
