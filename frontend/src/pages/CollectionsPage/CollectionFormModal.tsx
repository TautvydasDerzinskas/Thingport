import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import {
  collectionsApi,
  type Collection,
  type CollectionInput,
  type CollectionSharingPatch,
  type CollectionVisibility,
  type SharePerson,
} from "../../api/collections";
import { UnauthorizedError } from "../../api/client";
import { socialApi } from "../../api/social";
import TagInput from "../../components/TagInput";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import PeoplePicker from "../../components/PeoplePicker";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import SharedAvatars from "../../components/SharedAvatars";
import { peopleNames } from "../../utils/peopleNames";
import { oneOrSeveral } from "../../utils/oneOrSeveral";

type Props = {
  collection?: Collection | null;
  /** Opened to share it, from Share…: on who sees it, and a private one shared until saved otherwise. */
  share?: boolean;
  onClose: () => void;
  /** `sharing` is who sees it, when that changed: applied once the collection is saved. */
  onSubmit: (input: CollectionInput, sharing: CollectionSharingPatch | null) => Promise<void>;
  /** The session ran out while finding people or loading who sees it. */
  onUnauthorized?: () => void;
};

const iconSx = { fontSize: 16 } as const;

/** The visibility a collection has, from an older server too, which says only whether it's public. */
export const visibilityOf = (collection?: Collection | null): CollectionVisibility =>
  collection?.visibility ?? (collection?.is_public ? "public" : "private");

