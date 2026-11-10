import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import CheckIcon from "@mui/icons-material/Check";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import type { AuthUser } from "../../api/auth";
import type { Author } from "../../api/authors";
import { UnauthorizedError } from "../../api/client";
import { profileApi, type PublicProfilePatch } from "../../api/profile";
import HelpTip from "../../components/HelpTip";
import { SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import ProfileCover from "../../components/profile/ProfileCover";
import UsernameField, { usernameSavable, type UsernameState } from "../../components/profile/UsernameField";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import { newLocalId } from "../../utils/localId";
import { printProviderInfo } from "../../constants/importProviders";
import {
  BIO_MAX_LENGTH,
  COVER_MAX_BYTES,
  PROFILE_LINKS_MAX,
  COVER_PRESETS,
  presetCoverUrl,
  type CoverPreset,
} from "../../constants/profileCovers";

const PREVIEW_HEIGHT = 150;
const appear = keyframes`from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; }`;

/** "printables.com/@me" is what most people paste: it's a web address all the same. */
const withScheme = (value: string) => {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
};

/** What the backend takes: a web address, http or https -- never a javascript: one, which would run when opened. */
const isWebAddress = (value: string) => {
  // Browsers' URL parsers let a space through that the server's refuses.
  if (/\s/.test(value)) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const pop = keyframes`from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; }`;

type Choice =
  | { kind: "preset"; preset: CoverPreset }
  | { kind: "author"; authorId: string; url: string }
  /** The picture they uploaded before. */
  | { kind: "picture"; url: string }
  | { kind: "upload"; file: File; url: string };

const choiceUrl = (choice: Choice) => (choice.kind === "preset" ? presetCoverUrl(choice.preset) : choice.url);
const sameChoice = (a: Choice, b: Choice) => a.kind === b.kind && choiceUrl(a) === choiceUrl(b);
const clamp = (value: number) => Math.min(100, Math.max(0, value));

function initialChoice(user: AuthUser, linkedAuthors: Author[]): Choice {
  if (user.background_url) {
    const author = linkedAuthors.find((linked) => linked.background_url === user.background_url);
    return author
      ? { kind: "author", authorId: author.id, url: user.background_url }
      : { kind: "picture", url: user.background_url };
  }
  return { kind: "preset", preset: user.cover_preset ?? COVER_PRESETS[0] };
}

type Props = {
  user: AuthUser;
  linkedAuthors: Author[];
  onClose: () => void;
  onSaved: (user: AuthUser) => void;
  /** Each step of a save that went through, so the page keeps up when a later one fails. */
  onUpdated?: (user: AuthUser) => void;
  onUnauthorized?: () => void;
};

/** The user's cover and bio, as the other users see them. Nothing is kept until Save, an upload included. */
export default function EditProfileDialog({ user, linkedAuthors, onClose, onSaved, onUpdated, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [initial] = useState(() => initialChoice(user, linkedAuthors));
  const initialPosition = user.cover_position_y ?? 50;
  const [choice, setChoice] = useState<Choice>(initial);
  const [positionY, setPositionY] = useState(initialPosition);
  const [upload, setUpload] = useState<Extract<Choice, { kind: "upload" }> | null>(null);
  const [bio, setBio] = useState(user.bio ?? "");
  // Ids keep each field and its focus with it when one above is removed.
  const [links, setLinks] = useState(() => (user.links ?? []).map((value) => ({ id: newLocalId(), value })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // While this instance connects with others, the username others there know them by.
  const social = useSocialStatus();
  const handleHost = social?.federation ? social.instance_host : null;
  const [username, setUsername] = useState(user.username ?? "");
  const [usernameState, setUsernameState] = useState<UsernameState>("unchanged");
  const fileInput = useRef<HTMLInputElement>(null);
  // The picture already put up by a save whose next step failed: trying again doesn't upload it twice.
  const uploaded = useRef<{ file: File; positionY: number } | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startPosition: number; range: number } | null>(null);
  // The picture's own size, for how far a drag can move it.
  const natural = useRef<{ url: string; width: number; height: number } | null>(null);

  const url = choiceUrl(choice);
  // A drawn cover is made to sit centred; a picture is moved to show the part that matters.
  const movable = choice.kind !== "preset";

  useEffect(() => {
    if (!movable) return;
    let cancelled = false;
    const image = new Image();
    // A picture chosen before this one can finish loading after it: its size isn't this one's.
    image.addEventListener("load", () => {
      if (!cancelled) natural.current = { url, width: image.naturalWidth, height: image.naturalHeight };
    });
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, movable]);

  const uploadUrl = upload?.url;
  useEffect(
    () => () => {
      if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    },
    [uploadUrl],
  );

  const pick = (next: Choice) => {
    setChoice(next);
    setPositionY(sameChoice(next, initial) ? initialPosition : 50);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(t("models:author.editProfile.notAPicture"));
    if (file.size > COVER_MAX_BYTES) return setError(t("models:author.editProfile.uploadTooBig"));
    setError(null);
    const next = { kind: "upload" as const, file, url: URL.createObjectURL(file) };
    setUpload(next);
    pick(next);
  };

  /** How many pixels the picture can travel up and down in the preview. */
  const dragRange = () => {
    const box = preview.current;
    const size = natural.current;
    if (!box || !size || size.url !== url) return 0;
    const scale = Math.max(box.clientWidth / size.width, PREVIEW_HEIGHT / size.height);
    return Math.max(0, size.height * scale - PREVIEW_HEIGHT);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!movable || saving) return;
    const range = dragRange();
    if (range < 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startPosition: positionY, range };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    // Dragging the picture down brings its top into view.
    setPositionY(clamp(current.startPosition - ((event.clientY - current.startY) / current.range) * 100));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onPreviewKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: 5,
      ArrowRight: 5,
      ArrowDown: -5,
      ArrowLeft: -5,
      PageUp: 20,
      PageDown: -20,
    };
    if (event.key in steps) setPositionY((value) => clamp(value + steps[event.key]));
    else if (event.key === "Home") setPositionY(0);
    else if (event.key === "End") setPositionY(100);
    else return;
    event.preventDefault();
  };

  const trimmedBio = bio.trim();
  const coverChanged = !sameChoice(choice, initial);
  const positionChanged = Math.round(positionY) !== initialPosition;
  const bioChanged = trimmedBio !== (user.bio ?? "").trim();
  const cleanLinks = links.map((link) => withScheme(link.value)).filter(Boolean);
  const linksChanged = cleanLinks.join("\n") !== (user.links ?? []).join("\n");
  const linksValid = cleanLinks.every(isWebAddress);
  const usernameChanged = Boolean(handleHost) && usernameState !== "unchanged";
  const dirty = coverChanged || positionChanged || bioChanged || linksChanged || usernameChanged;

  const setLink = (id: string, value: string) =>
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, value } : link)));
  const completeLink = (id: string, value: string) => {
    if (withScheme(value) !== value.trim()) setLink(id, withScheme(value));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let saved = user;
      // First: a username someone else took meanwhile stops the save before anything else changes.
      if (usernameChanged) {
        saved = await profileApi.setUsername(username);
        onUpdated?.(saved);
      }
      if (choice.kind === "upload" && uploaded.current?.file !== choice.file) {
        saved = await profileApi.uploadCover(choice.file, positionY);
        uploaded.current = { file: choice.file, positionY };
        onUpdated?.(saved);
      }
      const patch: PublicProfilePatch = {};
      if (bioChanged) patch.bio = trimmedBio || null;
      if (linksChanged) patch.links = cleanLinks;
      if (coverChanged && choice.kind === "preset") patch.cover_preset = choice.preset;
      if (coverChanged && choice.kind === "author") patch.cover_author_id = choice.authorId;
      if (choice.kind !== "upload" && (coverChanged || positionChanged)) patch.cover_position_y = Math.round(positionY);
      // Moved since the upload that went through.
      if (choice.kind === "upload" && uploaded.current && uploaded.current.positionY !== positionY) {
        patch.cover_position_y = Math.round(positionY);
      }
      if (Object.keys(patch).length) saved = await profileApi.update(patch);
      onSaved(saved);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("models:author.editProfile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // `badge` names where a picture that isn't one of the drawn covers comes from.
  const tiles: { key: string; label: string; badge?: string; choice: Choice }[] = [
    ...(initial.kind === "picture"
      ? [{ key: "picture", label: t("models:author.editProfile.yourPicture"), choice: initial }]
      : []),
    ...(upload ? [{ key: "upload", label: upload.file.name, choice: upload }] : []),
    ...linkedAuthors.flatMap((author) =>
      author.background_url
        ? [
            {
              key: `author:${author.id}`,
              label: t("models:author.editProfile.fromAccount", { provider: printProviderInfo(author.provider).label }),
              badge: printProviderInfo(author.provider).label,
              choice: { kind: "author" as const, authorId: author.id, url: author.background_url },
            },
          ]
        : [],
    ),
    ...COVER_PRESETS.map((preset) => ({
      key: `preset:${preset}`,
      label: t(`models:author.editProfile.presets.${preset}`),
      choice: { kind: "preset" as const, preset },
    })),
  ];

  const tileSx = {
    position: "relative",
    aspectRatio: "12 / 5",
    borderRadius: "8px",
    overflow: "hidden",
    outline: "2px solid transparent",
    outlineOffset: "2px",
    transition: "outline-color 150ms ease-out, transform 150ms ease-out",
    "&:hover": { transform: "translateY(-2px)" },
    "&.Mui-focusVisible": { outlineColor: (theme: Theme) => theme.palette.primary.main },
    "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
  } as const;

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t("models:author.editProfile.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          {handleHost && (
            <Box>
              <SectionLabel>
                {t("models:author.username.label")}
                <HelpTip text={t("models:author.username.why")} />
              </SectionLabel>
              <UsernameField
                value={username}
                onChange={setUsername}
                current={user.username}
                host={handleHost}
                onState={setUsernameState}
                disabled={saving}
                onUnauthorized={onUnauthorized}
              />
            </Box>
          )}
          <Box>
            <SectionLabel>
              {t("models:author.editProfile.cover")}
              <HelpTip text={t("models:author.editProfile.coverHelp")} />
            </SectionLabel>
            <Box
              ref={preview}
              // A picture is positioned like a vertical slider: by drag, or by the arrow keys once focused.
              {...(movable && {
                role: "slider",
                tabIndex: 0,
                "aria-label": t("models:author.editProfile.position"),
                "aria-orientation": "vertical" as const,
                "aria-valuemin": 0,
                "aria-valuemax": 100,
                "aria-valuenow": Math.round(positionY),
                "aria-valuetext": `${Math.round(positionY)}%`,
                onKeyDown: onPreviewKey,
              })}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              sx={{
                borderRadius: "12px",
                overflow: "hidden",
                cursor: movable ? (dragging ? "grabbing" : "grab") : "default",
                touchAction: movable ? "none" : "auto",
                userSelect: "none",
                outline: "2px solid transparent",
                outlineOffset: "2px",
                "&:focus-visible": { outlineColor: (theme) => theme.palette.primary.main },
              }}
            >
              <ProfileCover cover={{ background_url: url }} height={PREVIEW_HEIGHT} positionY={positionY}>
                {movable && (
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    aria-hidden
                    sx={(theme) => ({
                      position: "absolute",
                      left: "50%",
                      bottom: 10,
                      transform: "translateX(-50%)",
                      px: 1.25,
                      py: 0.5,
                      borderRadius: 99,
                      bgcolor: alpha(theme.palette.common.black, 0.55),
                      color: theme.palette.common.white,
                      pointerEvents: "none",
                      opacity: dragging ? 0 : 1,
                      transition: "opacity 150ms ease-out",
                    })}
                  >
                    <OpenWithIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption" fontWeight={600} color="inherit">
                      {t("models:author.editProfile.drag")}
                    </Typography>
                  </Stack>
                )}
              </ProfileCover>
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                gap: 1.25,
                mt: 1.5,
              }}
            >
              {tiles.map((tile) => {
                const selected = sameChoice(tile.choice, choice);
                return (
                  <Tooltip key={tile.key} title={tile.label}>
                    <ButtonBase
                      aria-label={tile.label}
                      aria-pressed={selected}
                      disabled={saving}
                      onClick={() => pick(tile.choice)}
                      sx={{
                        ...tileSx,
                        backgroundImage: `url("${choiceUrl(tile.choice)}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        ...(selected && { outlineColor: (theme) => theme.palette.primary.main }),
                      }}
                    >
                      {tile.badge && (
                        <Typography
                          variant="caption"
                          aria-hidden
                          sx={(theme) => ({
                            position: "absolute",
                            left: 4,
                            bottom: 4,
                            maxWidth: "calc(100% - 8px)",
                            px: 0.75,
                            borderRadius: 99,
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: "16px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            bgcolor: alpha(theme.palette.common.black, 0.55),
                            color: theme.palette.common.white,
                          })}
                        >
                          {tile.badge}
                        </Typography>
                      )}
                      {selected && (
                        <Box
                          sx={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "primary.main",
                            color: "primary.contrastText",
                            animation: `${pop} 200ms ease-out`,
                            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                          }}
                        >
                          <CheckIcon sx={{ fontSize: 13 }} />
                        </Box>
                      )}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
              <Tooltip title={t("models:author.editProfile.uploadHint")}>
                <ButtonBase
                  disabled={saving}
                  onClick={() => fileInput.current?.click()}
                  sx={{
                    ...tileSx,
                    flexDirection: "column",
                    gap: 0.25,
                    border: "1px dashed",
                    borderColor: "divider",
                    color: "text.secondary",
                    "&:hover": { ...tileSx["&:hover"], color: "primary.main", borderColor: "primary.main" },
                  }}
                >
                  <AddPhotoAlternateOutlinedIcon fontSize="small" />
                  <Typography variant="caption" fontWeight={600} color="inherit">
                    {t("models:author.editProfile.upload")}
                  </Typography>
                </ButtonBase>
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  onFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </Box>
          </Box>

          <Box>
            <SectionLabel>
              {t("models:author.editProfile.bio")}
              <HelpTip text={t("models:author.editProfile.bioHelp")} />
            </SectionLabel>
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder={t("models:author.editProfile.bioPlaceholder")}
              disabled={saving}
              helperText={`${bio.length} / ${BIO_MAX_LENGTH}`}
              slotProps={{
                htmlInput: { maxLength: BIO_MAX_LENGTH, "aria-label": t("models:author.editProfile.bio") },
                formHelperText: { sx: { textAlign: "right", mx: 0 } },
              }}
            />
          </Box>
          <Box>
            <SectionLabel>
              {t("models:author.editProfile.links")}
              <HelpTip text={t("models:author.editProfile.linksHelp", { count: PROFILE_LINKS_MAX })} />
            </SectionLabel>
            <Stack spacing={1}>
              {links.map((link, index) => {
                const invalid = Boolean(link.value.trim()) && !isWebAddress(withScheme(link.value));
                return (
                  <Stack
                    key={link.id}
                    direction="row"
                    spacing={0.5}
                    alignItems="flex-start"
                    sx={{
                      animation: `${appear} 180ms ease-out`,
                      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                    }}
                  >
                    <TextField
                      size="small"
                      fullWidth
                      value={link.value}
                      onChange={(event) => setLink(link.id, event.target.value)}
                      onBlur={(event) => completeLink(link.id, event.target.value)}
                      placeholder="https://"
                      disabled={saving}
                      error={invalid}
                      helperText={invalid ? t("models:author.editProfile.linkInvalid") : undefined}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <LinkIcon fontSize="small" />
                            </InputAdornment>
                          ),
                        },
                        htmlInput: {
                          inputMode: "url",
                          maxLength: 500,
                          "aria-label": t("models:author.editProfile.linkLabel", { n: index + 1 }),
                        },
                      }}
                    />
                    <Tooltip title={t("models:author.editProfile.removeLink")}>
                      <IconButton
                        aria-label={t("models:author.editProfile.removeLink")}
                        disabled={saving}
                        onClick={() => setLinks((current) => current.filter((other) => other.id !== link.id))}
                        sx={{ mt: 0.25 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Stack>
            {links.length < PROFILE_LINKS_MAX && (
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={saving}
                onClick={() => setLinks((current) => [...current, { id: newLocalId(), value: "" }])}
                sx={{ mt: links.length ? 1 : 0 }}
              >
                {t("models:author.editProfile.addLink")}
              </Button>
            )}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={save}
          // The username counts only while its field shows: hidden, it isn't saved either.
          disabled={saving || !dirty || !linksValid || (Boolean(handleHost) && !usernameSavable(usernameState))}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
