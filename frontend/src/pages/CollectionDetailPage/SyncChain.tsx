import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import thingportIcon from "../../assets/logos/thingport-icon-color.svg";
import type { Collection } from "../../api/collections";
import { printsApi, type Print } from "../../api/prints";
import { importProviderInfo } from "../../constants/importProviders";
import { hasProviderLogo, ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import { collectionDisplayName } from "../../utils/collectionDisplay";

// One trip of the pulse: provider to Thingport in the first half, Thingport to the collection in
// the second, each node lighting up as it arrives.
const CYCLE = "2.8s";

// The pulse is 40% of its segment wide, so 250% starts it past the right end and -100% ends it
// past the left one.
const firstLeg = keyframes`
  0% { transform: translateX(250%); opacity: 1; }
  50% { transform: translateX(-100%); opacity: 1; }
  50.1%, 100% { transform: translateX(-100%); opacity: 0; }
`;
const secondLeg = keyframes`
  0%, 50% { transform: translateX(250%); opacity: 0; }
  50.1% { transform: translateX(250%); opacity: 1; }
  100% { transform: translateX(-100%); opacity: 1; }
`;
const glow = (peak: number) => keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(46, 160, 67, 0); }
  ${Math.max(0, peak - 8)}% { box-shadow: 0 0 0 0 rgba(46, 160, 67, 0); }
  ${peak}% { box-shadow: 0 0 0 6px rgba(46, 160, 67, 0.28); }
  ${Math.min(100, peak + 14)}% { box-shadow: 0 0 0 10px rgba(46, 160, 67, 0); }
