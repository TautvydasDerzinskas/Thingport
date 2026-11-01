import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import LinkIcon from "@mui/icons-material/Link";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { UnauthorizedError } from "../../api/client";
import { importsApi, type SourcePreview } from "../../api/imports";
import { printsApi, type Print } from "../../api/prints";
import { importProviderInfo } from "../../constants/importProviders";
import { useDisabledProviders } from "../../hooks/useProviders";
import { modelLinkOf, modelLinkProblem } from "../../utils/importLinkDetection";
import HelpTip from "../HelpTip";
import { ProviderLogo } from "../Layout/ConfigurationDialog/providerLogos";
import { useToast } from "../ToastProvider";

/** Long enough to let a paste, or the last of some typing, land before the provider is asked. */
const PREVIEW_DELAY_MS = 400;

const COVER_WIDTH = 96;
const COVER_HEIGHT = 72;

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

const previewBoxSx = {
  display: "flex",
  alignItems: "center",
  gap: 1.5,
  p: 1.25,
  mt: 1.5,
  animation: `${appear} 200ms ease-out`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
};

type PreviewAnswer = { url: string } & (
  { status: "ready"; preview: SourcePreview } | { status: "failed"; reason: string }
);

type Props = {
  print: Print;
  onClose: () => void;
  onLinked: (print: Print) => void;
  onUnauthorized?: () => void;
};

/** Links a model with no source to its page on a provider: paste the link, see what it would bring, then link. */
export default function LinkSourceDialog({ print, onClose, onLinked, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const showToast = useToast();
  const disabledProviders = useDisabledProviders();
  const [link, setLink] = useState("");
  const [answer, setAnswer] = useState<PreviewAnswer | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = link.trim();
  const problem = url ? modelLinkProblem(url, disabledProviders) : null;
  const linkable = url && !problem ? url : null;
  const provider = linkable ? (modelLinkOf(linkable)?.provider ?? null) : null;
  const providerLabel = importProviderInfo(provider)?.label ?? "";
  // Worked out here, not set by the effect: its update can land after a paint, or an Enter, with the old link's answer.
  const current = answer?.url === linkable ? answer : null;
  const loading = Boolean(linkable) && !current;
  const ready = current?.status === "ready" ? current.preview : null;
  const takenBy = ready?.linked_print ?? null;
  const canLink = Boolean(linkable) && !linking && !loading && !takenBy;

  useEffect(() => {
    setError(null);
    if (!linkable) return;
    let live = true;
    const timer = setTimeout(() => {
      importsApi.preview(linkable).then(
        (result) => live && setAnswer({ url: linkable, status: "ready", preview: result }),
        (err: unknown) => {
          if (!live) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setAnswer({ url: linkable, status: "failed", reason: err instanceof Error ? err.message : "" });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Only a new link asks the provider again: a read can count against its rate limits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkable]);

  const submit = async () => {
    if (!linkable || !canLink) return;
    setLinking(true);
    setError(null);
    try {
      const updated = await printsApi.linkSource(print.id, linkable);
      onLinked(updated);
      const category = updated.ai_suggestion?.provider ? updated.ai_suggestion.category_path : null;
      showToast({
        message: category
          ? t("models:linkSource.linkedWithSuggestion", { provider: providerLabel, category })
          : t("models:linkSource.linked", { provider: providerLabel }),
      });
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("models:linkSource.failed"));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open onClose={linking ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {t("models:linkSource.title")}
        <HelpTip text={t("models:linkSource.help")} />
        <Typography variant="body2" color="text.secondary" noWrap>
          {print.title || print.name}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <TextField
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          fullWidth
          size="small"
          margin="dense"
          label={t("models:linkSource.label")}
          placeholder={t("models:linkSource.placeholder") ?? undefined}
          value={link}
          disabled={linking}
          error={Boolean(problem)}
          helperText={problem ? t(`models:linkSource.problem.${problem}`) : undefined}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  {provider ? <ProviderLogo id={provider} size={20} /> : <LinkIcon fontSize="small" />}
                </InputAdornment>
              ),
            },
          }}
        />

        {loading && (
          <Paper variant="outlined" aria-hidden sx={previewBoxSx}>
            <Skeleton variant="rounded" width={COVER_WIDTH} height={COVER_HEIGHT} sx={{ flexShrink: 0 }} />
            <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="50%" />
            </Stack>
          </Paper>
        )}
        {ready && !takenBy && <PreviewCard preview={ready} providerLabel={providerLabel} />}
        {ready && !takenBy && ready.has_description && print.notes?.trim() && (
          <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.75 }}>
            {t("models:linkSource.replacesDescription")}
          </Typography>
        )}
        {takenBy && (
          <Alert
            severity="info"
            sx={{ mt: 1.5 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  onClose();
                  navigate(`/models/${takenBy.id}`);
                }}
              >
                {t("models:linkSource.openModel")}
              </Button>
            }
          >
            {t("models:linkSource.linkedElsewhere", { name: takenBy.name })}
          </Alert>
        )}
        {current?.status === "failed" && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t("models:linkSource.previewFailed", { reason: current.reason })}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={linking}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!canLink}
          startIcon={linking ? <CircularProgress size={14} /> : undefined}
        >
          {linking ? t("models:linkSource.linking") : t("models:linkSource.link")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreviewCard({ preview, providerLabel }: { preview: SourcePreview; providerLabel: string }) {
  const { t } = useTranslation(["models", "common"]);
  const [coverFailed, setCoverFailed] = useState(false);
  const openLabel = t("models:detail.openInProvider", { provider: providerLabel });
  return (
    <Paper variant="outlined" sx={previewBoxSx}>
      <Box
        sx={{
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: 1,
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {preview.cover_url && !coverFailed ? (
          <Box
            component="img"
            src={preview.cover_url}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ProviderLogo id={preview.provider} size={28} />
        )}
      </Box>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap title={preview.title ?? undefined}>
          {preview.title || providerLabel}
        </Typography>
        {preview.author_name && (
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
            <Avatar src={preview.author_avatar_url ?? undefined} sx={{ width: 18, height: 18, fontSize: 10 }}>
              {preview.author_name.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography variant="caption" color="text.secondary" noWrap>
              {preview.author_name}
            </Typography>
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">
          {t("models:linkSource.pictures", { count: preview.image_count })} ·{" "}
          {t("models:linkSource.tags", { count: preview.tag_count })}
        </Typography>
      </Stack>
      {preview.source_url && (
        <Tooltip title={openLabel}>
          <IconButton
            size="small"
            component="a"
            href={preview.source_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={openLabel}
            sx={{ alignSelf: "flex-start" }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Paper>
  );
}
