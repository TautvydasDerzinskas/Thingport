import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import type { RemoteRef } from "../api/chats";
import { UnauthorizedError } from "../api/client";
import type { UserCard } from "../api/social";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import HelpTip from "./HelpTip";
import InstanceChip from "./InstanceChip";
import { ListRowSkeletons } from "./ListSkeleton";
import UserAvatar from "./UserAvatar";
import { PersonAvatar } from "./chats/ChatAvatar";

/** Someone the picker lists: here (`remote` unset), or on a partner instance, whose `id` is theirs here. */
export type PickerPerson = UserCard & { online?: boolean; remote?: RemoteRef | null };

type Props<P extends PickerPerson> = {
  /** Finds people for what's typed: a chat's search, or sharing's. */
  search: (query: string) => Promise<P[]>;
  /** Nothing can be picked or taken off meanwhile, as while what's picked is being saved. */
  disabled?: boolean;
  /** Behind the search field's `?`, when what it finds isn't as a chat's search finds it. */
  help?: string;
  /** Picks one, as starting a chat does; or with `selected`, ticks any number. */
  onPick?: (person: P) => void;
  selected?: P[];
  onSelectedChange?: (people: P[]) => void;
  /** Left out of the list, e.g. the admin making a room, who is in it anyway. */
  excludeIds?: string[];
  autoFocus?: boolean;
  onUnauthorized?: () => void;
  /** The list's height, so a dialog doesn't grow and shrink as results come. */
  height?: number;
};

const NOBODY: string[] = [];
const monoSx = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "text.secondary" } as const;

/** The instance's other users, found by any part of their name or their whole email; then, while connected instances
 *  are on, people on partner instances, each with theirs. */
export default function PeoplePicker<P extends PickerPerson>({
  search,
  disabled = false,
  help,
  onPick,
  selected,
  onSelectedChange,
  excludeIds = NOBODY,
  autoFocus,
  onUnauthorized,
  height = 280,
}: Props<P>) {
  const { t } = useTranslation("app");
  const [query, setQuery] = React.useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const [people, setPeople] = React.useState<P[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const multi = Boolean(selected);
  const selectedIds = new Set(selected?.map((person) => person.id));
  const excluded = new Set(excludeIds);

  React.useEffect(() => {
    let current = true;
    setFailed(false);
    search(debounced).then(
      (found) => {
        if (current) setPeople(found);
      },
      (err) => {
        if (!current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [debounced, onUnauthorized, search]);

  const toggle = (person: P) => {
    if (disabled) return;
    if (!selected || !onSelectedChange) {
      onPick?.(person);
      return;
    }
    onSelectedChange(selectedIds.has(person.id) ? selected.filter((p) => p.id !== person.id) : [...selected, person]);
  };
  const shown = people?.filter((person) => !excluded.has(person.id)) ?? null;

  return (
    <Stack spacing={1}>
      <TextField
        size="small"
        fullWidth
        // A dialog opened to find someone: typing their name is the first thing to do.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("chats.searchPeople")}
        inputProps={{ "aria-label": t("chats.searchPeople") }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <HelpTip text={help ?? t("chats.searchPeopleHelp")} />
            </InputAdornment>
          ),
        }}
      />
      {multi && selected && selected.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {selected.map((person) => (
            <Chip
              key={person.id}
              size="small"
              avatar={<UserAvatar user={person} size={20} />}
              label={person.display_name}
              onDelete={disabled ? undefined : () => toggle(person)}
            />
          ))}
        </Box>
      )}
      <Box sx={{ height, overflowY: "auto", mx: -1 }}>
        {failed ? (
          <Alert severity="error" sx={{ mx: 1 }}>
            {t("chats.peopleFailed")}
          </Alert>
        ) : shown === null ? (
          <Box sx={{ pt: 1 }}>
            <ListRowSkeletons count={5} lead="circle" leadSize={32} />
          </Box>
        ) : shown.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2, textAlign: "center" }}>
            {debounced ? t("chats.noPeopleFound") : t("chats.noPeople")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {shown.map((person) => (
              <ListItemButton
                disabled={disabled}
                key={person.id}
                onClick={() => toggle(person)}
                selected={multi && selectedIds.has(person.id)}
                role={multi ? "checkbox" : undefined}
                aria-checked={multi ? selectedIds.has(person.id) : undefined}
                sx={{ borderRadius: 1, gap: 1.5 }}
              >
                {multi && (
                  <Checkbox
                    edge="start"
                    size="small"
                    checked={selectedIds.has(person.id)}
                    tabIndex={-1}
                    disableRipple
                    sx={{ p: 0.25 }}
                  />
                )}
                <PersonAvatar person={person} size={32} />
                {person.remote ? (
                  <>
                    <ListItemText
                      primary={person.display_name}
                      secondary={person.remote.handle}
                      primaryTypographyProps={{ variant: "body2", noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption", noWrap: true, sx: monoSx }}
                      sx={{ minWidth: 0 }}
                    />
                    <Box sx={{ flexShrink: 0, maxWidth: "40%" }}>
                      <InstanceChip instance={person.remote.instance} label={person.remote.instance.name} />
                    </Box>
                  </>
                ) : (
                  <ListItemText
                    primary={person.display_name}
                    secondary={person.online ? t("chats.online") : undefined}
                    primaryTypographyProps={{ variant: "body2", noWrap: true }}
                    secondaryTypographyProps={{ variant: "caption", color: "success.main" }}
                  />
                )}
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Stack>
  );
}
