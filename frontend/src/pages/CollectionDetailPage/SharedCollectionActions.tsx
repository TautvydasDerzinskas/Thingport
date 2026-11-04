import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DownloadIcon from "@mui/icons-material/Download";
import type { Collection } from "../../api/collections";
import type { UserCard } from "../../api/social";
import DownloadZipConfirmDialog from "../../components/DownloadZipConfirmDialog";
import UserAvatar from "../../components/UserAvatar";

type Props = {
  collection: Collection;
  owner: UserCard;
  onUnauthorized?: () => void;
};

/** The header of another user's public collection: whose it is, leading to the rest they share, and downloading it.
 *  Nothing that would change it: that's theirs. */
export default function SharedCollectionActions({ collection, owner, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const [downloadOpen, setDownloadOpen] = useState(false);
  const sharedBy = t("models:shared.sharedBy", { name: owner.display_name });

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Tooltip title={t("models:shared.moreFrom", { name: owner.display_name })}>
        <ButtonBase
          onClick={() => navigate(`/explore/users/${owner.id}`)}
          aria-label={sharedBy}
          sx={{
            gap: 0.75,
            pl: 0.5,
            pr: 1.25,
            py: 0.5,
            borderRadius: 999,
            border: 1,
            borderColor: "divider",
            color: (theme) => theme.thingport.headingText,
            transition: (theme) => theme.transitions.create("background-color", { duration: 150 }),
            "&:hover": { bgcolor: "action.hover" },
            "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
          }}
        >
          <UserAvatar user={owner} size={24} />
          <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 180 }}>
            {owner.display_name}
          </Typography>
        </ButtonBase>
      </Tooltip>
      <Tooltip title={t("models:collections.downloadAllZip")}>
        <IconButton
          size="small"
          aria-label={t("models:collections.downloadAllZip")}
          onClick={() => setDownloadOpen(true)}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <DownloadZipConfirmDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        filter={{ collection_id: collection.id }}
        filename={`${collection.name || "collection"}.zip`}
        title={t("models:collections.downloadZipTitle", { name: collection.name })}
        onUnauthorized={onUnauthorized}
      />
    </Stack>
  );
}
