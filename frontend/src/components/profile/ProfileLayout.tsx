import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ProfileCoverValue } from "../../constants/profileCovers";
import MarkdownDescription from "../MarkdownDescription";
import { CardSkeletons } from "../media/CardSkeleton";
import { cardGridSx } from "../media/cardGrid";
import ProfileCover from "./ProfileCover";
import ProfileLinks from "./ProfileLinks";

export const PROFILE_COVER_HEIGHT = 184;

const cardSx = {
  maxWidth: "1920px",
  mx: "auto",
  bgcolor: "background.paper",
  borderRadius: "12px",
  overflow: "hidden",
};
const columnsSx = { display: "grid", gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, gap: "32px" };

type Props = {
  cover: ProfileCoverValue | null | undefined;
  /** Laid over the cover, e.g. the button that changes it. */
  coverAction?: ReactNode;
  avatar: ReactNode;
  name: string;
  /** Under the name: a handle, or when they joined. */
  subtitle?: ReactNode;
  /** Under that: chips, buttons. */
  actions?: ReactNode;
  bio: string | null | undefined;
  /** A user's bio is Markdown, as they wrote it; an author's is the plain text their site had. */
  bioMarkdown?: boolean;
  /** Someone on a partner instance: their bio shows no images (see MarkdownDescription). */
  remote?: boolean;
  links?: string[];
  /** Beside them: what they made. */
  children: ReactNode;
};

/** A person's page -- the user's own My models, an author's, or another user's on Explore: their cover, then who they
 *  are beside what they made. */
export default function ProfileLayout({
  cover,
  coverAction,
  avatar,
  name,
  subtitle,
  actions,
  bio,
  bioMarkdown,
  remote,
  links,
  children,
}: Props) {
  const { t } = useTranslation("models");
  return (
    <Box sx={cardSx}>
      <ProfileCover cover={cover} height={PROFILE_COVER_HEIGHT}>
        {coverAction}
      </ProfileCover>
      <Box sx={{ px: 3 }}>
        {/* Stretched so the profile column's border runs the grid's full height. */}
        <Box sx={{ ...columnsSx, alignItems: "stretch", py: 3 }}>
          <Box
            sx={{
              borderRight: { xs: "none", md: "1px solid" },
              // Unlike dividerBorderColor, this stays visible in dark mode.
              borderColor: "divider",
              pr: { xs: 0, md: 4 },
              minWidth: 0,
            }}
          >
            {avatar}
            <Typography variant="h5" fontWeight={700} sx={{ mt: 2, color: (theme) => theme.thingport.headingText }}>
              {name}
            </Typography>
            {/* Text in a line of its own; anything else (a handle with its buttons) can't sit in a paragraph. */}
            {subtitle &&
              (typeof subtitle === "string" ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {subtitle}
                </Typography>
              ) : (
                subtitle
              ))}
            {actions}

            <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
              {t("author.bio")}
            </Typography>
            {bio && bioMarkdown ? (
              <Box sx={{ typography: "body2", "& p": { my: 0.5 } }}>
                <MarkdownDescription markdown={bio} remote={remote} />
              </Box>
            ) : (
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", color: bio ? "text.primary" : "text.disabled" }}
              >
                {bio || t("author.noBio")}
              </Typography>
            )}
            {links && links.length > 0 && <ProfileLinks links={links} />}
          </Box>
          <Box sx={{ minWidth: 0, py: 3 }}>{children}</Box>
        </Box>
      </Box>
    </Box>
  );
}

/** The page on its way. A cover already known -- the user's own -- shows at once. */
export function ProfileLayoutSkeleton({ cover }: { cover?: ProfileCoverValue | null }) {
  return (
    <Box sx={cardSx} aria-hidden>
      {cover ? (
        <ProfileCover cover={cover} height={PROFILE_COVER_HEIGHT} />
      ) : (
        <Skeleton variant="rectangular" height={PROFILE_COVER_HEIGHT} />
      )}
      <Box sx={{ ...columnsSx, p: 3 }}>
        <Stack spacing={1.5} alignItems={{ xs: "center", md: "flex-start" }}>
          <Skeleton variant="circular" width={112} height={112} />
          <Skeleton variant="text" sx={{ fontSize: "1.5rem", width: "60%" }} />
          <Skeleton variant="text" sx={{ width: "40%" }} />
          <Skeleton variant="text" sx={{ width: "90%" }} />
          <Skeleton variant="text" sx={{ width: "80%" }} />
        </Stack>
        <Box sx={cardGridSx(5)}>
          <CardSkeletons count={10} />
        </Box>
      </Box>
    </Box>
  );
}
