import Box from "@mui/material/Box";
import type { ResolvedTheme } from "../constants/settingsOptions";
import { useBrandMark } from "../hooks/useBrandLogo";

type Props = {
  theme: ResolvedTheme;
  size?: "lg" | "md" | "sm";
};

const HEIGHTS: Record<NonNullable<Props["size"]>, string> = {
  lg: "2.25rem",
  md: "1.5rem",
  sm: "1.125rem",
};

/** Icon-only mark, for places where the `theme` prop rather than MUI's theme picks the variant. */
export default function BrandMark({ theme, size = "md" }: Props) {
  const src = useBrandMark(theme === "dark");
  return (
    <Box component="img" src={src} alt="Thingport" sx={{ height: HEIGHTS[size], width: "auto", display: "block" }} />
  );
}
