import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CheckIcon from "@mui/icons-material/Check";
import PersonIcon from "@mui/icons-material/Person";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import type { AuthUser } from "../../api/auth";
import { authorsApi, type Author } from "../../api/authors";
import { UnauthorizedError } from "../../api/client";
import { profileApi } from "../../api/profile";
import {
  AVATAR_MAX_BYTES,
  PART_NAMES,
  partChoices,
  sameAvatarStyle,
  shuffledAvatarStyle,
  thingportAvatarUrl,
  type AvatarPart,
  type AvatarStyle,
} from "../../constants/avatar";
import { printProviderInfo } from "../../constants/importProviders";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import Segmented from "../controls/Segmented";
import HelpTip from "../HelpTip";
import { SectionLabel } from "../Layout/ConfigurationDialog/parts";

type Mode = "thingport" | "picture" | "auto";
type Picture =
  | { kind: "current"; url: string }
  | { kind: "upload"; file: File; url: string }
  | { kind: "author"; authorId: string; url: string };

const PREVIEW_SIZE = 120;
const pop = keyframes`from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; }`;
const appear = keyframes`from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; }`;
const ROWS: { part: AvatarPart; size: number }[] = [
  { part: "hair", size: 52 },
  { part: "glasses", size: 52 },
  { part: "mouth", size: 52 },
  { part: "hair_color", size: 40 },
  { part: "background", size: 40 },
];

const tileSx = (selected: boolean) => ({
  position: "relative",
  borderRadius: "50%",
  outline: "2px solid",
  outlineColor: (theme: Theme) => (selected ? theme.palette.primary.main : "transparent"),
  outlineOffset: "2px",
  transition: "outline-color 150ms ease-out, transform 150ms ease-out",
  "&:hover": { transform: "translateY(-2px)" },
  "&.Mui-focusVisible": { outlineColor: (theme: Theme) => theme.palette.primary.main },
  "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
});

