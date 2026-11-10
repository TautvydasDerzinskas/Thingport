import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import LanguageIcon from "@mui/icons-material/Language";
import { languageFlagUrl } from "../constants/languages";

/** A language's flag, `height` px tall at 3:2, or a globe for one without a flag. Decorative: the name says which. */
export default function LanguageFlag({ code, height = 14 }: { code: string; height?: number }) {
  const url = languageFlagUrl(code);
  if (!url)
    return <LanguageIcon aria-hidden sx={{ fontSize: height + 2, width: height * 1.5, color: "text.secondary" }} />;
  return (
    <Box
      component="img"
      src={url}
      alt=""
      loading="lazy"
      sx={{
        width: height * 1.5,
        height,
        flexShrink: 0,
        display: "block",
        borderRadius: "2px",
        objectFit: "cover",
        // A white stripe at the edge would otherwise melt into a light page.
        boxShadow: (theme) => `0 0 0 1px ${alpha(theme.palette.text.primary, 0.12)}`,
      }}
    />
  );
}
