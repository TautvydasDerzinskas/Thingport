import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";
import HelpTip from "../../components/HelpTip";
import { featureById, isBody, topLevel, type StudioDocument, type Vec3 } from "../../studio/document";
import type { checkDesign, measureBetween } from "../../studio/geometry";
import type { BodyCheck, PrintCheckOptions } from "../../studio/printCheck";
import { NumberField } from "./fields";
import { checkInWorker, measureBetweenInWorker } from "./geometryClient";
import { featureLabel } from "./labels";
import type { RunCommand } from "./useStudioDesign";

// Whether the design will print as it's placed, checked in the page's worker with the same code studio_check_print
// runs for an assistant, and how far apart two bodies are, as studio_measure measures it.

const OPTIONS_KEY = "thingport.studio.printCheck";
const DEFAULTS: PrintCheckOptions = { bed: [256, 256, 256], overhang: 45, minWall: 0.8 };
/** ms: the check waits this long after a change, so typing a bed size doesn't run it for every digit. */
const SETTLE = 300;
/** mm: the farthest measure_between looks; farther than this is "over a metre". */
const SEARCH = 1000;

const appear = keyframes`from { opacity: 0; transform: translateY(4px); }`;

function storedOptions(): PrintCheckOptions {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(OPTIONS_KEY) ?? "null");
    if (value && typeof value === "object") {
      const { bed, overhang, minWall } = value as Record<string, unknown>;
      if (
        Array.isArray(bed) &&
        bed.length === 3 &&
        bed.every((side) => typeof side === "number" && side > 0) &&
        typeof overhang === "number" &&
        typeof minWall === "number"
      )
        return { bed: bed as Vec3, overhang, minWall };
    }
  } catch {}
  return DEFAULTS;
}

const mm = (value: number) => Number(value.toFixed(2));

type Props = {
  open: boolean;
  designId: string | null;
  doc: StudioDocument | null;
  /** Bodies selected on the page: two of them are what's measured first. */
  selected: string[];
  run: RunCommand;
  onClose: () => void;
};

