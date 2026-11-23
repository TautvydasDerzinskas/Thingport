import Box from "@mui/material/Box";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import { useIconSrc } from "../IconPicker/iconCatalog";

// A mask is fetched in CORS mode, so another site's image would draw nothing: only inline and same-origin ones.
const maskable = (src: string) => src.startsWith("data:") || (src.startsWith("/") && !src.startsWith("//"));

/**
 * A tool's one-colour `symbol`, tinted like Thingport's own icons beside it, disabled state included. Without one, the
 * tool's icon is drawn in one colour the same way, or a toolbox where that can't be.
 */
export default function ToolSymbol({
  symbol,
  iconUrl,
  size = 20,
}: {
  symbol?: string;
  iconUrl?: string;
  size?: number;
}) {
  const icon = useIconSrc(iconUrl);
  const src = symbol ?? (icon && maskable(icon) ? icon : undefined);
  if (!src) return <HandymanOutlinedIcon sx={{ fontSize: size }} />;
  const mask = `url("${src.replace(/"/g, "%22")}") center / contain no-repeat`;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: "inline-block", flexShrink: 0, width: size, height: size, bgcolor: "currentColor", mask }}
    />
  );
}
