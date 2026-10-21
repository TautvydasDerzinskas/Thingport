import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NewReleasesOutlinedIcon from "@mui/icons-material/NewReleasesOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { releaseNotesApi, type ReleaseNoteItem, type ReleaseNoteKind, type ReleaseNotes } from "../../api/releaseNotes";
import { ListRowSkeletons } from "../ListSkeleton";

export type WhatsNewRequest = {
  /** This instance's version when null. */
  version: string | null;
  /** The version updated from, to cover every release since. */
  since: string | null;
};

const KINDS: ReleaseNoteKind[] = ["breaking", "feature", "improvement", "fix"];
const KIND_STYLE: Record<ReleaseNoteKind, { Icon: typeof BoltOutlinedIcon; color: (theme: Theme) => string }> = {
  breaking: { Icon: WarningAmberRoundedIcon, color: (theme) => theme.palette.error.main },
  feature: { Icon: AutoAwesomeOutlinedIcon, color: (theme) => theme.palette.primary.main },
  improvement: { Icon: BoltOutlinedIcon, color: (theme) => theme.palette.info.main },
  fix: { Icon: BuildOutlinedIcon, color: (theme) => theme.palette.success.main },
};
const SHOT_HEIGHT = 280;
// A long list of one-line fixes is cut short until asked for.
const FIXES_SHOWN = 6;

const fadeUp = keyframes`
  from { transform: translateY(6px); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
const enter = (index: number) => ({
  animation: `${fadeUp} 220ms ease-out both`,
  animationDelay: `${Math.min(index, 10) * 30}ms`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

function Screenshots({
  item,
  onZoom,
}: {
  item: ReleaseNoteItem;
  onZoom: (image: ReleaseNoteItem["images"][0]) => void;
}) {
  const { t } = useTranslation("app");
  if (!item.images.length) return null;
  return (
    <Box
      sx={{
        display: "grid",
        alignItems: "start",
        gap: 1,
        mt: 1,
        // One picture keeps to its own width, so a dialog cut-out isn't blown up to fill the row.
        gridTemplateColumns:
          item.images.length === 1 ? "minmax(0, max-content)" : "repeat(auto-fit, minmax(220px, 1fr))",
      }}
    >
      {item.images.map((image) => (
        <ButtonBase
          key={image.url}
          aria-label={image.caption ?? t("whatsNew.zoom")}
          onClick={() => onZoom(image)}
          sx={{
            display: "block",
            borderRadius: 1.5,
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
            textAlign: "left",
            "& img": { transition: "transform 200ms ease-out" },
            "&:hover img": { transform: "scale(1.02)" },
            "&:focus-visible": { outline: (theme) => `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
            "@media (prefers-reduced-motion: reduce)": { "&:hover img": { transform: "none" } },
          }}
        >
          <Box
            component="img"
            src={image.url}
            alt={image.caption ?? item.title}
            loading="lazy"
            sx={{
              display: "block",
              width: item.images.length === 1 ? "auto" : "100%",
              maxWidth: "100%",
              height: "auto",
              maxHeight: SHOT_HEIGHT,
              objectFit: "contain",
              bgcolor: "action.hover",
            }}
          />
          {image.caption && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, py: 0.5 }}>
              {image.caption}
            </Typography>
          )}
        </ButtonBase>
      ))}
    </Box>
  );
}

function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation("app");
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  return (
    <Box
      sx={{
        position: "relative",
        mt: 1,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
      }}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.25,
          pr: 5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {code}
      </Box>
      <Tooltip title={copied ? t("whatsNew.copied") : t("whatsNew.copy")}>
        <IconButton
          size="small"
          aria-label={t("whatsNew.copy")}
          onClick={copy}
          sx={{ position: "absolute", top: 4, right: 4 }}
        >
          {copied ? <CheckIcon sx={{ fontSize: 16 }} color="success" /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** A release's headline change, above the grouped list. */
function HighlightCard({
  item,
  index,
  onZoom,
}: {
  item: ReleaseNoteItem;
  index: number;
  onZoom: (image: ReleaseNoteItem["images"][0]) => void;
}) {
  const { t } = useTranslation("app");
  const { Icon, color } = KIND_STYLE[item.kind];
  return (
    <Box
      component="article"
      sx={(theme) => ({
        ...enter(index),
        p: 2,
        borderRadius: 2,
        border: `1px solid ${alpha(color(theme), 0.35)}`,
        background: `linear-gradient(150deg, ${alpha(color(theme), 0.12)} 0%, ${alpha(color(theme), 0.02)} 60%)`,
      })}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
        <Box
          sx={(theme) => ({
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: color(theme),
            bgcolor: alpha(color(theme), 0.14),
          })}
        >
          <Icon sx={{ fontSize: 13 }} />
          {t("whatsNew.highlight")}
        </Box>
      </Stack>
      <Typography
        variant="subtitle1"
        fontWeight={700}
        sx={{ lineHeight: 1.3, color: (muiTheme) => muiTheme.thingport.headingText }}
      >
        {item.title}
      </Typography>
      {item.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {item.description}
        </Typography>
      )}
      {item.code && <CodeBlock code={item.code} />}
      <Screenshots item={item} onZoom={onZoom} />
      {item.url && (
        <Link
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, mt: 1 }}
        >
          {t("whatsNew.learnMore")}
          <OpenInNewIcon sx={{ fontSize: 12 }} />
        </Link>
      )}
    </Box>
  );
}

