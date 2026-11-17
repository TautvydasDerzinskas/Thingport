import Box from "@mui/material/Box";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ArchitectureOutlinedIcon from "@mui/icons-material/ArchitectureOutlined";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { neutralTint, statusTint } from "../../theme";
import { extOf } from "../../utils/fileExtensions";
import { isPreparedName } from "../../utils/addedFiles";

type Tone = "error" | "info" | "success" | "warning" | "accent" | "neutral";

// A supporting file's kind, told by its name: a colour from the theme and a glyph, so a list reads at a glance.
const KINDS: { exts: string[]; tone: Tone; Icon: SvgIconComponent }[] = [
  { exts: ["pdf"], tone: "error", Icon: PictureAsPdfOutlinedIcon },
  { exts: ["doc", "docx", "odt", "rtf", "pages"], tone: "info", Icon: DescriptionOutlinedIcon },
  { exts: ["txt", "md", "markdown", "nfo", "log"], tone: "neutral", Icon: ArticleOutlinedIcon },
  { exts: ["csv", "tsv", "xls", "xlsx", "ods", "numbers"], tone: "success", Icon: TableChartOutlinedIcon },
  {
    exts: ["f3d", "fcstd", "blend", "skp", "dxf", "dwg", "sldprt", "sldasm", "iges", "igs", "ipt", "iam", "x_t", "3dm"],
    tone: "accent",
    Icon: ArchitectureOutlinedIcon,
  },
  { exts: ["scad", "py", "json", "yaml", "yml", "ini", "cfg"], tone: "accent", Icon: CodeOutlinedIcon },
  { exts: ["zip", "7z", "rar", "tar", "gz"], tone: "warning", Icon: FolderZipOutlinedIcon },
  { exts: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tif", "tiff"], tone: "info", Icon: ImageOutlinedIcon },
];

const OTHER = { tone: "neutral" as Tone, Icon: InsertDriveFileOutlinedIcon };
const PREPARED = { tone: "accent" as Tone, Icon: PrintOutlinedIcon };

function kindOf(filename: string) {
  if (isPreparedName(filename)) return PREPARED;
  const ext = extOf(filename);
  return KINDS.find((kind) => kind.exts.includes(ext)) ?? OTHER;
}

function toneColors(theme: Theme, tone: Tone): { background: string; text: string } {
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

/** A file's kind as a soft square: its type's colour and glyph. Decorative; the name beside it says what it is. */
export default function TypeTile({ filename, size = 36 }: { filename: string; size?: number }) {
  const theme = useTheme();
  const { tone, Icon } = kindOf(filename);
  const { background, text } = toneColors(theme, tone);
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size > 28 ? "9px" : "6px",
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
