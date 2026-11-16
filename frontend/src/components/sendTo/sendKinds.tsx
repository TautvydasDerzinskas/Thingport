import type { ComponentType } from "react";
import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import PrecisionManufacturingOutlinedIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import type { SendHow, SendPreset } from "../../api/sendTargets";

/** A destination's kind: one of the presets, or a link or request of the user's own. */
export type SendKind = SendPreset | "link" | "request";

type KindInfo = {
  group: "printers" | "webhooks" | "own";
  Icon: ComponentType<SvgIconProps>;
  /** Which of the theme's chart hues its tile takes, so each kind reads apart. */
  hue: number;
  /** An example address, shown until one is typed. */
  example: string;
  /** The file endings it starts with, which the user can change. */
  fileTypes: string[];
  /** Whether it asks for an API key, and whether one is needed. */
  apiKey: "required" | "optional" | null;
};

export const SEND_KINDS: Record<SendKind, KindInfo> = {
  octoprint: {
    group: "printers",
    Icon: PrintOutlinedIcon,
    hue: 1,
    example: "http://octopi.local",
    fileTypes: ["gcode", "gco", "g"],
    apiKey: "required",
  },
  moonraker: {
    group: "printers",
    Icon: BoltOutlinedIcon,
    hue: 3,
    example: "http://printer.local:7125",
    fileTypes: ["gcode", "gco", "g"],
    apiKey: "optional",
  },
  prusalink: {
    group: "printers",
    Icon: PrecisionManufacturingOutlinedIcon,
    hue: 1,
    example: "http://prusa-mk4.local",
    fileTypes: ["gcode", "bgcode"],
    apiKey: "required",
  },
  homeassistant: {
    group: "webhooks",
    Icon: HomeOutlinedIcon,
    hue: 0,
    example: "http://homeassistant.local:8123/api/webhook/thingport-print",
    fileTypes: [],
    apiKey: null,
  },
  n8n: {
    group: "webhooks",
    Icon: AccountTreeOutlinedIcon,
    hue: 4,
    example: "http://n8n.local:5678/webhook/thingport",
    fileTypes: [],
    apiKey: null,
  },
  nodered: {
    group: "webhooks",
    Icon: HubOutlinedIcon,
    hue: 2,
    example: "http://nodered.local:1880/thingport",
    fileTypes: [],
    apiKey: null,
  },
  link: {
    group: "own",
    Icon: LinkOutlinedIcon,
    hue: 0,
    example: "https://studio.local/?load={file_url}",
    fileTypes: [],
    apiKey: null,
  },
  request: {
    group: "own",
    Icon: CloudUploadOutlinedIcon,
    hue: 5,
    example: "http://receiver.local:8765/upload",
    fileTypes: [],
    apiKey: null,
  },
};

export const SEND_GROUPS = ["printers", "webhooks", "own"] as const;

export function kindOfHow(how: SendHow): SendKind {
  return how.type === "preset" ? how.preset : how.type;
}

export function kindOf(summary: { kind: SendHow["type"]; preset: SendPreset | null }): SendKind {
  return summary.kind === "preset" && summary.preset ? summary.preset : summary.kind === "link" ? "link" : "request";
}

/** Whether a destination is offered for a file: one of its endings, or any file when it names none. */
export function takesFile(fileTypes: string[], filename: string): boolean {
  if (!fileTypes.length) return true;
  const name = filename.toLowerCase();
  return fileTypes.some((type) => name.endsWith(`.${type}`));
}

/** A kind's icon on a tile tinted with its hue. */
export function SendKindIcon({ kind, size = 32 }: { kind: SendKind; size?: number }) {
  const { Icon, hue } = SEND_KINDS[kind];
  return (
    <Box
      aria-hidden
      sx={(theme) => {
        const color = theme.thingport.chart.series[hue % theme.thingport.chart.series.length];
        return {
          width: size,
          height: size,
          borderRadius: "8px",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          bgcolor: alpha(color, theme.palette.mode === "dark" ? 0.18 : 0.12),
        };
      }}
    >
      <Icon sx={{ fontSize: Math.round(size * 0.58) }} />
    </Box>
  );
}
