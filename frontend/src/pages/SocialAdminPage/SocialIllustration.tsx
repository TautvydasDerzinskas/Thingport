import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PublicIcon from "@mui/icons-material/Public";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { alpha, useTheme } from "@mui/material/styles";
import UserAvatar from "../../components/UserAvatar";

const TILE = 104;
const CARD = 22;
const CYCLE = "2.8s";

const nudge = keyframes`
  0%, 100% { transform: translateX(-3px); opacity: 0.55; }
  50% { transform: translateX(3px); opacity: 1; }
`;

// The shared model glows as it's taken...
const offer = keyframes`
  0%, 15%, 70%, 100% { box-shadow: 0 0 0 0 transparent; }
  35% { box-shadow: 0 0 0 4px var(--offer-glow); }
`;

// ...and its copy appears in the other library, stays a while, and goes for the next round.
const arrive = keyframes`
  0%, 40% { opacity: 0; transform: scale(0.5); }
  55% { opacity: 1; transform: scale(1.12); }
  65%, 90% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
`;

const still = { "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 1, transform: "none" } };

function MiniCard({ highlight = false, animation }: { highlight?: boolean; animation?: string }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        width: CARD,
        height: CARD,
        borderRadius: "6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: alpha(theme.palette.primary.main, highlight ? 0.24 : 0.1),
        color: "primary.main",
        "--offer-glow": alpha(theme.palette.primary.main, 0.25),
        ...(animation ? { animation, ...still } : {}),
      }}
    >
      <ViewInArIcon sx={{ fontSize: 14 }} />
    </Box>
  );
}

function Person({
  id,
  name,
  caption,
  children,
}: {
  id: string;
  name: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <Stack alignItems="center" spacing={0.75}>
      <Stack
        alignItems="center"
        justifyContent="center"
        spacing={1}
        sx={{
          width: TILE,
          height: TILE,
          borderRadius: "18px",
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
        }}
      >
        <UserAvatar user={{ id, display_name: name, avatar_url: null }} size={32} />
        <Stack direction="row" spacing={0.5} alignItems="center">
          {children}
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {caption}
      </Typography>
    </Stack>
  );
}

/** One user's public collection, and a model of it landing as a copy in another's: what social features allow. */
export default function SocialIllustration() {
  const { t } = useTranslation("app");
  return (
    <Stack aria-hidden direction="row" spacing={1.5} alignItems="center" sx={{ flexShrink: 0 }}>
      <Person id="sharer" name="A" caption={t("adminSettings.social.illustrationShares")}>
        <MiniCard />
        <MiniCard highlight animation={`${offer} ${CYCLE} ease-in-out infinite`} />
        <PublicIcon sx={{ fontSize: 16, color: "text.secondary" }} />
      </Person>
      <ArrowForwardIcon color="action" sx={{ mb: 3, animation: `${nudge} 1.4s ease-in-out infinite`, ...still }} />
      <Person id="collector" name="B" caption={t("adminSettings.social.illustrationCollects")}>
        <MiniCard />
        <MiniCard highlight animation={`${arrive} ${CYCLE} ease-out infinite`} />
      </Person>
    </Stack>
  );
}