`;

const reducedMotion = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };

const cardBackground = (theme: Theme) =>
  theme.palette.mode === "dark" ? theme.thingport.pageBackground : theme.palette.grey[100];

function coverUrl(print: Print): string | null {
  const rel = print.thumb_url || print.preview_images?.[0]?.url;
  return rel ? printsApi.fileUrl(rel) : null;
}

/** The collection's grid tile, in miniature. */
function MiniCollection({ collection }: { collection: Collection }) {
  const { t } = useTranslation(["models", "common"]);
  const covers = collection.cover_items.slice(0, 4).map((print) => ({ id: print.id, src: coverUrl(print) }));
  return (
    // Narrower on phones, so the chain still fits beside its two actions.
    <Box sx={{ position: "relative", width: { xs: 88, sm: 116 }, flexShrink: 0, pb: "6px" }}>
      {[
        { inset: 10, drop: 6, opacity: 0.55 },
        { inset: 5, drop: 3, opacity: 0.8 },
      ].map(({ inset, drop, opacity }) => (
        <Box
          key={drop}
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            left: inset,
            right: inset,
            bottom: 6 - drop,
            borderRadius: "8px",
            border: "1px solid",
            borderColor: "divider",
            bgcolor: cardBackground,
            opacity,
          }}
        />
      ))}
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "8px",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: cardBackground,
          animation: `${glow(96)} ${CYCLE} ease-out infinite`,
          ...reducedMotion,
        }}
      >
        <Box
          sx={{
            aspectRatio: "4 / 3",
            display: "grid",
            gridTemplateColumns: covers.length > 1 ? "1fr 1fr" : "1fr",
            gridTemplateRows: covers.length > 1 ? "1fr 1fr" : "1fr",
            gap: "1px",
            bgcolor: (theme) =>
              theme.palette.mode === "dark" ? theme.thingport.pageBackground : theme.palette.grey[200],
          }}
        >
          {covers.map(({ id, src }) =>
            src ? (
              <Box
                key={id}
                component="img"
                src={src}
                alt=""
                sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", minHeight: 0 }}
              />
            ) : (
              <Box key={id} />
            ),
          )}
        </Box>
        <Box sx={{ px: 0.75, py: 0.5 }}>
          <Typography
            variant="caption"
            component="div"
            fontWeight={600}
            noWrap
            sx={{ fontSize: "0.65rem", lineHeight: 1.3, color: (theme) => theme.thingport.headingText }}
          >
            {collectionDisplayName(collection, t)}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, color: "#858585" }}>
            <Inventory2OutlinedIcon sx={{ fontSize: 9 }} />
            <Typography variant="caption" sx={{ fontSize: "0.6rem", lineHeight: 1.3 }}>
              {t("models:collections.card.itemCount", { count: collection.item_count })}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const ACTION_SIZE = 32;

/** A stretch of the chain, with the pulse running along it from right to left, and optionally an
 *  action sitting on it in the middle. The action itself never pulses. */
function Segment({ leg, action }: { leg: "first" | "second"; action?: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: "relative",
        flex: 1,
        minWidth: ACTION_SIZE + 8,
        mx: { xs: 0.5, sm: 1 },
        display: "flex",
        alignItems: "center",
      }}
    >
      <Box aria-hidden sx={{ position: "relative", width: "100%", height: 2, bgcolor: "divider", overflow: "hidden" }}>
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "40%",
            height: "100%",
            background: (theme) =>
              `linear-gradient(90deg, transparent, ${theme.palette.success.main} 35%, ${theme.palette.success.light} 50%, transparent)`,
            animation: `${leg === "first" ? firstLeg : secondLeg} ${CYCLE} linear infinite`,
            // Without motion, the plain line is the chain.
            "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 0 },
          }}
        />
      </Box>
      {action && (
        <Box sx={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>{action}</Box>
      )}
    </Box>
  );
}

export type ChainAction = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Shown instead of `label` while it's disabled, e.g. how long until it's available. */
  disabledLabel?: string;
  /** 0-100: a ring around the button filling up until it's available again. */
  progress?: number | null;
  color?: "default" | "error";
};

/** A round button on the line. A disabled one keeps its tooltip through the span around it. */
function ActionButton({ action }: { action: ChainAction }) {
  const { label, icon, onClick, disabled, disabledLabel, progress, color = "default" } = action;
  return (
    <Tooltip title={disabled && disabledLabel ? disabledLabel : label}>
      <Box component="span" sx={{ position: "relative", display: "inline-flex" }}>
        <IconButton
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: ACTION_SIZE,
            height: ACTION_SIZE,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            color: color === "error" ? "error.main" : "text.secondary",
            "&:hover": {
              bgcolor: "background.paper",
              borderColor: color === "error" ? "error.main" : "success.main",
              color: color === "error" ? "error.main" : "success.main",
            },
            "&.Mui-disabled": { bgcolor: "background.paper" },
          }}
        >
          {icon}
        </IconButton>
        {progress != null && (
          <CircularProgress
            variant="determinate"
            value={progress}
            size={ACTION_SIZE}
            thickness={2.5}
            aria-hidden
            sx={{ position: "absolute", inset: 0, color: "success.main", pointerEvents: "none" }}
          />
        )}
      </Box>
    </Tooltip>
  );
}

const nodeSx = {
  position: "relative",
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  borderRadius: "50%",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "background.paper",
} as const;

// Circles are centred on the line, so labels measured from the line's height (half the biggest
// circle, plus a gap) line up whatever each circle's size.
const THINGPORT_NODE = 48;
const PROVIDER_NODE = 60;
const LABEL_FROM_CENTRE = PROVIDER_NODE / 2 + 6;

/** A node's name, under its circle without taking room, so the circle stays level with the line. */
function NodeLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        position: "absolute",
        top: `calc(50% + ${LABEL_FROM_CENTRE}px)`,
        left: "50%",
        transform: "translateX(-50%)",
        whiteSpace: "nowrap",
        fontWeight: 600,
        color: "text.secondary",
      }}
    >
      {children}
    </Typography>
  );
}

/** Collection, Thingport, provider: models flow from right to left. Sync now sits on the link to
 *  the collection, Stop syncing on the link to the provider. */
export default function SyncChain({
  collection,
  syncNow,
  stop,
}: {
  collection: Collection & { sync: NonNullable<Collection["sync"]> };
  syncNow: ChainAction;
  stop: ChainAction;
}) {
  const { provider } = collection.sync;
  const providerLabel = importProviderInfo(provider)?.label ?? provider;
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 2 }}>
      {/* The text above says the same in words; only the two actions are for screen readers. */}
      <Box aria-hidden sx={{ display: "flex" }}>
        <MiniCollection collection={collection} />
      </Box>
      <Segment leg="second" action={<ActionButton action={syncNow} />} />
      <Box
        aria-hidden
        sx={{
          ...nodeSx,
          width: THINGPORT_NODE,
          height: THINGPORT_NODE,
          animation: `${glow(50)} ${CYCLE} ease-out infinite`,
          ...reducedMotion,
        }}
      >
        <Box component="img" src={thingportIcon} alt="" sx={{ width: 26, height: 26 }} />
        <NodeLabel>Thingport</NodeLabel>
      </Box>
      <Segment leg="first" action={<ActionButton action={stop} />} />
      <Box
        aria-hidden
        sx={{
          ...nodeSx,
          width: PROVIDER_NODE,
          height: PROVIDER_NODE,
          animation: `${glow(4)} ${CYCLE} ease-out infinite`,
          ...reducedMotion,
        }}
      >
        {hasProviderLogo(provider) && <ProviderLogo id={provider} size={30} />}
        <NodeLabel>{providerLabel}</NodeLabel>
      </Box>
    </Box>
  );
}
