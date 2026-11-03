import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import HelpTip from "../../components/HelpTip";
import type { StudioAiModel } from "../../api/studio";
import { AiLogo } from "../AiPage/aiLogos";

// Where a person will ask an AI to make or change the design. The AI is to work through the same commands as the
// toolbar (see frontend/src/studio/commands.ts), which are already its MCP tools; sending isn't wired up yet, but the
// picker already offers the AIs an admin added.

const MINIMIZED_KEY = "thingport_studio_prompt_minimized";
const MODEL_KEY = "thingport_studio_ai_model";

const rise = keyframes`from { opacity: 0; transform: translate(-50%, 10px) scale(0.98); } to { opacity: 1; transform: translate(-50%, 0) scale(1); }`;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

type Props = {
  /** Null while loading. */
  models: StudioAiModel[] | null;
  isAdmin: boolean;
};

export default function PromptOverlay({ models, isAdmin }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [minimized, setMinimized] = useState(() => stored(MINIMIZED_KEY) === "true");
  const [modelId, setModelId] = useState<string>(() => stored(MODEL_KEY) ?? "");
  const [text, setText] = useState("");

  // The one chosen before while it's still there, else the default.
  useEffect(() => {
    if (!models?.length || models.some((model) => model.id === modelId)) return;
    setModelId((models.find((model) => model.is_default) ?? models[0]).id);
  }, [models, modelId]);

  const minimize = (value: boolean) => {
    setMinimized(value);
    store(MINIMIZED_KEY, String(value));
  };

  const placement = {
    position: "absolute",
    left: "50%",
    bottom: 16,
    transform: "translate(-50%, 0)",
    zIndex: 2,
    animation: `${rise} 200ms ease-out`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  } as const;

  if (minimized) {
    return (
      <Button
        variant="contained"
        color="inherit"
        startIcon={<AutoAwesomeOutlinedIcon />}
        onClick={() => minimize(false)}
        aria-label={t("studio.prompt.open")}
        sx={{
          ...placement,
          borderRadius: 999,
          px: 2,
          textTransform: "none",
          bgcolor: "background.paper",
          color: "text.primary",
          border: 1,
          borderColor: "divider",
          boxShadow: 4,
          "&:hover": { bgcolor: "background.paper", boxShadow: 6 },
        }}
      >
        {t("studio.prompt.title")}
      </Button>
    );
  }

  const noModels = models !== null && models.length === 0;

  return (
    <Paper
      component="section"
      elevation={6}
      aria-label={t("studio.prompt.title")}
      sx={{
        ...placement,
        width: "min(680px, calc(100% - 32px))",
        borderRadius: 3,
        border: 1,
        borderColor: "divider",
        px: 1.5,
        pt: 1,
        pb: 1.25,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 18, color: "primary.main" }} />
        <Typography variant="subtitle2">{t("studio.prompt.title")}</Typography>
        <Chip size="small" label={t("studio.prompt.soon")} sx={{ height: 20, fontSize: "0.7rem" }} />
        <HelpTip text={t("studio.prompt.help")} />
        <Box sx={{ flex: 1 }} />
        {noModels ? (
          isAdmin ? (
            <Button size="small" onClick={() => navigate("/admin-ai")} sx={{ textTransform: "none" }}>
              {t("studio.prompt.addModel")}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t("studio.prompt.noModels")}
            </Typography>
          )
        ) : (
          <Select
            size="small"
            variant="standard"
            disableUnderline
            value={models?.some((model) => model.id === modelId) ? modelId : ""}
            displayEmpty
            disabled={!models}
            onChange={(event) => {
              setModelId(event.target.value);
              store(MODEL_KEY, event.target.value);
            }}
            inputProps={{ "aria-label": t("studio.prompt.model") }}
            renderValue={(id) => {
              const model = models?.find((each) => each.id === id);
              return model ? (
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <AiLogo model={model.model} baseUrl={`http://${model.host}`} size={16} />
                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                    {model.model}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("studio.prompt.model")}
                </Typography>
              );
            }}
            sx={{ fontSize: "0.85rem" }}
          >
            {models?.map((model) => (
              <MenuItem key={model.id} value={model.id}>
                <ListItemIcon sx={{ minWidth: 30 }}>
                  <AiLogo model={model.model} baseUrl={`http://${model.host}`} size={20} />
                </ListItemIcon>
                <ListItemText primary={model.model} secondary={model.host} />
              </MenuItem>
            ))}
          </Select>
        )}
        <Tooltip title={t("studio.prompt.minimize")}>
          <IconButton size="small" aria-label={t("studio.prompt.minimize")} onClick={() => minimize(true)}>
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack
        direction="row"
        alignItems="flex-end"
        spacing={1}
        sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 2, pl: 1.5, pr: 0.5, py: 0.5 }}
      >
        <InputBase
          multiline
          maxRows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("studio.prompt.placeholder")}
          inputProps={{ "aria-label": t("studio.prompt.placeholder") }}
          sx={{ flex: 1, fontSize: "0.9rem", py: 0.5 }}
        />
        <Tooltip title={t("studio.prompt.sendSoon")}>
          <span>
            <IconButton size="small" color="primary" disabled aria-label={t("studio.prompt.send")}>
              <SendRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
