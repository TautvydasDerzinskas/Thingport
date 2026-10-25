import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { alpha } from "@mui/material/styles";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import WhatshotOutlinedIcon from "@mui/icons-material/WhatshotOutlined";
import { UnauthorizedError } from "../../api/client";
import { dashboardApi, type TrendingModel, type TrendingProvider, type TrendingResult } from "../../api/dashboard";
import { printProviderInfo } from "../../constants/importProviders";
import ProviderBadge from "../../components/ProviderBadge";
import { MANIFESTS } from "../../providers/index.generated";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import { openConfiguration } from "../../utils/configurationEvents";
import DashboardCard, { DashboardCardBody, DashboardCardTitle } from "./DashboardCard";

export type TrendingView = "list" | "cards";

// The server keeps each list half an hour; holding it here too means switching back to a provider, a second trending
// panel or the panel mounting again shows it at once, and two asks at once share one request.
const KEEP_MS = 10 * 60 * 1000;
const kept = new Map<TrendingProvider, { at: number; result: Promise<TrendingResult> }>();

function loadTrending(provider: TrendingProvider): Promise<TrendingResult> {
  const hit = kept.get(provider);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.result;
  const result = dashboardApi.getTrending(provider);
  kept.set(provider, { at: Date.now(), result });
  // A failure isn't kept, so trying again asks afresh.
  result.catch(() => kept.delete(provider));
  return result;
}

type Props = {
  /** In the order the user arranged them; the first shows when the panel opens. */
  providers: TrendingProvider[];
  count: number;
  showMore: boolean;
  view: TrendingView;
  isAdmin: boolean;
  onUnauthorized?: () => void;
};

/** Each chosen provider's trending models, one provider at a time: its list is fetched when it's picked. A model and
 *  "Show more" open on the provider's own site. */
export default function TrendingCard({ providers, count, showMore, view, isAdmin, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [picked, setPicked] = useState<TrendingProvider | null>(null);
  const [results, setResults] = useState<Partial<Record<TrendingProvider, TrendingResult | "failed">>>({});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // A provider taken out in the settings falls back to the first left.
  const active = picked && providers.includes(picked) ? picked : providers[0];
  const result = active ? results[active] : undefined;

  useEffect(() => {
    if (!active || results[active]) return;
    let current = true;
    loadTrending(active)
      .then((value) => current && setResults((all) => ({ ...all, [active]: value })))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (current) setResults((all) => ({ ...all, [active]: "failed" }));
      });
    return () => {
      current = false;
    };
  }, [active, results, onUnauthorized]);

  if (!active)
    return (
      <DashboardCard sx={{ p: 2.5 }}>
        <Typography color="text.secondary">{t("dashboard.trending.none")}</Typography>
      </DashboardCard>
    );

  const name = printProviderInfo(active).label;
  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + providers.length) % providers.length;
    setPicked(providers[next]);
    tabs.current[next]?.focus();
  };

  let body: React.ReactNode;
  if (result === undefined)
    body =
      view === "list" ? (
        <ListRowSkeletons count={Math.min(count, 4)} twoLines />
      ) : (
        <CardGrid>
          {Array.from({ length: Math.min(count, 4) }, (_, index) => (
            <Box key={index}>
              <Skeleton variant="rounded" sx={{ width: "100%", height: "auto", aspectRatio: "1" }} />
              <Skeleton variant="text" sx={{ width: "80%" }} />
            </Box>
          ))}
        </CardGrid>
      );
  else if (result === "failed")
    body = (
      <Stack alignItems="flex-start" spacing={1} sx={{ py: 1 }}>
        <Typography color="text.secondary">{t("dashboard.trending.loadError", { name })}</Typography>
        <Button
          size="small"
          onClick={() =>
            setResults((all) => {
              const { [active]: _failed, ...rest } = all;
              return rest;
            })
          }
        >
          {t("dashboard.trending.retry")}
        </Button>
      </Stack>
    );
  else if (result.status === "needsSetup")
    body = <SetupNeeded provider={active} setup={result.setup} name={name} isAdmin={isAdmin} />;
  else if (!result.models.length)
    body = (
      <Typography color="text.secondary" sx={{ py: 1 }}>
        {t("dashboard.trending.empty", { name })}
      </Typography>
    );
  else {
    const models = result.models.slice(0, count);
    body =
      view === "list" ? (
        <List dense disablePadding>
          {models.map((model) => (
            <ModelRow key={model.id} model={model} />
          ))}
        </List>
      ) : (
        <CardGrid>
          {models.map((model) => (
            <ModelTile key={model.id} model={model} />
          ))}
        </CardGrid>
      );
  }

  return (
    <DashboardCard scroll={false} sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
      <DashboardCardTitle icon={<WhatshotOutlinedIcon />} title={t("dashboard.trending.title")} sx={{ flexShrink: 0 }}>
        <Box
          role="tablist"
          aria-label={t("dashboard.trending.title")}
          // On the title's right; with many providers it scrolls rather than squeezing the title out.
          sx={{ display: "flex", gap: 0.5, overflowX: "auto", minWidth: 0, flexShrink: 1, ml: "auto", p: 0.25 }}
        >
          {providers.map((provider, index) => {
            const selected = provider === active;
            const label = printProviderInfo(provider).label;
            return (
              <Tooltip key={provider} title={label}>
                <ButtonBase
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  role="tab"
                  aria-selected={selected}
                  aria-label={label}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPicked(provider)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  sx={(theme) => ({
                    flexShrink: 0,
                    borderRadius: "50%",
                    p: "3px",
                    outline: `2px solid ${selected ? theme.palette.primary.main : "transparent"}`,
                    opacity: selected ? 1 : 0.6,
                    transition: "opacity 150ms ease, outline-color 150ms ease",
                    "&:hover": { opacity: 1 },
                    "&.Mui-focusVisible": { outlineColor: alpha(theme.palette.primary.main, 0.6) },
                  })}
                >
                  <ProviderBadge provider={provider} size={24} interactive={false} sx={{ boxShadow: "none" }} />
                </ButtonBase>
              </Tooltip>
            );
          })}
        </Box>
      </DashboardCardTitle>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, px: 0.25 }} noWrap>
        {result && result !== "failed" && result.status === "ok"
          ? t(`dashboard.trending.kind.${result.kind}`, { name })
          : name}
      </Typography>
      <DashboardCardBody>{body}</DashboardCardBody>
      {showMore && result && result !== "failed" && result.status === "ok" && result.models.length > 0 && (
        <Button
          component="a"
          href={result.moreUrl}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ alignSelf: "flex-start", flexShrink: 0 }}
        >
          {t("dashboard.trending.more", { name })}
        </Button>
      )}
    </DashboardCard>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.25 }}>
      {children}
    </Box>
  );
}

