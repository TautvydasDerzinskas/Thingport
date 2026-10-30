import { useState } from "react";
import Box from "@mui/material/Box";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import { useIconSrc } from "../IconPicker/iconCatalog";

/** A tool's icon: its picked icon or image address, else, or when it doesn't load, a toolbox. */
export default function ToolIcon({ iconUrl: picked, size = 24 }: { iconUrl?: string; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const iconUrl = useIconSrc(picked);
  if (iconUrl && broken !== iconUrl)
    return (
      <Box
        component="img"
        src={iconUrl}
        alt=""
        onError={() => setBroken(iconUrl)}
        sx={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  return <HandymanOutlinedIcon sx={{ fontSize: size }} />;
}
