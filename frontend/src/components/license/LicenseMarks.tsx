import Box from "@mui/material/Box";
import AttributionOutlinedIcon from "@mui/icons-material/AttributionOutlined";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CodeIcon from "@mui/icons-material/Code";
import DoNotDisturbOnOutlinedIcon from "@mui/icons-material/DoNotDisturbOnOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import type { LicenseFamily, LicenseMark } from "../../api/prints";

type Props = {
  marks: LicenseMark[];
  family: LicenseFamily | null;
  size?: number;
};

/** A licence's marks: Creative Commons' as ringed icons of our own (so they follow the theme), and one icon for the
 *  rest, by kind. Decorative: the licence's name is always beside them. */
export default function LicenseMarks({ marks, family, size = 16 }: Props) {
  const ring = {
    width: size,
    height: size,
    borderRadius: "50%",
    border: 1.5,
    borderColor: "currentColor",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.62,
    lineHeight: 1,
    flexShrink: 0,
  } as const;
  const letters = (text: string, scale: number) => (
    <Box component="span" sx={{ fontWeight: 800, fontSize: size * scale, letterSpacing: "-0.04em" }}>
      {text}
    </Box>
  );
  const glyph = (mark: LicenseMark) => {
    switch (mark) {
      case "cc":
        return letters("cc", 0.46);
      case "by":
        return <AttributionOutlinedIcon sx={{ fontSize: "inherit" }} />;
      case "nc":
        return <MoneyOffIcon sx={{ fontSize: "inherit" }} />;
      case "sa":
        return <AutorenewIcon sx={{ fontSize: "inherit" }} />;
      case "nd":
        return <DoNotDisturbOnOutlinedIcon sx={{ fontSize: "inherit" }} />;
      case "zero":
        return letters("0", 0.5);
      case "pd":
        return letters("PD", 0.36);
    }
  };
  const shown: React.ReactNode[] = marks.length
    ? marks.map((mark) => (
        <Box component="span" key={mark} sx={ring}>
          {glyph(mark)}
        </Box>
      ))
    : [
        <Box component="span" key="family" sx={{ display: "inline-flex", fontSize: size + 2 }}>
          {family === "open" ? (
            <CodeIcon sx={{ fontSize: "inherit" }} />
          ) : family === "reserved" ? (
            <LockOutlinedIcon sx={{ fontSize: "inherit" }} />
          ) : (
            <GavelOutlinedIcon sx={{ fontSize: "inherit" }} />
          )}
        </Box>,
      ];
  return (
    <Box component="span" aria-hidden="true" sx={{ display: "inline-flex", gap: "3px", color: "text.secondary" }}>
      {shown}
    </Box>
  );
}
