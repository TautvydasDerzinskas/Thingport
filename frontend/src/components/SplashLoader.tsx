import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useRotatingPhrase } from "../hooks/useRotatingPhrase";
import { DISPLAY_FONT_STACK } from "../theme";

const PHRASE_MS = 2200;

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const phraseIn = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

type Props = {
  /** A name pressed faintly into the page above the spinner. */
  title: string;
  /** What a screen reader hears, once: the phrases are only for show. */
  label: string;
  /** An `app` key holding phrases, shown in random order while it waits. */
  phrasesKey: string;
  /** A line that stays under the phrases, such as the file being opened. */
  detail?: string;
};

/** A full-page wait for something big to open. */
export default function SplashLoader({ title, label, phrasesKey, detail }: Props) {
  const phrase = useRotatingPhrase(phrasesKey, true, { random: true, intervalMs: PHRASE_MS });
  return (
    <Stack
      component="output"
      alignItems="center"
      justifyContent="center"
      sx={{
        minHeight: "60vh",
        px: 2,
        textAlign: "center",
        animation: `${fadeIn} 300ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Box sx={visuallyHidden}>{label}</Box>
      <Box
        aria-hidden
        sx={(theme) => {
          const dark = theme.palette.mode === "dark";
          const { black, white } = theme.palette.common;
          return {
            mb: { xs: 3, sm: 4 },
            fontFamily: DISPLAY_FONT_STACK,
            fontWeight: 700,
            fontSize: "clamp(2.75rem, 10vw, 6.5rem)",
            // Room for descenders: the fill only reaches as far as the box.
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            userSelect: "none",
            // Letterpress: the fill is clipped to the letters and the light shadow, dropped inside them, leaves a dark
            // rim along their top edge, so they read as cut into the page.
            color: "transparent",
            backgroundColor: alpha(black, dark ? 0.35 : 0.14),
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            textShadow: `0 2px 1px ${alpha(white, dark ? 0.06 : 0.75)}`,
          };
        }}
      >
        {title}
      </Box>
      <CircularProgress size={28} aria-hidden />
      <Typography
        key={phrase}
        component="span"
        aria-hidden
        color="text.secondary"
        sx={{
          mt: 2,
          minHeight: "1.5em",
          overflowWrap: "anywhere",
          animation: `${phraseIn} 250ms ease-out`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {phrase}
      </Typography>
      {detail && (
        <Typography
          component="span"
          aria-hidden
          variant="caption"
          color="text.disabled"
          sx={{ mt: 0.5, maxWidth: "100%", overflowWrap: "anywhere" }}
        >
          {detail}
        </Typography>
      )}
    </Stack>
  );
}