export default function CheckDialog({ open, designId, doc, selected, run, onClose }: Props) {
  const { t } = useTranslation("app");
  const [options, setOptions] = useState(storedOptions);
  const change = (next: Partial<PrintCheckOptions>) =>
    setOptions((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });

  const [report, setReport] = useState<{ doc: StudioDocument; check: ReturnType<typeof checkDesign> } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !doc || !designId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      checkInWorker(designId, doc, options).then(
        (check) => {
          if (cancelled) return;
          setReport({ doc, check });
          setFailure(null);
        },
        (error: unknown) => !cancelled && setFailure(error instanceof Error ? error.message : String(error)),
      );
    }, SETTLE);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, doc, designId, options]);
  const checking = !failure && report?.doc !== doc;

  const bodies = useMemo(
    () => (doc ? topLevel(doc).filter((feature) => isBody(feature) && feature.visible) : []),
    [doc],
  );
  const name = (id: string) => {
    const feature = doc && featureById(doc, id);
    return feature ? featureLabel(feature, t) : id;
  };
  const [pair, setPair] = useState<[string, string]>(["", ""]);
  useEffect(() => {
    if (!open) return;
    // The two selected bodies, else the first two.
    const ids = bodies.map((body) => body.id);
    const picked = selected.filter((id) => ids.includes(id));
    const [a, b] = picked.length >= 2 ? picked : ids;
    setPair([a ?? "", b ?? ""]);
    // Only as it opens: a choice made in it stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [between, setBetween] = useState<ReturnType<typeof measureBetween> | { failure: string } | null>(null);
  useEffect(() => {
    setBetween(null);
    const [a, b] = pair;
    if (!open || !doc || !designId || !a || !b || a === b) return;
    let cancelled = false;
    measureBetweenInWorker(designId, doc, a, b).then(
      (measured) => !cancelled && setBetween(measured),
      (error: unknown) => !cancelled && setBetween({ failure: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, doc, designId, pair]);

  /** What's wrong with a body, in the page's words: each a chip. */
  const issues = (body: BodyCheck): string[] => {
    const check = report!.check;
    if (!body.pieces) return [t("studio.check.empty")];
    const found: string[] = [];
    if (body.size.some((side, axis) => side > options.bed[axis] + 0.01)) found.push(t("studio.check.tooBig"));
    else if (!body.fitsBed && !body.belowBed) found.push(t("studio.check.offBed"));
    if (body.aboveBed) found.push(t("studio.check.floating", { mm: mm(body.aboveBed) }));
    if (body.belowBed) found.push(t("studio.check.sunk", { mm: mm(body.belowBed) }));
    if (body.pieces > 1) found.push(t("studio.check.pieces", { count: body.pieces }));
    if (body.overhang) found.push(t("studio.check.overhang", { area: Math.round(body.overhang.area) }));
    if (body.thinWalls) found.push(t("studio.check.thin", { mm: mm(body.thinWalls.thinnest) }));
    for (const overlap of check.overlaps)
      if (overlap.a === body.id || overlap.b === body.id)
        found.push(t("studio.check.overlaps", { name: name(overlap.a === body.id ? overlap.b : overlap.a) }));
    return found;
  };

  const rows = report
    ? [
        ...report.check.bodies.map((body) => ({ id: body.id, body, issues: issues(body) })),
        ...report.check.open.map((id) => ({ id, body: null, issues: [t("studio.check.open")] })),
      ]
    : [];
  const clear = rows.length > 0 && rows.every((row) => !row.issues.length);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {t("studio.check.title")}
        <HelpTip text={t("studio.check.help")} />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 1, pt: 1 }}>
          {(["x", "y", "z"] as const).map((axis, index) => (
            <NumberField
              key={axis}
              label={t(`studio.check.bed_${axis}`)}
              value={options.bed[index]}
              unit="mm"
              onCommit={(value) =>
                value > 0 && change({ bed: options.bed.map((side, i) => (i === index ? value : side)) as Vec3 })
              }
            />
          ))}
          <NumberField
            label={t("studio.check.overhangLimit")}
            value={options.overhang}
            unit="°"
            onCommit={(value) => value >= 0 && value <= 90 && change({ overhang: value })}
          />
          <NumberField
            label={t("studio.check.minWall")}
            value={options.minWall}
            unit="mm"
            onCommit={(value) => value >= 0 && change({ minWall: value })}
          />
        </Box>

        <Box sx={{ mt: 2 }} aria-live="polite" aria-busy={checking}>
          {failure ? (
            <Alert severity="error">{failure}</Alert>
          ) : !report ? (
            <Stack spacing={1}>
              {[0, 1].map((key) => (
                <Skeleton key={key} variant="rounded" height={48} />
              ))}
            </Stack>
          ) : !rows.length ? (
            <Typography variant="body2" color="text.secondary">
              {t("studio.check.nothing")}
            </Typography>
          ) : (
            <Stack spacing={1} sx={{ opacity: checking ? 0.6 : 1, transition: "opacity 150ms" }}>
              {clear && (
                <Alert severity="success" icon={<CheckCircleOutlineIcon fontSize="inherit" />}>
                  {t("studio.check.ready")}
                </Alert>
              )}
              {rows.map((row) => (
                <Stack
                  key={row.id}
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  sx={{
                    px: 1.25,
                    py: 1,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: "divider",
                    animation: `${appear} 180ms ease-out`,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  }}
                >
                  {row.issues.length ? (
                    <ReportProblemOutlinedIcon fontSize="small" color="warning" />
                  ) : (
                    <CheckCircleOutlineIcon fontSize="small" color="success" />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="baseline">
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {name(row.id)}
                      </Typography>
                      {row.body && row.body.pieces > 0 && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {t("studio.check.size", {
                            x: mm(row.body.size[0]),
                            y: mm(row.body.size[1]),
                            z: mm(row.body.size[2]),
                          })}
                          {" · "}
                          {t("studio.check.volume", { cm3: Number((row.body.volume / 1000).toFixed(2)) })}
                        </Typography>
                      )}
                    </Stack>
                    {row.issues.length > 0 && (
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                        {row.issues.map((issue) => (
                          <Chip key={issue} size="small" variant="outlined" color="warning" label={issue} />
                        ))}
                      </Stack>
                    )}
                  </Box>
                  {/* Floating or sunk, it's put on the bed with align, as an assistant would. */}
                  {row.body && (row.body.aboveBed > 0 || row.body.belowBed > 0) && (
                    <Button
                      size="small"
                      startIcon={<VerticalAlignBottomIcon />}
                      aria-label={t("studio.check.toBedOf", { name: name(row.id) })}
                      onClick={() => void run("align", { feature_id: row.id, z: "start" })}
                      sx={{ flexShrink: 0 }}
                    >
                      {t("studio.check.toBed")}
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        <Typography variant="overline" component="h3" color="text.secondary" sx={{ display: "block", mt: 2.5 }}>
          {t("studio.check.measure")}
        </Typography>
        {bodies.length < 2 ? (
          <Typography variant="body2" color="text.secondary">
            {t("studio.check.measureNeedsTwo")}
          </Typography>
        ) : (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            {([0, 1] as const).map((index) => (
              <TextField
                key={index}
                select
                size="small"
                label={t(index ? "studio.check.second" : "studio.check.first")}
                value={pair[index]}
                onChange={(event) =>
                  setPair((prev) => (index ? [prev[0], event.target.value] : [event.target.value, prev[1]]))
                }
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ flex: 1, minWidth: 0 }}
              >
                {bodies.map((body) => (
                  <MenuItem key={body.id} value={body.id} disabled={body.id === pair[index ? 0 : 1]}>
                    {featureLabel(body, t)}
                  </MenuItem>
                ))}
              </TextField>
            ))}
            <Typography variant="body2" sx={{ minWidth: 150, fontWeight: 600 }} aria-live="polite">
              {!between ? (
                <Skeleton width={120} />
              ) : "failure" in between ? (
                <Box component="span" sx={{ color: "error.main", fontWeight: 400 }}>
                  {between.failure}
                </Box>
              ) : between.overlap > 0 ? (
                t("studio.check.overlap", { cm3: Number((between.overlap / 1000).toFixed(3)) })
              ) : between.gap === 0 ? (
                t("studio.check.touching")
              ) : between.gap >= SEARCH ? (
                t("studio.check.far")
              ) : (
                t("studio.check.gap", { mm: mm(between.gap) })
              )}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("close", { ns: "common" })}</Button>
      </DialogActions>
    </Dialog>
  );
}