function Likes({ count }: { count: number }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
      <FavoriteBorderIcon sx={{ fontSize: 13 }} />
      {count.toLocaleString()}
    </Box>
  );
}

function PaidTag() {
  const { t } = useTranslation("app");
  return (
    <Box
      component="span"
      sx={{
        px: 0.5,
        borderRadius: 0.5,
        fontSize: "0.65rem",
        fontWeight: 700,
        bgcolor: "warning.main",
        color: "warning.contrastText",
        lineHeight: 1.5,
      }}
    >
      {t("dashboard.trending.paid")}
    </Box>
  );
}

function ModelRow({ model }: { model: TrendingModel }) {
  return (
    <ListItemButton
      component="a"
      href={model.url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ borderRadius: 1, px: 1, gap: 1.5 }}
    >
      <Avatar
        src={model.image ?? undefined}
        variant="rounded"
        alt=""
        sx={{ width: 40, height: 40, bgcolor: "action.hover" }}
      >
        <ViewInArIcon fontSize="small" sx={{ color: "text.disabled" }} />
      </Avatar>
      <ListItemText
        primary={model.title}
        primaryTypographyProps={{ noWrap: true, title: model.title }}
        secondary={
          <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            {model.author && (
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {model.author}
              </Box>
            )}
            {model.likes !== null && <Likes count={model.likes} />}
            {model.paid && <PaidTag />}
          </Box>
        }
        secondaryTypographyProps={{ component: "span" }}
      />
    </ListItemButton>
  );
}

function ModelTile({ model }: { model: TrendingModel }) {
  return (
    <ButtonBase
      component="a"
      href={model.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={model.title}
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        height: "100%",
        textAlign: "left",
        borderRadius: 1.5,
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        transition: "transform 150ms ease, box-shadow 150ms ease",
        "&:hover": { transform: "translateY(-2px)", boxShadow: theme.shadows[3] },
        "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "&:hover": { transform: "none" } },
      })}
    >
      {/* A square whatever the picture's own shape: out of the flow, an image can't stretch the box it's in. */}
      <Box sx={{ position: "relative", aspectRatio: "1", overflow: "hidden", bgcolor: "action.hover", flexShrink: 0 }}>
        {model.image ? (
          <Box
            component="img"
            src={model.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ViewInArIcon sx={{ position: "absolute", inset: 0, m: "auto", color: "text.disabled" }} />
        )}
        {model.paid && (
          <Box sx={{ position: "absolute", top: 6, left: 6 }}>
            <PaidTag />
          </Box>
        )}
      </Box>
      <Box sx={{ p: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.3,
            // Two lines kept for every title, so a short one doesn't make its card shorter than its row.
            minHeight: "2.6em",
          }}
        >
          {model.title}
        </Typography>
        {model.likes !== null && (
          <Typography variant="caption" color="text.secondary" component="div">
            <Likes count={model.likes} />
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}

/** A provider that needs a token or key before it can be read: what's missing, and where to add it. */
function SetupNeeded({
  provider,
  setup,
  name,
  isAdmin,
}: {
  provider: TrendingProvider;
  setup: string;
  name: string;
  isAdmin: boolean;
}) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  // A provider with an instance-wide token or key is read with it, an admin's to add; the others with the user's own.
  const forAdmin = MANIFESTS[provider].auth.some((auth) => auth.scope === "instance");
  return (
    <Stack alignItems="center" spacing={1.25} sx={{ py: 2, px: 1, textAlign: "center" }}>
      <Box
        sx={(theme) => ({
          width: 44,
          height: 44,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: alpha(theme.palette.warning.main, 0.15),
          color: "warning.main",
        })}
      >
        <KeyOutlinedIcon />
      </Box>
      <Typography variant="body2" fontWeight={600}>
        {t("dashboard.trending.setupTitle", { name })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t(`dashboard.trending.setup.${setup}`)}
      </Typography>
      {forAdmin ? (
        isAdmin ? (
          <Button variant="outlined" size="small" onClick={() => navigate("/admin-providers")}>
            {t("dashboard.trending.openProviders")}
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t("dashboard.trending.askAdmin")}
          </Typography>
        )
      ) : (
        <Button variant="outlined" size="small" onClick={() => openConfiguration("providers")}>
          {t("dashboard.trending.connect", { name })}
        </Button>
      )}
    </Stack>
  );
}
