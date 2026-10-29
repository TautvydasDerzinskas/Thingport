import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import { keyframes } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import type { AdminTool } from "../../api/tools";

const appear = keyframes`from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: none; }`;

type Props = { tool: AdminTool; busy: boolean; onUpdate: () => void };

/** Under an installed tool's tile: its update in one click, or that it's already the newest the repository has.
 *  A sibling of the tile rather than part of it, because the tile is itself a button. */
export default function ToolUpdateBadge({ tool, busy, onUpdate }: Props) {
  const { t } = useTranslation("app");
  const { installed, manifest } = tool;
  // A tool that isn't installed has nothing to update, and one the repository has dropped has nowhere to update
  // from -- the details dialog is where that is said.
  if (!installed || !tool.inRepo) return null;
  const update = installed.updateAvailable;

  return (
    <Box sx={{ display: "flex", justifyContent: "center", pb: 0.5 }}>
      <Tooltip
        title={
          update
            ? t("adminSettings.tools.repo.updateTo", { version: manifest.version })
            : t("adminSettings.tools.repo.latestTip", { name: manifest.name, version: installed.version })
        }
      >
        <Chip
          // Remounted when the state flips, so the green label fades in once the update has been taken.
          key={update ? "update" : "latest"}
          size="small"
          label={update ? t("adminSettings.tools.repo.update") : t("adminSettings.tools.repo.latest")}
          // Info for an update, success for the newest: the states stay apart whatever accent the user picked, and
          // they read as the details dialog's chips do.
          color={update ? "info" : "success"}
          variant={update ? "filled" : "outlined"}
          icon={
            busy ? <CircularProgress size={11} color="inherit" /> : update ? <SystemUpdateAltIcon /> : <CheckIcon />
          }
          clickable={update}
          disabled={busy}
          aria-label={
            update
              ? t("adminSettings.tools.repo.updateLabel", { name: manifest.name, version: manifest.version })
              : undefined
          }
          onClick={update ? onUpdate : undefined}
          sx={{
            height: 20,
            fontSize: "0.64rem",
            fontWeight: 600,
            maxWidth: "100%",
            animation: `${appear} 200ms ease-out both`,
            "& .MuiChip-label": { px: 0.6 },
            "& .MuiChip-icon": { fontSize: 12, ml: 0.6, mr: -0.25 },
            ...(update && {
              transition: "transform 150ms ease, box-shadow 150ms ease",
              "&:hover": { transform: "translateY(-1px)", boxShadow: 2 },
              // The chip's own focus style is only a shade darker, which is too quiet for a keyboard to follow.
              "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
            }),
            "@media (prefers-reduced-motion: reduce)": { animation: "none", "&:hover": { transform: "none" } },
          }}
        />
      </Tooltip>
    </Box>
  );
}
