import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CodeBlock from "../../../components/CodeBlock";
import McpConnectDialog from "../../../components/mcp/McpConnectDialog";
import AiWidgetAnimation, { type SceneKind } from "./AiWidgetAnimation";

const EXAMPLES: SceneKind[] = ["printer", "filament", "library"];

const enter = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: none; }
`;
const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
const noMotion = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };

/** How to have an AI assistant make the widget over MCP, laid over the whole editor until closed. */
export default function AiWidgetGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("app");
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [example, setExample] = useState(0);
  // Cycles through the examples until one is picked; then that one stays.
  const [picked, setPicked] = useState(false);
  const [run, setRun] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const kind = EXAMPLES[example];
  const prompt = t(`dashboard.custom.ai.examples.${kind}.prompt`);

  useEffect(() => {
    const self = root.current;
    if (!self) return;
    // What it covers is out of reach of keyboard and screen readers until it closes.
    const covered = Array.from(self.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element !== self && element instanceof HTMLElement && !element.inert,
    );
    covered.forEach((element) => (element.inert = true));
    self.focus();
    return () => covered.forEach((element) => (element.inert = false));
  }, []);

  const pick = (index: number) => {
    setExample(index);
    setPicked(true);
    setRun((current) => current + 1);
  };

  return (
    <Box
      ref={root}
      component="section"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        // Escape closes this view only, not the editor under it.
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        outline: "none",
        animation: `${enter} 200ms ease-out both`,
        ...noMotion,
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <AutoAwesomeOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />
        <Typography
          id={titleId}
          variant="body2"
          fontWeight={600}
          component="h2"
          noWrap
          sx={{ flex: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
        >
          {t("dashboard.custom.ai.title")}
        </Typography>
        <Tooltip title={t("dashboard.custom.ai.back")}>
          <IconButton size="small" onClick={onClose} aria-label={t("dashboard.custom.ai.back")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex" }}>
        <Box
          sx={{
            m: "auto",
            width: "100%",
            maxWidth: 1200,
            px: { xs: 2, md: 4 },
            py: { xs: 2, md: 3 },
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.6fr) minmax(0, 1fr)" },
            gap: { xs: 3, md: 5 },
            alignItems: "center",
          }}
        >
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <AiWidgetAnimation
              kind={kind}
              prompt={prompt}
              name={t(`dashboard.custom.ai.examples.${kind}.name`)}
              run={run}
              onFinished={
                picked
                  ? undefined
                  : () => {
                      setExample((current) => (current + 1) % EXAMPLES.length);
                      setRun((current) => current + 1);
                    }
              }
            />
            <Stack
              direction="row"
              spacing={0.75}
              useFlexGap
              flexWrap="wrap"
              component="fieldset"
              aria-label={t("dashboard.custom.ai.examplesLabel")}
              sx={{ justifyContent: "center", border: 0, m: 0, p: 0, minWidth: 0 }}
            >
              {EXAMPLES.map((value, index) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  aria-pressed={index === example}
                  color={index === example ? "primary" : "default"}
                  variant={index === example ? "filled" : "outlined"}
                  label={t(`dashboard.custom.ai.examples.${value}.label`)}
                  onClick={() => pick(index)}
                />
              ))}
            </Stack>
          </Stack>

          <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
            <Step n={1}>
              {t("dashboard.custom.ai.step1")}
              <Box sx={{ mt: 1 }}>
                <Button size="small" variant="outlined" onClick={() => setConnectOpen(true)}>
                  {t("dashboard.custom.share.connect")}
                </Button>
              </Box>
            </Step>
            <Step n={2}>
              <Trans t={t} i18nKey="dashboard.custom.share.ai2" components={{ strong: <strong /> }} />
            </Step>
            <Step n={3}>
              {t("dashboard.custom.ai.step3")}
              <CodeBlock code={prompt} />
            </Step>
            <Step n={4}>{t("dashboard.custom.ai.step4")}</Step>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          justifyContent: "flex-end",
          px: 2,
          py: 1.25,
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        <Button onClick={onClose}>{t("dashboard.custom.ai.back")}</Button>
      </Box>
      <McpConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
    </Box>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <Box
      component="li"
      sx={{ display: "flex", gap: 1.5, animation: `${rise} 240ms ease-out ${80 + n * 50}ms both`, ...noMotion }}
    >
      <Box
        aria-hidden
        sx={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {n}
      </Box>
      <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0, pt: "2px" }}>
        {children}
      </Typography>
    </Box>
  );
}
