import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ToolManifest } from "../../api/tools";
import HelpTip from "../HelpTip";
import IconPicker from "../IconPicker/IconPicker";
import { isIconRef } from "../IconPicker/iconRef";
import TagInput from "../TagInput";
import ToolIcon from "./ToolIcon";

// The editor's form of a tool's metadata, loose while typing; toManifest makes what the server checks on saving.

export type ToolDraft = {
  slug: string;
  slugEdited: boolean;
  name: string;
  description: string;
  iconUrl: string;
  version: string;
  author: string;
  authorUrl: string;
  width: number;
  height: number;
  hosts: string[];
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const WEB = /^https?:\/\/[^\s]+$/i;
// A tool from the repository carries its icon in its metadata, as an SVG data URL.
const SVG_DATA = /^data:image\/svg\+xml(;charset=utf-8)?(;base64)?,/i;
export const WINDOW_LIMITS = { width: [320, 1920], height: [240, 1200] } as const;

/** A folder name from the tool's name: "Bin planner" becomes "bin-planner". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function fromManifest(manifest: ToolManifest, slug: string): ToolDraft {
  return {
    slug,
    slugEdited: true,
    name: manifest.name,
    description: manifest.description ?? "",
    iconUrl: manifest.iconUrl ?? "",
    version: manifest.version ?? "1.0.0",
    author: manifest.author ?? "",
    authorUrl: manifest.authorUrl ?? "",
    width: manifest.window.width,
    height: manifest.window.height,
    hosts: manifest.hosts,
  };
}

const optional = (value: string) => value.trim() || undefined;

export function toManifest(draft: ToolDraft): ToolManifest {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    iconUrl: optional(draft.iconUrl),
    version: draft.version.trim() || "1.0.0",
    author: optional(draft.author),
    authorUrl: optional(draft.authorUrl),
    window: { width: draft.width, height: draft.height },
    hosts: draft.hosts,
  };
}

/** What's wrong, by field; the value is a translation key under tools.editor.errors. */
export function problems(draft: ToolDraft): Record<string, string> {
  const found: Record<string, string> = {};
  if (!SLUG.test(draft.slug)) found.slug = "slug";
  if (!draft.name.trim()) found.name = "name";
  const iconUrl = draft.iconUrl.trim();
  if (iconUrl && !WEB.test(iconUrl) && !isIconRef(iconUrl) && !SVG_DATA.test(iconUrl)) found.iconUrl = "url";
  if (draft.authorUrl.trim() && !WEB.test(draft.authorUrl.trim())) found.authorUrl = "url";
  return found;
}

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

/** A size in pixels, kept within what a window may be once the field is left. */
function PixelsField({
  label,
  value,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  limits: readonly [number, number];
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const [min, max] = limits;
  return (
    <TextField
      size="small"
      type="number"
      label={label}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const number = Number(event.target.value);
        if (Number.isInteger(number) && number >= min && number <= max) onChange(number);
      }}
      onBlur={() => {
        const number = Math.round(Number(text));
        const clamped = Number.isFinite(number) && text.trim() ? Math.min(max, Math.max(min, number)) : value;
        onChange(clamped);
        setText(String(clamped));
      }}
      slotProps={{ htmlInput: { min, max, step: 10 } }}
      sx={{ flex: 1, minWidth: 110 }}
    />
  );
}

type Props = {
  draft: ToolDraft;
  onChange: (patch: Partial<ToolDraft>) => void;
  errors: Record<string, string>;
  /** A saved tool keeps its folder name: it's what a save replaces. */
  slugLocked: boolean;
};

/** A tool's name, look, credit, window and the hosts it reaches. */
export default function ToolDetailsForm({ draft, onChange, errors, slugLocked }: Props) {
  const { t } = useTranslation("app");
  const error = (field: string) => (errors[field] ? t(`tools.editor.errors.${errors[field]}`) : undefined);

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
            <ToolIcon iconUrl={draft.iconUrl.trim() || undefined} size={24} />
          </Box>
          <TextField
            size="small"
            fullWidth
            required
            label={t("tools.editor.name")}
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
            label={t("tools.editor.version")}
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
          label={t("tools.editor.description")}
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("tools.editor.iconHelp")}>{t("tools.editor.icon")}</Heading>
        <IconPicker
          label={t("tools.editor.iconUrl")}
          emptyLabel={t("tools.editor.iconNone")}
          value={draft.iconUrl}
          onChange={(iconUrl) => onChange({ iconUrl })}
          error={error("iconUrl")}
          preview={<ToolIcon iconUrl={draft.iconUrl.trim() || undefined} size={28} />}
        />
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("tools.editor.windowHelp")}>{t("tools.editor.window")}</Heading>
        <Stack direction="row" spacing={1.5}>
          <PixelsField
            label={t("tools.editor.width")}
            value={draft.width}
            limits={WINDOW_LIMITS.width}
            onChange={(width) => onChange({ width })}
          />
          <PixelsField
            label={t("tools.editor.height")}
            value={draft.height}
            limits={WINDOW_LIMITS.height}
            onChange={(height) => onChange({ height })}
          />
        </Stack>
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("tools.editor.authorHelp")}>{t("tools.editor.author")}</Heading>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
            size="small"
            fullWidth
            label={t("tools.editor.authorName")}
            value={draft.author}
            onChange={(event) => onChange({ author: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <TextField
            size="small"
            fullWidth
            label={t("tools.editor.authorUrl")}
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
        <Heading help={t("tools.editor.hostsHelp")}>{t("tools.editor.hosts")}</Heading>
        <TagInput
          value={draft.hosts}
          onChange={(hosts) => onChange({ hosts: [...new Set(hosts.map((host) => host.toLowerCase()))].slice(0, 20) })}
          placeholder={t("tools.editor.hostsPlaceholder")}
        />
      </Stack>

      <Stack spacing={1.5}>
        <Heading help={t("tools.editor.slugHelp")}>{t("tools.editor.slug")}</Heading>
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
              "aria-label": t("tools.editor.slug"),
            },
          }}
          sx={{ maxWidth: 320 }}
        />
      </Stack>
    </Stack>
  );
}