/** Edit mode is create mode prefilled from `collection`. */
export default function CollectionFormModal({ collection, share = false, onClose, onSubmit, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const [name, setName] = useState(collection?.name || "");
  const [description, setDescription] = useState(collection?.description || "");
  const [tags, setTags] = useState<string[]>(collection?.tags || []);
  // Private until its owner says otherwise. Offered only while social features are on: off, nobody else sees it anyway.
  const social = useSocialStatus();
  // On a phone the three choices fit one row without their icons.
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  // As saved, from the card until who sees it is loaded, then as the server has it (changed elsewhere meanwhile, say):
  // what's sent is only a change from that.
  const [savedVisibility, setSavedVisibility] = useState<CollectionVisibility>(() => visibilityOf(collection));
  const opened = (saved: CollectionVisibility): CollectionVisibility =>
    share && saved === "private" ? "shared" : saved;
  const [visibility, setVisibility] = useState<CollectionVisibility>(() => opened(visibilityOf(collection)));
  // Who it's shared with, as saved (kept while it's private or public too) and as picked here. Until the saved list is
  // here, who sees it can't be changed: making it shared would share it with people the owner wasn't shown.
  const [savedPeople, setSavedPeople] = useState<SharePerson[] | null>(collection ? null : []);
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sharingReady = savedPeople !== null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(collection);
  const trimmedName = name.trim();
  const collectionId = collection?.id;

  useEffect(() => {
    if (!collectionId || !social?.enabled) return;
    let current = true;
    setLoadFailed(false);
    // Loaded again (social features back on, or Retry): nothing about who sees it changes until it's here.
    setSavedPeople(null);
    collectionsApi.sharing(collectionId).then(
      (sharing) => {
        if (!current) return;
        setSavedVisibility(sharing.visibility);
        setVisibility(opened(sharing.visibility));
        setSavedPeople(sharing.people);
        setPeople(sharing.people);
      },
      (err: unknown) => {
        if (!current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        setLoadFailed(true);
        // Back to how it is: nothing about who sees it changes until the list loads.
        setVisibility(visibilityOf(collection));
      },
    );
    return () => {
      current = false;
    };
    // `collection` only seeds the visibility put back; a new one is a new form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, social?.enabled, attempt]);

  const sharingPatch = (): CollectionSharingPatch | null => {
    if (!social?.enabled || !sharingReady) return null;
    const saved = new Set((savedPeople ?? []).map((person) => person.id));
    const picked = new Set(people.map((person) => person.id));
    const add = people.filter((person) => !saved.has(person.id));
    const remove = (savedPeople ?? []).filter((person) => !picked.has(person.id));
    // Someone here by their user id, someone elsewhere by their id on this instance.
    const ids = (list: SharePerson[], remote: boolean) =>
      list.filter((person) => Boolean(person.remote) === remote).map((person) => person.id);
    const changed = visibility !== savedVisibility;
    if (!changed && !add.length && !remove.length) return null;
    const patch: CollectionSharingPatch = changed ? { visibility } : {};
    if (ids(add, false).length) patch.add_user_ids = ids(add, false);
    if (ids(remove, false).length) patch.remove_user_ids = ids(remove, false);
    if (ids(add, true).length) patch.add_remote_person_ids = ids(add, true);
    if (ids(remove, true).length) patch.remove_remote_person_ids = ids(remove, true);
    return patch;
  };

  const handleSubmit = async () => {
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: trimmedName, description: description.trim() || null, tags }, sharingPatch());
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("models:collections.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const names = useMemo(
    () =>
      peopleNames(
        people.map((person) => person.display_name),
        people.length,
        t,
        i18n.language,
      ),
    [people, t, i18n.language],
  );
  const elsewhere = people.filter((person) => person.remote).length;

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? t("models:collections.form.editTitle") : t("models:collections.form.createTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t("models:collections.form.nameLabel")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            fullWidth
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!share}
            required
          />
          <TextField
            label={t("models:collections.form.descriptionLabel")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            fullWidth
            multiline
            minRows={3}
          />
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {t("models:collections.form.tagsLabel")}
            </Typography>
            <TagInput
              value={tags}
              onChange={setTags}
              placeholder={t("models:collections.form.tagsPlaceholder") ?? undefined}
            />
          </Stack>
          {social?.enabled && (
            <Stack spacing={1}>
              <Stack spacing={0.5} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  {t("models:collections.form.visibilityLabel")}
                  <HelpTip text={t("models:collections.form.visibilityHelp")} />
                </Typography>
                <Segmented
                  value={visibility}
                  onChange={setVisibility}
                  label={t("models:collections.form.visibilityLabel")}
                  disabled={saving || !sharingReady}
                  options={[
                    {
                      value: "private",
                      label: t("models:collections.form.private"),
                      startIcon: narrow ? undefined : <LockOutlinedIcon sx={iconSx} />,
                    },
                    {
                      value: "shared",
                      label: t("models:collections.form.shared"),
                      startIcon: narrow ? undefined : <GroupOutlinedIcon sx={iconSx} />,
                    },
                    {
                      value: "public",
                      label: t("models:collections.form.public"),
                      startIcon: narrow ? undefined : <PublicOutlinedIcon sx={iconSx} />,
                    },
                  ]}
                />
              </Stack>
              {loadFailed ? (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
                      {t("common:retry")}
                    </Button>
                  }
                >
                  {t("models:collections.form.peopleFailed")}
                </Alert>
              ) : visibility === "shared" ? (
                <Stack
                  spacing={1}
                  sx={{
                    animation: "collection-sharing-in 200ms ease-out",
                    "@keyframes collection-sharing-in": {
                      from: { opacity: 0, transform: "translateY(-6px)" },
                      to: { opacity: 1, transform: "none" },
                    },
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  }}
                >
                  {savedPeople === null ? (
                    <ListRowSkeletons count={4} lead="circle" leadSize={32} />
                  ) : (
                    <PeoplePicker
                      search={socialApi.people}
                      onUnauthorized={onUnauthorized}
                      // What's picked is sent as Save is pressed: a change made while it saves would be lost.
                      disabled={saving}
                      help={social.federation ? t("models:collections.form.findPeopleHelp") : undefined}
                      selected={people}
                      onSelectedChange={setPeople}
                      // Opened from Share…: finding someone is the first thing to do.
                      // oxlint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus={share}
                      height={220}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary" component="div">
                    {people.length
                      ? t("models:collections.form.sharedCount", { count: people.length })
                      : t("models:collections.form.sharedNobody")}
                    {elsewhere > 0 && ` · ${t("models:collections.form.sharedElsewhere", { count: elsewhere })}`}
                    <HelpTip text={t("models:collections.form.sharedHelp")} />
                  </Typography>
                </Stack>
              ) : (
                people.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1.25}
                    alignItems="center"
                    sx={{ px: 1.5, py: 1, border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 2 }}
                  >
                    <SharedAvatars people={people.slice(0, 3)} size={22} dim />
                    <Typography variant="caption" color="text.secondary">
                      {t("models:collections.form.keptPeople", { names, count: oneOrSeveral(people.length) })}
                    </Typography>
                  </Stack>
                )
              )}
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
          onClick={handleSubmit}
          // Waiting for who it's shared with: the form may show a change it can't send until that's here.
          disabled={saving || !trimmedName || (Boolean(social?.enabled) && isEdit && !sharingReady && !loadFailed)}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {isEdit ? t("common:save") : t("models:collections.form.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
