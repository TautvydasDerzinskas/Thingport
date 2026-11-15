import { useState } from "react";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { printersApi, type PrinterSummary } from "../../api/printers";

/** The printer's picture from the slicers, or for one they have none of, its bed drawn to its shape. On a white
 *  tile, as slicer logos are, so it reads the same in dark mode. */
export default function PrinterPicture({ printer, size }: { printer: PrinterSummary; size: number }) {
  const [failed, setFailed] = useState(false);
  if (printer.cover && !failed) {
    return (
      <Box
        component="img"
        src={printersApi.coverUrl(printer.id)}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        sx={{ maxWidth: size * 0.88, maxHeight: size * 0.88, objectFit: "contain", display: "block" }}
      />
    );
  }
  return <BedDrawing printer={printer} size={size} />;
}

/** The bed seen from above at its proportions, with a grid on it. */
function BedDrawing({ printer, size }: { printer: PrinterSummary; size: number }) {
  const theme = useTheme();
  const bed = printer.bed;
  const aspect = bed && bed.x > 0 && bed.y > 0 ? bed.x / bed.y : 1;
  const w = aspect >= 1 ? 64 : 64 * aspect;
  const h = aspect >= 1 ? 64 / aspect : 64;
  const x = (100 - w) / 2;
  const y = (100 - h) / 2;
  const round = bed?.shape === "circle";
  const lines = [0.25, 0.5, 0.75];
  return (
    <Box
      component="svg"
      viewBox="0 0 100 100"
      aria-hidden="true"
      sx={{ width: size * 0.82, height: size * 0.82, color: "primary.main", display: "block" }}
    >
      <defs>
        <clipPath id={`bed-${printer.id}`}>
          {round ? <circle cx="50" cy="50" r={w / 2} /> : <rect x={x} y={y} width={w} height={h} rx="3" />}
        </clipPath>
      </defs>
      {/* The frame a bed sits in, in perspective-free outline. */}
      <rect
        x={x - 8}
        y={y - 8}
        width={w + 16}
        height={h + 16}
        rx="6"
        fill="none"
        stroke={theme.palette.grey[400]}
        strokeWidth="2"
      />
      <g clipPath={`url(#bed-${printer.id})`}>
        <rect x="0" y="0" width="100" height="100" fill="currentColor" opacity="0.14" />
        {lines.map((f) => (
          <g key={f} stroke="currentColor" strokeWidth="0.8" opacity="0.35">
            <line x1={x + w * f} y1={y} x2={x + w * f} y2={y + h} />
            <line x1={x} y1={y + h * f} x2={x + w} y2={y + h * f} />
          </g>
        ))}
      </g>
      {round ? (
        <circle cx="50" cy="50" r={w / 2} fill="none" stroke="currentColor" strokeWidth="2.2" />
      ) : (
        <rect x={x} y={y} width={w} height={h} rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      )}
    </Box>
  );
}
