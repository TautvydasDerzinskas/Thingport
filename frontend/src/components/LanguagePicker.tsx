import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SearchIcon from "@mui/icons-material/Search";
import { SUPPORTED_LANGUAGES, translatedPercent } from "../constants/languages";
import LanguageFlag from "./LanguageFlag";

const PERCENT = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.code, translatedPercent(l.code)]));
const TRIGGER_WIDTH = 240;
const MENU_WIDTH = 300;

type Props = {
  value: string;
  onChange: (code: string) => void;
  /** The accessible name, e.g. "Language". */
  label: string;
};

/** A button showing the language, opening a searchable list of every language with its flag and how much of it is
 *  translated. */
export default function LanguagePicker({ value, onChange, label }: Props) {
  const { t } = useTranslation("app");
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [query, setQuery] = React.useState("");
  const listRef = React.useRef<HTMLUListElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === value) ?? SUPPORTED_LANGUAGES[0];

  const needle = query.trim().toLocaleLowerCase();
  const names = (l: (typeof SUPPORTED_LANGUAGES)[number]) =>
    [l.label, l.englishName, l.code].map((name) => name.toLocaleLowerCase());
  // A name that starts with what's typed comes first: "рус" is Русский before Беларуская.
  const shown = needle
    ? SUPPORTED_LANGUAGES.filter((l) => names(l).some((name) => name.includes(needle))).toSorted(
        (a, b) =>
          Number(names(b).some((name) => name.startsWith(needle))) -
          Number(names(a).some((name) => name.startsWith(needle))),
      )
    : SUPPORTED_LANGUAGES;

  const close = () => setAnchor(null);
  const choose = (code: string) => {
    close();
    if (code !== value) onChange(code);
  };
  const firstOption = () => listRef.current?.querySelector<HTMLElement>('[role="option"]');

  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        aria-label={`${label}: ${current.label}`}
        sx={{
          width: TRIGGER_WIDTH,
          maxWidth: "100%",
          height: 40,
          justifyContent: "flex-start",
          gap: 1.25,
          pl: 1.5,
          pr: 1,
          border: 1,
          borderColor: anchor ? "primary.main" : "divider",
          borderRadius: 1,
          color: "text.primary",
          fontSize: "0.875rem",
          transition: "border-color 150ms",
          "&:hover": { borderColor: anchor ? "primary.main" : "text.secondary" },
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <LanguageFlag code={current.code} />
        <Box component="span" lang={current.code} sx={{ flex: 1, textAlign: "left" }}>
          {current.label}
        </Box>
        <KeyboardArrowDownIcon
          fontSize="small"
          sx={{
            color: "text.secondary",
            transform: anchor ? "rotate(180deg)" : "none",
            transition: "transform 200ms",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        />
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: { mt: 0.5, width: Math.max(anchor?.offsetWidth ?? 0, MENU_WIDTH), maxWidth: "calc(100vw - 32px)" },
          },
        }}
        TransitionProps={{ onEntered: () => searchRef.current?.focus(), onExited: () => setQuery("") }}
      >
        <Box sx={{ p: 1, pb: 0.5 }}>
          <TextField
            inputRef={searchRef}
            size="small"
            fullWidth
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("profile.language.search")}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                firstOption()?.focus();
              } else if (event.key === "Enter" && shown[0]) {
                event.preventDefault();
                choose(shown[0].code);
              }
            }}
            slotProps={{
              htmlInput: { "aria-label": t("profile.language.search") },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        {shown.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            {t("profile.language.noMatch")}
          </Typography>
        ) : (
          <MenuList
            ref={listRef}
            dense
            // A native select can't show flags; MUI's list keeps the arrow-key handling.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="listbox"
            aria-label={label}
            disableListWrap
            onKeyDown={(event) => {
              // Up from the first language goes back to the search field.
              if (event.key === "ArrowUp" && document.activeElement === firstOption()) {
                event.preventDefault();
                searchRef.current?.focus();
              }
            }}
            sx={{ maxHeight: 360, overflowY: "auto" }}
          >
            {shown.map((language) => {
              const chosen = language.code === value;
              const percent = PERCENT[language.code] ?? 0;
              return (
                <MenuItem
                  key={language.code}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                  role="option"
                  aria-selected={chosen}
                  selected={chosen}
                  onClick={() => choose(language.code)}
                  sx={{ gap: 1.25, py: 0.75 }}
                >
                  <LanguageFlag code={language.code} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography lang={language.code} sx={{ fontSize: "0.85rem", lineHeight: 1.25 }}>
                      {language.label}
                    </Typography>
                    {language.englishName !== language.label && (
                      <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", lineHeight: 1.2 }}>
                        {language.englishName}
                      </Typography>
                    )}
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    title={t("profile.language.translated", { percent })}
                    sx={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {percent}%
                  </Typography>
                  <Box sx={{ width: 16, display: "flex" }}>
                    {chosen && <CheckIcon sx={{ fontSize: 16, color: "primary.main" }} />}
                  </Box>
                </MenuItem>
              );
            })}
          </MenuList>
        )}
      </Popover>
    </>
  );
}