function NoteRow({
  item,
  index,
  curated,
  onZoom,
}: {
  item: ReleaseNoteItem;
  index: number;
  curated: boolean;
  onZoom: (image: ReleaseNoteItem["images"][0]) => void;
}) {
  const { t } = useTranslation("app");
  const { color } = KIND_STYLE[item.kind];
  return (
    <Box
      component="li"
      sx={{
        ...enter(index),
        position: "relative",
        listStyle: "none",
        pl: 2,
        py: 0.5,
        "&::before": {
          content: '""',
          position: "absolute",
          left: 2,
          top: 13,
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: color,
        },
      }}
    >
      <Typography variant="body2" fontWeight={item.description || item.images.length ? 600 : 400}>
        {item.scope && (
          <Box component="span" sx={{ color: "text.secondary", fontWeight: 600, mr: 0.75 }}>
            {item.scope}
          </Box>
        )}
        {item.title}
      </Typography>
      {item.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {item.description}
        </Typography>
      )}
      {curated && item.url && (
        <Link
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, mt: 0.25 }}
        >
          {t("whatsNew.learnMore")}
          <OpenInNewIcon sx={{ fontSize: 12 }} />
        </Link>
      )}
      {item.code && <CodeBlock code={item.code} />}
      <Screenshots item={item} onZoom={onZoom} />
    </Box>
  );
}

function Section({
  kind,
  items,
  curated,
  offset,
  onZoom,
}: {
  kind: ReleaseNoteKind;
  items: ReleaseNoteItem[];
  curated: boolean;
  offset: number;
  onZoom: (image: ReleaseNoteItem["images"][0]) => void;
}) {
  const { t } = useTranslation("app");
  const [expanded, setExpanded] = React.useState(false);
  const { Icon, color } = KIND_STYLE[kind];
  const cut = kind === "fix" && !expanded && items.length > FIXES_SHOWN + 1;
  const shown = cut ? items.slice(0, FIXES_SHOWN) : items;
  return (
    <Box component="section" aria-labelledby={`whats-new-${kind}`}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Box
          sx={(theme) => ({
            width: 24,
            height: 24,
            borderRadius: "7px",
            display: "grid",
            placeItems: "center",
            color: color(theme),
            bgcolor: alpha(color(theme), 0.14),
          })}
        >
          <Icon sx={{ fontSize: 15 }} />
        </Box>
        <Typography id={`whats-new-${kind}`} variant="subtitle2" fontWeight={700}>
          {t(`whatsNew.kinds.${kind}`)}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {items.length}
        </Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, p: 0 }}>
        {shown.map((item, index) => (
          <NoteRow key={item.url ?? item.title} item={item} index={offset + index} curated={curated} onZoom={onZoom} />
        ))}
      </Box>
      {kind === "fix" && items.length > FIXES_SHOWN + 1 && (
        <Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ ml: 1, mt: 0.25 }}>
          {expanded ? t("whatsNew.showFewer") : t("whatsNew.showAll", { total: items.length })}
        </Button>
      )}
    </Box>
  );
}

type Props = {
  /** What to show, or null when closed. */
  request: WhatsNewRequest | null;
  onClose: () => void;
};

