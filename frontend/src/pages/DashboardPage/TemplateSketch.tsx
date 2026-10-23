import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import type { DashboardTemplate } from "../../api/settings";
import { resolveLayout } from "./templates";
import { widgetById } from "./widgets";

/** A small drawing of a template on the wide grid: counts in the accent colour, other panels in grey, a tabbed
 *  panel with its tab strip. */
export default function TemplateSketch({ template, small = false }: { template: DashboardTemplate; small?: boolean }) {
  const layout = resolveLayout(template, "lg");
  const rows = Math.max(
    8,
    layout.reduce((max, item) => Math.max(max, item.y + item.h), 0),
  );
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(12, 1fr)",
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        // A thumbnail keeps its gaps thin, or they swallow the panels.
        gap: small ? "1px" : "3px",
        width: "100%",
        aspectRatio: "16 / 10",
      }}
    >
      {layout.map((item) => {
        const panel = template.panels.find((p) => p.id === item.i);
        const count = panel?.widgets.every((id) => widgetById(id)?.sketch === "count");
        const tabbed = (panel?.widgets.length ?? 0) > 1;
        return (
          <Box
            key={item.i}
            sx={(theme) => ({
              gridColumn: `${item.x + 1} / span ${item.w}`,
              gridRow: `${item.y + 1} / span ${item.h}`,
              borderRadius: small ? "1px" : "3px",
              bgcolor: count ? alpha(theme.palette.primary.main, 0.55) : theme.palette.action.selected,
              ...(tabbed && { borderTop: `${small ? 2 : 4}px solid ${alpha(theme.palette.text.primary, 0.25)}` }),
            })}
          />
        );
      })}
    </Box>
  );
}
