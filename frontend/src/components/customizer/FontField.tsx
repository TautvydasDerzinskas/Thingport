import { useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { FALLBACK_TOOL_FONT, TOOL_FONTS, TOOL_FONT_URLS, type ToolFont } from "../../sdk/fonts";

/** Under a name of its own, so a font of the same name installed here can't stand in for what will be drawn. */
const faceFamily = (font: ToolFont) => `thingport-${font.id}`;

const faces = new Map<string, Promise<unknown>>();

/** Fetched the first time it is shown, and once; until then its name is simply in the page's own font. */
function loadFace(font: ToolFont): void {
  const url = TOOL_FONT_URLS.get(font.id);
  if (faces.has(font.id) || !url) return;
  const face = new FontFace(faceFamily(font), `url(${url})`);
  faces.set(
    font.id,
    face
      .load()
      // Set-like, though the project's DOM types only say so with lib.dom.iterable.
      .then(() => (document.fonts as unknown as Set<FontFace>).add(face))
      .catch(() => faces.delete(font.id)),
  );
}

type Props = {
  /** The parameter's name, for the field's accessible name. */
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * A typeface, from the ones Thingport carries, each name drawn in its own face.
 *
 * A script written for a site with other fonts may start on one that isn't here. It stays in the list under its own
 * name, saying what it comes out in instead, rather than the field quietly claiming something else was chosen.
 */
export default function FontField({ name, value, onChange, disabled }: Props) {
  const { t } = useTranslation("models");
  // A style after the family, "PT Sans:style=Bold", is still that family.
  const family = value.split(":")[0].trim();
  const carried = TOOL_FONTS.find((font) => font.name === family);
  const drawnIn = carried ?? FALLBACK_TOOL_FONT;
  const shown = carried ? value : t("customizer.form.fontFallback", { name: value, fallback: FALLBACK_TOOL_FONT.name });

  useEffect(() => loadFace(drawnIn), [drawnIn]);

  const items: ReactElement[] = [];
  if (!TOOL_FONTS.some((font) => font.name === value)) {
    items.push(
      <MenuItem key="current" value={value} sx={{ fontFamily: faceFamily(drawnIn) }}>
        {shown}
      </MenuItem>,
    );
  }
  let group: string | null = null;
  for (const font of TOOL_FONTS) {
    if (font.group !== group) {
      group = font.group;
      items.push(
        <ListSubheader key={group} sx={{ lineHeight: "32px" }}>
          {t(`customizer.form.fontGroup.${group}`)}
        </ListSubheader>,
      );
    }
    items.push(
      <MenuItem key={font.id} value={font.name} sx={{ fontFamily: faceFamily(font) }}>
        {font.name}
      </MenuItem>,
    );
  }

  return (
    <TextField
      select
      size="small"
      fullWidth
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: { "aria-label": name },
        select: {
          // Twenty-one files, so only once someone actually looks.
          onOpen: () => TOOL_FONTS.forEach(loadFace),
          MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } },
          renderValue: () => (
            <Box component="span" sx={{ fontFamily: faceFamily(drawnIn) }}>
              {shown}
            </Box>
          ),
        },
      }}
    >
      {items}
    </TextField>
  );
}
