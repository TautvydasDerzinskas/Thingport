import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { printsApi } from "../../api/prints";
import type { RemoteOrigin } from "../../api/social";
import InstanceChip from "../../components/InstanceChip";
import UserAvatar from "../../components/UserAvatar";

const monoSx = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

/** On a copy of a partner instance's model: whose it was and where, and the original while it's still shared. */
export default function CopiedFromRemote({ origin }: { origin: RemoteOrigin }) {
  const { t } = useTranslation(["models"]);
  const person = {
    // Coloured as on their own pages while they're listed; by their handle once they aren't.
    id: origin.owner_id ?? origin.owner_handle ?? `${origin.owner_name}@${origin.instance.origin}`,
    display_name: origin.owner_name,
    avatar_url: origin.owner_avatar_url ? printsApi.fileUrl(origin.owner_avatar_url) : null,
  };
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {t("models:explore.elsewhere.copiedFrom")}
      </Typography>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
        <UserAvatar user={person} size={32} />
        <Stack sx={{ minWidth: 0, flex: 1 }}>
          {origin.owner_id ? (
            <Link
              component={RouterLink}
              to={`/explore/elsewhere/people/${origin.owner_id}`}
              underline="hover"
              variant="body2"
              fontWeight={600}
              noWrap
            >
              {origin.owner_name}
            </Link>
          ) : (
            <Typography variant="body2" fontWeight={600} noWrap>
              {origin.owner_name}
            </Typography>
          )}
          {origin.owner_handle && (
            <Typography variant="caption" color="text.secondary" noWrap sx={monoSx}>
              {origin.owner_handle}
            </Typography>
          )}
        </Stack>
        <Box sx={{ flexShrink: 0, maxWidth: "45%" }}>
          <InstanceChip instance={origin.instance} label={origin.instance.name} />
        </Box>
      </Stack>
      {origin.original_id && (
        <Link
          component={RouterLink}
          to={`/explore/elsewhere/models/${origin.original_id}`}
          underline="hover"
          variant="body2"
          fontWeight={600}
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, mt: 0.75 }}
        >
          {t("models:explore.elsewhere.seeOriginal")}
          <ChevronRightIcon sx={{ fontSize: 16 }} />
        </Link>
      )}
    </Box>
  );
}
