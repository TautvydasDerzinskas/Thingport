import React from "react";
import { useTranslation } from "react-i18next";
import { alpha, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import EmojiPicker, { Categories, EmojiStyle, Theme } from "emoji-picker-react";

// The emoji picker, loaded only when someone opens it (Composer lazy-loads this file): the library and its emoji come
// with the app, never from a CDN, so an instance off the internet has them too. Native emoji, so they look as the
// person's own system draws them, and searched by name in the app's language where the library has one.

type EmojiData = React.ComponentProps<typeof EmojiPicker>["emojiData"];

const NAMES: Partial<Record<string, () => Promise<{ default: unknown }>>> = {
  lt: () => import("emoji-picker-react/dist/data/emojis-lt.json"),
  es: () => import("emoji-picker-react/dist/data/emojis-es.json"),
  fr: () => import("emoji-picker-react/dist/data/emojis-fr.json"),
};

const WIDTH = 340;
const HEIGHT = 380;

const CATEGORIES = [
  Categories.SUGGESTED,
  Categories.SMILEYS_PEOPLE,
  Categories.ANIMALS_NATURE,
  Categories.FOOD_DRINK,
  Categories.TRAVEL_PLACES,
  Categories.ACTIVITIES,
  Categories.OBJECTS,
  Categories.SYMBOLS,
  Categories.FLAGS,
];

export default function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const { t, i18n } = useTranslation("app");
  const theme = useTheme();
  const language = i18n.language.split("-")[0];
  const load = NAMES[language];
  // Undefined: the library's own English names. Null: the language's still loading.
  const [data, setData] = React.useState<EmojiData | null | undefined>(load ? null : undefined);

  React.useEffect(() => {
    if (!load) return;
    let current = true;
    load().then(
      (module) => {
        if (current) setData(module.default as EmojiData);
      },
      // English names rather than no picker.
      () => {
        if (current) setData(undefined);
      },
    );
    return () => {
      current = false;
    };
  }, [load]);

  if (data === null) {
    return (
      <Box sx={{ width: WIDTH, height: HEIGHT, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  const { palette } = theme;
  // The library's own variables, from the app's theme, so it reads as part of the app in both modes.
  const colors = {
    "--epr-bg-color": palette.background.paper,
    "--epr-category-label-bg-color": palette.background.paper,
    "--epr-text-color": palette.text.primary,
    "--epr-highlight-color": palette.primary.main,
    "--epr-hover-bg-color": alpha(palette.primary.main, 0.12),
    "--epr-focus-bg-color": alpha(palette.primary.main, 0.2),
    "--epr-hover-bg-color-reduced-opacity": alpha(palette.primary.main, 0.06),
    "--epr-search-input-bg-color": palette.action.hover,
    "--epr-search-input-bg-color-active": palette.background.paper,
    "--epr-emoji-variation-picker-bg-color": palette.background.paper,
    "--epr-search-input-text-color": palette.text.primary,
    "--epr-search-input-placeholder-color": palette.text.secondary,
    "--epr-picker-border-color": "transparent",
    "--epr-category-icon-active-color": palette.primary.main,
  } as React.CSSProperties;

  return (
    <EmojiPicker
      emojiStyle={EmojiStyle.NATIVE}
      theme={palette.mode === "dark" ? Theme.DARK : Theme.LIGHT}
      emojiData={data}
      onEmojiClick={(emoji) => onPick(emoji.emoji)}
      autoFocusSearch
      lazyLoadEmojis
      previewConfig={{ showPreview: false }}
      searchPlaceholder={t("chats.emojiPicker.search")}
      searchClearButtonLabel={t("chats.emojiPicker.clear")}
      categories={CATEGORIES.map((category) => ({
        category,
        name: t(`chats.emojiPicker.categories.${category}`),
      }))}
      width={WIDTH}
      height={HEIGHT}
      style={colors}
    />
  );
}
