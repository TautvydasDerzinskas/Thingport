import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { ChatAttachment } from "../../api/chats";
import { ModelThumb } from "../../components/ModelPickerDialog";

/** A model sent in a message: its picture and whose it is, opening its page. Another user's opens under Explore, with
 *  everything but changing it; one that's gone says so. */
export default function AttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const { t } = useTranslation(["app", "models"]);
  const navigate = useNavigate();
  const model = attachment.model;
  // A partner's opens on Explore, with its slicer, download and copy; another user's there too; one's own in the library.
  const path = model
    ? model.remote
      ? `/explore/elsewhere/models/${model.id}`
      : model.owner
        ? `/explore/models/${model.id}`
        : `/models/${model.id}`
    : null;
  const name = model?.name ?? attachment.name;
  const whose = !model
    ? t("chats.modelUnavailable")
    : model.remote
      ? t("models:explore.elsewhere.on", { name: model.instance?.name ?? "" })
      : model.owner
        ? t("chats.modelFrom", { name: model.owner.display_name })
        : t("chats.yourModel");
  return (
    <ButtonBase
      disabled={!path}
      onClick={() => path && navigate(path)}
      aria-label={path ? t("chats.openModel", { name }) : undefined}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        width: 260,
        maxWidth: "100%",
        p: 1,
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        textAlign: "left",
        transition: "border-color 150ms, transform 150ms",
        "&:hover": { borderColor: "primary.main" },
        "&:active": { transform: "scale(0.98)" },
        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        "&.Mui-disabled": { opacity: 0.6 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:active": { transform: "none" } },
      }}
    >
      <ModelThumb url={model?.thumb_url} size={48} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {whose}
        </Typography>
      </Box>
      {path && <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />}
    </ButtonBase>
  );
}
