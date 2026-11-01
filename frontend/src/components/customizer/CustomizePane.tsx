import { useTranslation } from "react-i18next";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CodeIcon from "@mui/icons-material/Code";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RedoIcon from "@mui/icons-material/Redo";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UndoIcon from "@mui/icons-material/Undo";
import type { ScadParameter } from "../../sdk/openscad";
import OverlayPane from "./OverlayPane";
import ParameterField from "./ParameterField";
import { groupParameters, type ParameterValues } from "./parameters";

type Props = {
  scriptName: string;
  parameters: ScadParameter[];
  values: ParameterValues;
  onChange: (name: string, value: unknown) => void;
  onFile: (name: string, fileName: string, bytes: Uint8Array) => void;
  onGenerate: () => void;
  onReset: () => void;
  onShowCode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  busy: boolean;
  /** Set while the form has moved since the last generate, which is what makes Generate the thing to press. */
  stale: boolean;
};

/** The script's own parameters, and the button that runs it. */
export default function CustomizePane({
  scriptName,
  parameters,
  values,
  onChange,
  onFile,
  onGenerate,
  onReset,
  onShowCode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  canReset,
  busy,
  stale,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const groups = groupParameters(parameters);

  const actions = (
    <>
      <Tooltip title={t("models:customizer.form.undo")}>
        <span>
          <IconButton
            size="small"
            disabled={!canUndo || busy}
            onClick={onUndo}
            aria-label={t("models:customizer.form.undo")}
          >
            <UndoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("models:customizer.form.redo")}>
        <span>
          <IconButton
            size="small"
            disabled={!canRedo || busy}
            onClick={onRedo}
            aria-label={t("models:customizer.form.redo")}
          >
            <RedoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("models:customizer.form.reset")}>
        <span>
          <IconButton
            size="small"
            disabled={!canReset || busy}
            onClick={onReset}
            aria-label={t("models:customizer.form.reset")}
          >
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("models:customizer.form.code", { name: scriptName })}>
        <IconButton
          size="small"
          onClick={onShowCode}
          aria-label={t("models:customizer.form.code", { name: scriptName })}
        >
          <CodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );

  const generate = (
    <Button
      fullWidth
      size="large"
      variant="contained"
      disabled={busy}
      onClick={onGenerate}
      startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
      sx={{
        fontWeight: 700,
        py: 1.25,
        // Nudges once when the form has moved on from what is on screen, then stays still.
        ...(stale && !busy
          ? {
              animation: "customizerNudge 420ms ease-out",
              "@keyframes customizerNudge": {
                "0%": { transform: "none" },
                "45%": { transform: "scale(1.03)" },
                "100%": { transform: "none" },
              },
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }
          : {}),
      }}
    >
      {busy ? t("models:customizer.form.generating") : t("models:customizer.form.generate")}
    </Button>
  );

  return (
    <OverlayPane title={t("models:customizer.form.title")} action={actions} scrollBody footer={generate}>
      <Stack spacing={1.25}>
        <Typography variant="caption" sx={{ color: "text.secondary", wordBreak: "break-all" }}>
          {scriptName}
        </Typography>

        {!groups.length && (
          <Typography variant="body2" sx={{ color: "text.disabled" }}>
            {t("models:customizer.form.noParameters")}
          </Typography>
        )}

        {groups.map((group, index) => (
          <Accordion
            key={group.name}
            // The first group open, the rest folded: a script with sixteen groups is otherwise a wall.
            defaultExpanded={index === 0 || groups.length <= 3}
            disableGutters
            elevation={0}
            square
            sx={{
              bgcolor: "transparent",
              "&::before": { display: "none" },
              border: 1,
              borderColor: "divider",
              borderRadius: 1.5,
              overflow: "hidden",
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon fontSize="small" />}
              sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 0.75 } }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {group.name}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.5 }}>
              <Stack spacing={1.5}>
                {group.parameters.map((parameter) => (
                  <ParameterField
                    key={parameter.name}
                    parameter={parameter}
                    value={values[parameter.name]}
                    disabled={busy}
                    onChange={(value) => onChange(parameter.name, value)}
                    onFile={(fileName, bytes) => onFile(parameter.name, fileName, bytes)}
                  />
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
        <Box />
      </Stack>
    </OverlayPane>
  );
}
