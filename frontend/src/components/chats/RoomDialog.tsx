import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { chatsApi, type Chat, type ChatPerson } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import Segmented from "../controls/Segmented";
import HelpTip from "../HelpTip";
import PeoplePicker from "../PeoplePicker";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;

type Visibility = "public" | "private";

type Props = {
  /** The room to edit, with its members; none to make a new one. */
  room?: { chat: Chat; members: ChatPerson[] } | null;
  viewerId: string;
  onClose: () => void;
  onSaved: (chat: Chat) => void;
  onUnauthorized?: () => void;
};

/** An admin's: a room's name, what it's for, and who's in it -- anyone who joins a public one, the people picked for a
 *  private one. */
export default function RoomDialog({ room, viewerId, onClose, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const editing = room?.chat;
  const [name, setName] = React.useState(editing?.name ?? "");
  const [description, setDescription] = React.useState(editing?.description ?? "");
  const [visibility, setVisibility] = React.useState<Visibility>(
    editing ? (editing.is_public ? "public" : "private") : "public",
  );
  // The admin themselves are in a room they make; when editing, they're one of the members like anyone else.
  const [members, setMembers] = React.useState<ChatPerson[]>(
    room?.members.filter((member) => member.id !== viewerId) ?? [],
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const trimmed = name.trim();
  const save = async () => {
    setSaving(true);
    setError(null);
    const text = { name: trimmed, description: description.trim() || null, is_public: visibility === "public" };
    // People here by their accounts, partners' people (the room stays hosted here) by theirs.
    const idsOf = (people: ChatPerson[], remote: boolean) =>
      people.filter((person) => Boolean(person.remote) === remote).map((person) => person.id);
    const chosen = idsOf(members, false);
    const chosenRemote = idsOf(members, true);
    try {
      if (editing) {
        // By who's added and who's taken out, so anyone the editor didn't load stays where they are. The admin
        // editing isn't in the picker, so they stay as they were too.
        const before = (room?.members ?? []).filter((member) => member.id !== viewerId);
        const had = new Set(idsOf(before, false));
        const hadRemote = new Set(idsOf(before, true));
        const kept = new Set([...chosen, ...chosenRemote]);
        const changes =
          visibility === "private"
            ? {
                add_member_ids: chosen.filter((id) => !had.has(id)),
                remove_member_ids: [...had].filter((id) => !kept.has(id)),
                add_remote_member_ids: chosenRemote.filter((id) => !hadRemote.has(id)),
                remove_remote_member_ids: [...hadRemote].filter((id) => !kept.has(id)),
              }
            : {};
        onSaved(await chatsApi.updateRoom(editing.id, { ...text, ...changes }));
      } else {
        onSaved(
          await chatsApi.createRoom({
            ...text,
            ...(visibility === "private" ? { member_ids: chosen, remote_member_ids: chosenRemote } : {}),
          }),
        );
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("chats.roomSaveFailed"));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? t("chats.editRoom") : t("chats.newRoom")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t("chats.roomName")}
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
            disabled={saving}
            fullWidth
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            required
          />
          <TextField
            label={t("chats.roomDescription")}
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}
            disabled={saving}
            fullWidth
            multiline
            minRows={2}
          />
          <Stack spacing={0.5} alignItems="flex-start">
            <Typography variant="body2" color="text.secondary">
              {t("chats.roomVisibility")}
              <HelpTip text={t("chats.roomVisibilityHelp")} />
            </Typography>
            <Segmented
              value={visibility}
              onChange={setVisibility}
              label={t("chats.roomVisibility")}
              disabled={saving}
              options={[
                { value: "public", label: t("chats.public") },
                { value: "private", label: t("chats.private") },
              ]}
            />
          </Stack>
          {visibility === "private" && (
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                {t("chats.roomMembers", { count: members.length })}
              </Typography>
              <PeoplePicker
                search={chatsApi.people}
                selected={members}
                onSelectedChange={setMembers}
                excludeIds={[viewerId]}
                onUnauthorized={onUnauthorized}
                height={220}
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || !trimmed}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {editing ? t("common:save") : t("chats.createRoom")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
