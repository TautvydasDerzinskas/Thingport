import { useId } from "react";
import { useTranslation } from "react-i18next";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import FavoriteIcon from "@mui/icons-material/Favorite";

/** Thanks to the people who helped with a release: a chip each, with their GitHub picture, opening their profile.
 *  Offline, the picture falls back to their initial. Nothing when nobody is listed. */
export default function ReleaseContributors({
  version,
  logins,
  sx,
}: {
  version: string;
  logins: string[];
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation("app");
  const headingId = useId();
  if (!logins.length) return null;
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={[{ p: 2, borderRadius: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
        <FavoriteIcon aria-hidden sx={{ fontSize: 18, color: (theme) => theme.thingport.support.heart }} />
        <Typography id={headingId} variant="subtitle2" fontWeight={700}>
          {t("whatsNew.thanks", { version })}
        </Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 1 }}>
        {logins.map((login) => (
          <li key={login}>
            <Chip
              component="a"
              href={`https://github.com/${login}`}
              target="_blank"
              rel="noopener noreferrer"
              clickable
              size="small"
              label={login}
              aria-label={t("whatsNew.contributor", { login })}
              avatar={
                <Avatar
                  src={`https://github.com/${login}.png?size=48`}
                  alt=""
                  slotProps={{ img: { loading: "lazy", referrerPolicy: "no-referrer" } }}
                >
                  {login.charAt(0).toUpperCase()}
                </Avatar>
              }
            />
          </li>
        ))}
      </Box>
    </Paper>
  );
}
