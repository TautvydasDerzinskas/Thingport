import { type ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PersonIcon from "@mui/icons-material/Person";
import { authorsApi, type Author } from "../api/authors";
import type { AuthUser } from "../api/auth";
import { type Print, printsApi } from "../api/prints";
import { printProviderInfo } from "../constants/importProviders";
import { SELF_AUTHOR_ID } from "../constants/selfAuthor";
import { useGravatarUrl } from "../hooks/useGravatarUrl";

const PREVIEW_MODEL_COUNT = 3;
// The card's width follows from its one-row model grid: PREVIEW_MODEL_COUNT squares of
// MODEL_SQUARE_PX, the 6px gaps between them (gap: 0.75 below), and 12px side padding (p: 1.5).
const MODEL_SQUARE_PX = 70;
const CARD_WIDTH = PREVIEW_MODEL_COUNT * MODEL_SQUARE_PX + (PREVIEW_MODEL_COUNT - 1) * 6 + 2 * 12;
const COVER_HEIGHT = 120;
// Long enough that sweeping the pointer across a grid of cards doesn't pop cards open, short
// enough to feel like a response to deliberately resting on an author.
const ENTER_DELAY_MS = 450;
// Short grace period so the pointer can travel from the link onto the card itself.
const LEAVE_DELAY_MS = 150;
// Re-hovering the same author within this window reuses the last load (counts stay near-live
// without a request on every hover).
const CACHE_TTL_MS = 60_000;

type AuthorPreview = {
  author: Author | null; // null for the viewer's own uploads (SELF_AUTHOR_ID) -- no Author row
  models: Print[];
  total: number;
};

const previewCache = new Map<string, { at: number; promise: Promise<AuthorPreview> }>();

function loadAuthorPreview(authorId: string): Promise<AuthorPreview> {
  const cached = previewCache.get(authorId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = Promise.all([
    authorId === SELF_AUTHOR_ID ? Promise.resolve(null) : authorsApi.get(authorId),
    printsApi.list({ author_id: authorId, order_by: "newest", limit: PREVIEW_MODEL_COUNT, offset: 0 }),
  ]).then(([author, list]) => ({ author, models: list.items, total: list.total ?? list.items.length }));
  // A failed load must not stick in the cache -- the next hover should just try again.
  promise.catch(() => previewCache.delete(authorId));
  previewCache.set(authorId, { at: Date.now(), promise });
  return promise;
}

function modelThumbUrl(print: Print): string | null {
  const url = print.thumb_url || print.preview_images[0]?.url;
  return url ? printsApi.fileUrl(url) : null;
}

type CardProps = {
  authorId: string;
  viewer?: AuthUser | null;
};

function AuthorPreviewCard({ authorId, viewer }: CardProps) {
  const { t } = useTranslation(["models"]);
  const navigate = useNavigate();
  const isSelf = authorId === SELF_AUTHOR_ID;
  const viewerAvatarUrl = useGravatarUrl(isSelf ? viewer?.email : undefined, 88);
  const [preview, setPreview] = useState<AuthorPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAuthorPreview(authorId).then(
      result => { if (!cancelled) setPreview(result); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [authorId]);

  const author = preview?.author ?? null;
  const providerInfo = author ? printProviderInfo(author.provider) : null;
  const name = isSelf ? viewer?.display_name : author?.name || author?.handle;
  const handle = isSelf ? null : author?.handle;
  const avatarUrl = isSelf ? viewerAvatarUrl : author?.avatar_url ?? undefined;
  const coverUrl = isSelf ? viewer?.background_url : author?.background_url;
  const loading = !preview && !failed;

  const countLabel = preview
    ? isSelf
      ? t("models:author.popup.selfModelCount", { count: preview.total })
      : t("models:author.popup.modelCount", { count: preview.total, provider: providerInfo!.label })
    : null;

  return (
    // Portal-rendered, but React still bubbles its clicks through the component tree -- stop
    // them here so clicking inside the card doesn't also trigger the link/card it's anchored to
    // (e.g. a model grid card's own navigate-to-model onClick).
    <Box onClick={e => e.stopPropagation()} sx={{ width: CARD_WIDTH }}>
      <Box
        sx={{
          position: "relative",
          height: COVER_HEIGHT,
          bgcolor: providerInfo?.color ?? "primary.main",
          backgroundImage: coverUrl
            ? `url("${coverUrl}")`
            : "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(0,0,0,0.25))",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <ButtonBase
          onClick={() => navigate(`/authors/${authorId}`)}
          sx={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 12,
            justifyContent: "flex-start",
            gap: 1.25,
            p: 1,
            borderRadius: 2,
            textAlign: "left",
            bgcolor: "background.paper",
            boxShadow: 2,
            "&:hover .author-popup-name": { color: "primary.main" },
          }}
        >
          <Avatar src={avatarUrl || undefined} sx={{ width: 44, height: 44, flexShrink: 0 }}>
            <PersonIcon />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            {loading ? (
              <>
                <Skeleton width={140} />
                <Skeleton width={90} />
              </>
            ) : (
              <>
                <Typography
                  className="author-popup-name"
                  variant="subtitle2"
                  fontWeight={700}
                  noWrap
                  sx={{ color: theme => theme.thingport.headingText, transition: "color .15s ease" }}
                >
                  {name || t("models:card.unknownAuthor")}
                </Typography>
                {handle && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                    @{handle}
                  </Typography>
                )}
              </>
            )}
          </Box>
        </ButtonBase>
      </Box>

      <Box sx={{ p: 1.5 }}>
        {failed ? (
          <Typography variant="body2" color="text.secondary">{t("models:author.popup.loadFailed")}</Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              {countLabel ?? <Skeleton width={180} />}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${PREVIEW_MODEL_COUNT}, 1fr)`, gap: 0.75 }}>
              {loading
                ? Array.from({ length: PREVIEW_MODEL_COUNT }, (_, idx) => (
                    <Skeleton key={idx} variant="rounded" sx={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} />
                  ))
                : preview!.models.map(model => {
                    const thumb = modelThumbUrl(model);
                    return (
                      <Tooltip key={model.id} title={model.title || model.name} disableInteractive>
                        <ButtonBase
                          onClick={() => navigate(`/models/${model.id}`)}
                          sx={{
                            aspectRatio: "1 / 1",
                            borderRadius: 1.5,
                            overflow: "hidden",
                            bgcolor: "action.hover",
                            transition: "transform .15s ease, box-shadow .15s ease",
                            "&:hover": { transform: "translateY(-1px)", boxShadow: 3 },
                          }}
                        >
                          {thumb && (
                            <Box
                              component="img"
                              src={thumb}
                              alt={model.title || model.name}
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          )}
                        </ButtonBase>
                      </Tooltip>
                    );
                  })}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

type Props = CardProps & {
  /** The author link (name and/or avatar) the card anchors to -- must be able to hold a ref. */
  children: ReactElement;
  /** Skip the card entirely, e.g. for an "Unknown" author with nothing to preview. */
  disabled?: boolean;
};

/** Wraps an author link so resting the pointer on it (or focusing it) opens a preview card: the
 *  author's cover, avatar/name/@handle, how many of their models are in this library, and their
 *  latest few. `authorId` may be SELF_AUTHOR_ID for the viewer's own uploads (pass `viewer`).
 *  Nothing is fetched until the card actually opens. */
export default function AuthorHoverCard({ authorId, viewer, children, disabled }: Props) {
  if (disabled) return children;
  return (
    <Tooltip
      title={<AuthorPreviewCard authorId={authorId} viewer={viewer} />}
      enterDelay={ENTER_DELAY_MS}
      enterNextDelay={ENTER_DELAY_MS}
      leaveDelay={LEAVE_DELAY_MS}
      placement="bottom-start"
      slotProps={{
        tooltip: {
          sx: {
            p: 0,
            maxWidth: "none",
            overflow: "hidden",
            borderRadius: 3,
            bgcolor: "background.paper",
            color: "text.primary",
            boxShadow: 8,
            border: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      {children}
    </Tooltip>
  );
}