function Check() {
  return (
    <Box
      sx={{
        position: "absolute",
        top: -4,
        right: -4,
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
  );
}

type Props = {
  user: AuthUser;
  onClose: () => void;
  onSaved: (user: AuthUser) => void;
  onUnauthorized?: () => void;
};

/** The user's avatar: a Thingport one they design, a picture, or automatic -- their Gravatar, else the one picked for
 *  them. Shared by My models and the profile page, where clicking the avatar opens it. Nothing is kept until Save. */
export default function AvatarDialog({ user, onClose, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const source = user.avatar_source ?? "auto";
  const [picked] = useState(() => user.avatar_picked_style ?? shuffledAvatarStyle());
  const [mode, setMode] = useState<Mode>(source);
  const [style, setStyle] = useState<AvatarStyle>(() => user.avatar_style ?? picked);
  const [picture, setPicture] = useState<Picture | null>(
    source === "picture" && user.avatar_url ? { kind: "current", url: user.avatar_url } : null,
  );
  const [upload, setUpload] = useState<Extract<Picture, { kind: "upload" }> | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the user's own: the browser has always asked Gravatar for theirs.
  const gravatar = useGravatarUrl(user.email, 256);

  useEffect(() => {
    let cancelled = false;
    authorsApi.myLinks().then(
      (linked) => !cancelled && setAuthors(linked.filter((author) => author.avatar_url)),
      (err) => err instanceof UnauthorizedError && onUnauthorized?.(),
    );
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  const uploadUrl = upload?.url;
  useEffect(
    () => () => {
      if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    },
    [uploadUrl],
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(t("models:author.editProfile.notAPicture"));
    if (file.size > AVATAR_MAX_BYTES) return setError(t("models:author.editProfile.uploadTooBig"));
    setError(null);
    const next = { kind: "upload" as const, file, url: URL.createObjectURL(file) };
    setUpload(next);
    setPicture(next);
  };

  const choiceLabel = (part: AvatarPart, choice: number) =>
    choice < 0 ? t("models:avatar.none") : t(`models:avatar.${part}.${PART_NAMES[part][choice]}`);

  const dirty =
    mode === "thingport"
      ? source !== "thingport" || !sameAvatarStyle(style, user.avatar_style)
      : mode === "picture"
        ? Boolean(picture && picture.kind !== "current")
        : source !== "auto";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let saved: AuthUser;
      if (mode === "thingport") saved = await profileApi.update({ avatar_style: style });
      else if (mode === "auto") saved = await profileApi.update({ avatar_auto: true });
      else if (picture?.kind === "upload") saved = await profileApi.uploadAvatar(picture.file);
      else if (picture?.kind === "author") saved = await profileApi.update({ avatar_author_id: picture.authorId });
      else return onClose();
      onSaved(saved);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("models:avatar.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const previewSx = { width: PREVIEW_SIZE, height: PREVIEW_SIZE, fontSize: 44 };
  const preview =
    mode === "thingport" ? (
      <Avatar src={thingportAvatarUrl(style)} alt="" sx={previewSx} />
    ) : mode === "picture" ? (
      <Avatar src={picture?.url} alt="" sx={previewSx}>
        <PersonIcon fontSize="inherit" />
      </Avatar>
    ) : (
      // Their Gravatar where there's one; the picked avatar shows in its place when there isn't.
      <Avatar src={gravatar} alt="" sx={previewSx}>
        <Box component="img" src={thingportAvatarUrl(picked)} alt="" sx={{ width: "100%", height: "100%" }} />
      </Avatar>
    );
  const previewKey =
    mode === "thingport" ? thingportAvatarUrl(style) : mode === "picture" ? (picture?.url ?? "none") : "auto";

  const pictureTiles: { key: string; label: string; badge?: string; picture: Picture }[] = [
    ...(source === "picture" && user.avatar_url
      ? [
          {
            key: "current",
            label: t("models:avatar.yourPicture"),
            picture: { kind: "current" as const, url: user.avatar_url },
          },
        ]
      : []),
    ...(upload ? [{ key: "upload", label: upload.file.name, picture: upload }] : []),
    ...authors.map((author) => {
      const provider = printProviderInfo(author.provider).label;
      return {
        key: `author:${author.id}`,
        label: t("models:avatar.fromAccount", { provider }),
        badge: provider,
        picture: { kind: "author" as const, authorId: author.id, url: author.avatar_url! },
      };
    }),
  ];

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t("models:avatar.title")}</DialogTitle>
      <DialogContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={3}
          alignItems={{ xs: "center", sm: "flex-start" }}
          sx={{ mt: 0.5 }}
        >
          <Stack alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
            <Box
              key={previewKey}
              sx={{
                animation: `${appear} 180ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            >
              {preview}
            </Box>
            {mode === "thingport" && (
              <Button
                size="small"
                startIcon={<ShuffleIcon />}
                disabled={saving}
                onClick={() => setStyle(shuffledAvatarStyle())}
              >
                {t("models:avatar.shuffle")}
              </Button>
            )}
          </Stack>

          <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
            <Segmented
              value={mode}
              onChange={setMode}
              label={t("models:avatar.title")}
              fullWidth
              disabled={saving}
              options={[
                { value: "thingport", label: t("models:avatar.modes.thingport") },
                { value: "picture", label: t("models:avatar.modes.picture") },
                { value: "auto", label: t("models:avatar.modes.auto") },
              ]}
            />

            {mode === "thingport" &&
              ROWS.map(({ part, size }) => (
                <Box key={part}>
                  <SectionLabel>{t(`models:avatar.parts.${part}`)}</SectionLabel>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
                    {partChoices(part).map((choice) => {
                      const selected = style[part] === choice;
                      const label = choiceLabel(part, choice);
                      return (
                        <Tooltip key={choice} title={label}>
                          <ButtonBase
                            aria-label={label}
                            aria-pressed={selected}
                            disabled={saving}
                            onClick={() => setStyle((current) => ({ ...current, [part]: choice }))}
                            sx={tileSx(selected)}
                          >
                            <Avatar
                              src={thingportAvatarUrl({ ...style, [part]: choice })}
                              alt=""
                              sx={{ width: size, height: size }}
                            />
                            {selected && <Check />}
                          </ButtonBase>
                        </Tooltip>
                      );
                    })}
                  </Box>
                </Box>
              ))}

            {mode === "picture" && (
              <Box>
                <SectionLabel>
                  {t("models:avatar.modes.picture")}
                  <HelpTip text={t("models:avatar.pictureHelp")} />
                </SectionLabel>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                  {pictureTiles.map((tile) => {
                    const selected = picture?.url === tile.picture.url;
                    return (
                      <Tooltip key={tile.key} title={tile.label}>
                        <ButtonBase
                          aria-label={tile.label}
                          aria-pressed={selected}
                          disabled={saving}
                          onClick={() => setPicture(tile.picture)}
                          sx={tileSx(selected)}
                        >
                          <Avatar src={tile.picture.url} alt="" sx={{ width: 64, height: 64 }} />
                          {tile.badge && (
                            <Typography
                              variant="caption"
                              aria-hidden
                              sx={(theme) => ({
                                position: "absolute",
                                left: "50%",
                                bottom: -6,
                                transform: "translateX(-50%)",
                                px: 0.75,
                                borderRadius: 99,
                                fontSize: 10,
                                fontWeight: 700,
                                lineHeight: "16px",
                                whiteSpace: "nowrap",
                                bgcolor: alpha(theme.palette.common.black, 0.65),
                                color: theme.palette.common.white,
                              })}
                            >
                              {tile.badge}
                            </Typography>
                          )}
                          {selected && <Check />}
                        </ButtonBase>
                      </Tooltip>
                    );
                  })}
                  <Tooltip title={t("models:avatar.uploadHint")}>
                    <ButtonBase
                      disabled={saving}
                      onClick={() => fileInput.current?.click()}
                      sx={{
                        ...tileSx(false),
                        width: 64,
                        height: 64,
                        flexDirection: "column",
                        gap: 0.25,
                        border: "1px dashed",
                        borderColor: "divider",
                        color: "text.secondary",
                        "&:hover": {
                          transform: "translateY(-2px)",
                          color: "primary.main",
                          borderColor: "primary.main",
                        },
                      }}
                    >
                      <AddPhotoAlternateOutlinedIcon fontSize="small" />
                      <Typography variant="caption" fontWeight={600} color="inherit" sx={{ fontSize: 11 }}>
                        {t("models:avatar.upload")}
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
            )}

            {mode === "auto" && (
              <Typography variant="body2" color="text.secondary">
                {t("models:avatar.autoHint")}
              </Typography>
            )}

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !dirty}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {t("common:save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
