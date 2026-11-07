import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ButtonBase from "@mui/material/ButtonBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { ExplorePerson, RemotePerson } from "../../api/social";
import InstanceAvatar from "../../components/InstanceAvatar";
import UserAvatar from "../../components/UserAvatar";

/** Someone who shares collections, leading to them: on this instance, or on a partner, with its badge on their avatar
 *  and their handle under their name. */
export default function PersonCard({ person }: { person: ExplorePerson | RemotePerson }) {
  const { t } = useTranslation("models");
  const navigate = useNavigate();
  const remote = "instance" in person ? person : null;
  return (
    <ButtonBase
      onClick={() => navigate(remote ? `/explore/elsewhere/people/${person.id}` : `/explore/users/${person.id}`)}
      aria-label={person.display_name}
      sx={{
        display: "block",
        width: "100%",
        textAlign: "left",
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        p: 1.5,
        transition: "box-shadow .15s ease, transform .15s ease, border-color .15s ease",
        "&:hover": { boxShadow: 4, transform: "translateY(-2px)" },
        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
        <Box sx={{ position: "relative", flexShrink: 0 }}>
          <UserAvatar user={person} size={44} />
          {remote && (
            <Box
              title={remote.instance.name}
              sx={{
                position: "absolute",
                right: -4,
                bottom: -4,
                borderRadius: "6px",
                border: 2,
                borderColor: "background.paper",
                display: "flex",
              }}
            >
              <InstanceAvatar origin={remote.instance.origin} name={remote.instance.name} size={18} />
            </Box>
          )}
        </Box>
        <Stack sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            fontWeight={700}
            noWrap
            title={person.display_name}
            sx={{ color: (theme) => theme.thingport.headingText }}
          >
            {person.display_name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {remote?.handle ??
              t("explore.personCounts", {
                collections: t("explore.collectionCount", { count: person.collection_count }),
                models: t("explore.modelCount", { count: person.model_count }),
              })}
          </Typography>
        </Stack>
      </Stack>
    </ButtonBase>
  );
}