/** The changes in this version: the hand-written notes when there are some for it, otherwise its changelog. */
export default function WhatsNewDialog({ request, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const theme = useTheme();
  const [notes, setNotes] = React.useState<ReleaseNotes | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [zoomed, setZoomed] = React.useState<ReleaseNoteItem["images"][0] | null>(null);

  React.useEffect(() => {
    if (!request) return;
    let active = true;
    setNotes(null);
    setFailed(false);
    releaseNotesApi
      .get(request)
      .then((result) => active && setNotes(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [request]);

  const accent = theme.palette.primary.main;
  const loading = !notes && !failed;
  const empty = failed || (notes !== null && notes.items.length === 0);
  const highlights = notes?.items.filter((item) => item.highlight) ?? [];
  const sections = KINDS.map((kind) => ({
    kind,
    items: notes?.items.filter((item) => item.kind === kind && !item.highlight) ?? [],
  })).filter((section) => section.items.length > 0);
  const offsets = sections.map((_, index) =>
    sections
      .slice(0, index)
      .reduce((sum, section) => sum + Math.min(section.items.length, FIXES_SHOWN), highlights.length),
  );
  // Screenshots need the room; a plain list of changes reads better narrow.
  const wide = notes?.items.some((item) => item.images.length > 0) ?? false;
  const releasesUrl = notes?.releases_url ?? "https://github.com/TautvydasDerzinskas/Thingport/releases";

  return (
    <>
      <Dialog
        open={Boolean(request)}
        onClose={onClose}
        fullWidth
        maxWidth={wide ? "md" : "sm"}
        aria-labelledby="whats-new-title"
        slotProps={{ paper: { sx: { overflow: "hidden" } } }}
      >
        <Box
          sx={{
            position: "relative",
            flexShrink: 0,
            px: 3,
            pt: 2.5,
            pb: 2,
            background: `linear-gradient(160deg, ${alpha(accent, 0.2)} 0%, ${alpha(accent, 0.03)} 70%)`,
            borderBottom: `1px solid ${alpha(accent, 0.25)}`,
          }}
        >
          <IconButton
            aria-label={t("common:close")}
            onClick={onClose}
            size="small"
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ pr: 5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: "11px",
                display: "grid",
                placeItems: "center",
                color: "primary.contrastText",
                bgcolor: "primary.main",
                boxShadow: `0 2px 8px ${alpha(accent, 0.35)}`,
              }}
            >
              <NewReleasesOutlinedIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6, letterSpacing: "0.08em" }}>
                {notes ? t("whatsNew.versionLabel", { version: notes.version }) : t("whatsNew.label")}
              </Typography>
              <Typography
                id="whats-new-title"
                variant="h6"
                fontWeight={700}
                sx={{ lineHeight: 1.25, color: (muiTheme) => muiTheme.thingport.headingText }}
              >
                {notes?.title ?? t("whatsNew.label")}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Box sx={{ px: 3, pt: 2, pb: 2, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {loading && <ListRowSkeletons count={5} lead="circle" leadSize={24} twoLines />}
          {empty && (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 3, textAlign: "center", ...enter(0) }}>
              <Typography variant="body2" color="text.secondary">
                {failed || notes?.source === "none" ? t("whatsNew.unavailable") : t("whatsNew.empty")}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                href={releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              >
                {t("whatsNew.openGithub")}
              </Button>
            </Stack>
          )}
          {notes && !empty && (
            <Stack spacing={2}>
              {notes.summary && (
                <Typography variant="body2" color="text.secondary" sx={enter(0)}>
                  {notes.summary}
                </Typography>
              )}
              {highlights.map((item, index) => (
                <HighlightCard key={`${notes.version}-${item.title}`} item={item} index={index} onZoom={setZoomed} />
              ))}
              {sections.map((section, index) => (
                <Section
                  key={`${notes.version}-${section.kind}`}
                  kind={section.kind}
                  items={section.items}
                  curated={notes.source === "curated"}
                  offset={offsets[index]}
                  onZoom={setZoomed}
                />
              ))}
            </Stack>
          )}
        </Box>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: "divider", flexShrink: 0 }}
        >
          <Link
            href={releasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            underline="hover"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
          >
            {t("whatsNew.allReleases")}
            <OpenInNewIcon sx={{ fontSize: 14 }} />
          </Link>
          <Button variant="contained" onClick={onClose}>
            {t("whatsNew.gotIt")}
          </Button>
        </Stack>
      </Dialog>

      <Dialog
        open={Boolean(zoomed)}
        onClose={() => setZoomed(null)}
        maxWidth="lg"
        aria-label={zoomed?.caption ?? t("whatsNew.zoom")}
        slotProps={{ paper: { sx: { overflow: "hidden", position: "relative" } } }}
      >
        <IconButton
          aria-label={t("common:close")}
          onClick={() => setZoomed(null)}
          size="small"
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
            bgcolor: (muiTheme) => alpha(muiTheme.palette.background.paper, 0.8),
            "&:hover": { bgcolor: "background.paper" },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
        {zoomed && (
          <Box
            component="img"
            src={zoomed.url}
            alt={zoomed.caption ?? ""}
            sx={{ display: "block", maxWidth: "100%", maxHeight: "85vh", objectFit: "contain" }}
          />
        )}
        {zoomed?.caption && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            {zoomed.caption}
          </Typography>
        )}
      </Dialog>
    </>
  );
}
