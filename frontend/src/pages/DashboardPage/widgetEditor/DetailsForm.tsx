import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import HelpTip from "../../../components/HelpTip";
import IconPicker from "../../../components/IconPicker/IconPicker";
import TagInput from "../../../components/TagInput";
import { WidgetIcon } from "../CustomWidgetCard";
import { GRID_COLS, MAX_ROWS, slugFromName, type Draft } from "./draft";

type Props = {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  errors: Record<string, string>;
  /** Saved widgets keep their folder name: it's what a save replaces. */
  slugLocked: boolean;
};

function Heading({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <Typography
      variant="caption"
      component="h3"
      sx={{
        display: "flex",
        alignItems: "center",
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: "text.secondary",
      }}
    >
      {children}
      {help && <HelpTip text={help} />}
    </Typography>
  );
}

/** A size in grid cells, kept to what the grid allows once the field is left. */
function CellsField({
  label,
  value,
  max,
  error,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  error?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (text: string) => {
    const number = Math.round(Number(text));
    if (Number.isFinite(number) && text.trim()) onChange(Math.min(max, Math.max(1, number)));
    else setDraft(String(value));
  };
  return (
    <TextField
      size="small"
      type="number"
      label={label}
      value={draft}
      error={!!error}
      helperText={error}
      onChange={(event) => {
        setDraft(event.target.value);
        const number = Number(event.target.value);
        if (event.target.value.trim() && Number.isInteger(number) && number >= 1 && number <= max) onChange(number);
      }}
      onBlur={(event) => commit(event.target.value)}
      slotProps={{ htmlInput: { min: 1, max, step: 1 } }}
      sx={{ flex: 1, minWidth: 90 }}
    />
  );
}

/** A widget's name, look, credit, size and the hosts it reaches. */
export default function DetailsForm({ draft, onChange, errors, slugLocked }: Props) {
  const { t } = useTranslation("app");
  const error = (field: string) => (errors[field] ? t(`dashboard.custom.editor.errors.${errors[field]}`) : undefined);
  const setSize = (patch: Partial<Draft["size"]>) => onChange({ size: { ...draft.size, ...patch } });

  return (
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box
            aria-hidden
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: "10px",
              border: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "primary.main",
            }}
          >
            <WidgetIcon icon={draft.icon.trim() || undefined} iconUrl={draft.iconUrl.trim() || undefined} size={24} />
          </Box>
          <TextField
            size="small"
            fullWidth
            required
            label={t("dashboard.custom.editor.name")}
            value={draft.name}
            error={!!error("name")}
            helperText={error("name")}
            onChange={(event) => {
              const name = event.target.value;
              onChange(slugLocked || draft.slugEdited ? { name } : { name, slug: slugFromName(name) });
            }}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            size="small"
            label={t("dashboard.custom.editor.version")}
            value={draft.version}
            onChange={(event) => onChange({ version: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 20, spellCheck: false } }}
            sx={{ width: 110, flexShrink: 0 }}
          />
        </Stack>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label={t("dashboard.custom.editor.description")}
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("dashboard.custom.editor.iconHelp")}>{t("dashboard.custom.editor.icon")}</Heading>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <IconPicker
              label={t("dashboard.custom.editor.iconUrl")}
              emptyLabel={t("dashboard.custom.editor.iconNone")}
              value={draft.iconUrl}
              onChange={(iconUrl) => onChange({ iconUrl })}
              error={error("iconUrl")}
              preview={<WidgetIcon iconUrl={draft.iconUrl.trim() || undefined} size={28} />}
            />
          </Box>
          <TextField
            size="small"
            label={t("dashboard.custom.editor.emoji")}
            value={draft.icon.length > 16 ? "" : draft.icon}
            placeholder="🕒"
            onChange={(event) => onChange({ icon: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 16 } }}
            sx={{ width: { xs: "100%", sm: 130 }, flexShrink: 0 }}
          />
        </Stack>
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("dashboard.custom.editor.authorHelp")}>{t("dashboard.custom.editor.author")}</Heading>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            size="small"
            fullWidth
            label={t("dashboard.custom.editor.authorName")}
            value={draft.author}
            onChange={(event) => onChange({ author: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <TextField
            size="small"
            fullWidth
            label={t("dashboard.custom.editor.authorUrl")}
            placeholder="https://github.com/you"
            value={draft.authorUrl}
            error={!!error("authorUrl")}
            helperText={error("authorUrl")}
            onChange={(event) => onChange({ authorUrl: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 2048, spellCheck: false, inputMode: "url" } }}
          />
        </Stack>
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("dashboard.custom.editor.sizeHelp")}>{t("dashboard.custom.editor.size")}</Heading>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <CellsField
            label={t("dashboard.custom.editor.width")}
            value={draft.size.w}
            max={GRID_COLS}
            onChange={(w) => setSize({ w })}
          />
          <CellsField
            label={t("dashboard.custom.editor.height")}
            value={draft.size.h}
            max={MAX_ROWS}
            onChange={(h) => setSize({ h })}
          />
          <CellsField
            label={t("dashboard.custom.editor.minWidth")}
            value={draft.size.minW}
            max={GRID_COLS}
            error={error("minW")}
            onChange={(minW) => setSize({ minW })}
          />
          <CellsField
            label={t("dashboard.custom.editor.minHeight")}
            value={draft.size.minH}
            max={MAX_ROWS}
            error={error("minH")}
            onChange={(minH) => setSize({ minH })}
          />
        </Stack>
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("dashboard.custom.editor.hostsHelp")}>{t("dashboard.custom.editor.hosts")}</Heading>
        <TagInput
          value={draft.hosts}
          onChange={(hosts) => onChange({ hosts: [...new Set(hosts.map((host) => host.toLowerCase()))].slice(0, 20) })}
          placeholder={t("dashboard.custom.editor.hostsPlaceholder")}
        />
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("dashboard.custom.editor.slugHelp")}>{t("dashboard.custom.editor.slug")}</Heading>
        <TextField
          size="small"
          value={draft.slug}
          disabled={slugLocked}
          error={!!error("slug")}
          helperText={error("slug")}
          onChange={(event) => onChange({ slug: event.target.value.toLowerCase(), slugEdited: true })}
          slotProps={{
            htmlInput: {
              maxLength: 40,
              spellCheck: false,
              style: { fontFamily: "monospace" },
              "aria-label": t("dashboard.custom.editor.slug"),
            },
          }}
          sx={{ maxWidth: 320 }}
        />
      </Stack>
    </Stack>
  );
}
