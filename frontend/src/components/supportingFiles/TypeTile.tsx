import Box from "@mui/material/Box";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import ArchitectureOutlinedIcon from "@mui/icons-material/ArchitectureOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import type { ContentKind, FileView } from "../../api/prints";
import { neutralTint, statusTint } from "../../theme";
import { tileLook, type TileGlyph, type TileTone } from "./tileLook";

const GLYPHS: Record<TileGlyph, SvgIconComponent> = {
  pdf: PictureAsPdfOutlinedIcon,
  table: TableChartOutlinedIcon,
  picture: ImageOutlinedIcon,
  code: CodeOutlinedIcon,
  text: ArticleOutlinedIcon,
  document: DescriptionOutlinedIcon,
  design: ArchitectureOutlinedIcon,
  mesh: ViewInArOutlinedIcon,
  sliced: PrintOutlinedIcon,
  archive: FolderZipOutlinedIcon,
  file: InsertDriveFileOutlinedIcon,
};

function toneColors(theme: Theme, tone: TileTone): { background: string; text: string } {
  const dark = theme.palette.mode === "dark";
  if (tone === "accent") {
    return {
      background: alpha(theme.palette.primary.main, dark ? 0.2 : 0.11),
      text: dark ? theme.palette.primary.light : theme.palette.primary.dark,
    };
  }
  if (tone === "neutral") return { background: neutralTint(theme), text: theme.palette.text.secondary };
  return statusTint(theme, tone);
}

/** A file's kind as a soft square: its colour and glyph. Decorative; the name beside it says what it is. */
export default function TypeTile({
  kind,
  view,
  size = 36,
}: {
  kind?: ContentKind;
  view?: FileView | null;
  size?: number;
}) {
  const theme = useTheme();
  const { tone, glyph } = tileLook(kind, view);
  const { background, text } = toneColors(theme, tone);
  const Icon = GLYPHS[glyph];
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        // Square in the dark theme, as its other shapes are.
        borderRadius: theme.palette.mode === "dark" ? 0 : size > 28 ? "9px" : "6px",
        bgcolor: background,
        color: text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon sx={{ fontSize: Math.round(size * 0.52) }} />
    </Box>
  );
}
