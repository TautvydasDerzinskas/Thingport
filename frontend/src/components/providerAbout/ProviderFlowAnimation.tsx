import type { ReactNode } from "react";
import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { useBrandMark } from "../../hooks/useBrandLogo";
import { type Need, PROVIDER_FACTS } from "../../constants/providerFacts";
import { ProviderLogo, type ProviderId } from "../Layout/ConfigurationDialog/providerLogos";

// Models leaving the provider, passing whatever it leans on (FlareSolverr, Thingport Grab), and landing in
// Thingport: the provider's import path, drawn in its own colour. Optional helpers are dashed and faint; ones
// it doesn't use aren't drawn.
const NODE = 52;
const MODELS = 3;
const CYCLE_S = 2.6;
const START_S = 0.4;
// A model reaches Thingport every PERIOD_S; its tile bumps (92% into `land`) as each one arrives.
const PERIOD_S = CYCLE_S / MODELS;

const popIn = keyframes`
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
`;
const ripple = keyframes`
  from { transform: scale(1); opacity: 0.55; }
  to { transform: scale(1.7); opacity: 0; }
`;
const travel = keyframes`
  0% { transform: translateX(0); opacity: 0; }
  10%, 88% { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
`;
const land = keyframes`
  0%, 84%, 100% { transform: scale(1); }
  92% { transform: scale(1.08); }
`;

type Node = { key: string; label: string; need?: Need; icon: ReactNode };

type Props = {
  id: ProviderId;
  name: string;
  accent: string;
  /** The accent where it's text: some brand colours don't read on the paper. */
  textAccent: string;
};

export default function ProviderFlowAnimation({ id, name, accent, textAccent }: Props) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const markSrc = useBrandMark();
  const facts = PROVIDER_FACTS[id];
  const helperIcon = { fontSize: 26, color: "text.secondary" } as const;
  const nodes: Node[] = [
    { key: "provider", label: name, icon: <ProviderLogo id={id} size={30} /> },
    ...(facts.flaresolverr !== "none"
      ? [
          {
            key: "flaresolverr",
            label: "FlareSolverr",
            need: facts.flaresolverr,
            icon: <ShieldOutlinedIcon sx={helperIcon} />,
          },
        ]
      : []),
    ...(facts.grab !== "none"
      ? [
          {
            key: "grab",
            label: "Thingport Grab",
            need: facts.grab,
            icon: <ExtensionOutlinedIcon sx={helperIcon} />,
          },
        ]
      : []),
    {
      key: "thingport",
      label: "Thingport",
      icon: <Box component="img" src={markSrc} alt="" sx={{ width: 30, height: 30, display: "block" }} />,
    },
  ];

  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        maxWidth: 440,
        mx: "auto",
        "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } },
      }}
    >
      {/* The path, from the first node's middle to the last's, with models running along it. */}
      <Box
        sx={{
          position: "absolute",
          left: NODE / 2,
          right: NODE / 2,
          top: NODE / 2 - 1,
          height: 2,
          backgroundImage: `linear-gradient(90deg, ${alpha(accent, 0.45)} 50%, transparent 50%)`,
          backgroundSize: "8px 2px",
        }}
      >
        {Array.from({ length: MODELS }, (_, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              animation: `${travel} ${CYCLE_S}s linear ${START_S + i * PERIOD_S}s infinite`,
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: -5,
                top: -4,
                width: 10,
                height: 10,
                borderRadius: "3px",
                bgcolor: accent,
                boxShadow: `0 0 8px ${alpha(accent, 0.6)}`,
                transform: "rotate(45deg)",
              }}
            />
          </Box>
        ))}
      </Box>

      {nodes.map((node, index) => {
        const faint = node.need === "optional";
        const isProvider = node.key === "provider";
        const isThingport = node.key === "thingport";
        return (
          <Box
            key={node.key}
            sx={{
              position: "relative",
              zIndex: 1,
              width: 84,
              mx: "-16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.75,
              animation: `${popIn} 260ms cubic-bezier(.2,.9,.3,1.3) ${index * 90}ms both`,
            }}
          >
            <Box sx={{ position: "relative", width: NODE, height: NODE }}>
              {isProvider && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "14px",
                    border: `2px solid ${accent}`,
                    animation: `${ripple} ${PERIOD_S}s ease-out infinite`,
                  }}
                />
              )}
              <Box
                sx={{
                  position: "relative",
                  width: NODE,
                  height: NODE,
                  borderRadius: "14px",
                  display: "grid",
                  placeItems: "center",
                  // The logos are drawn for a white tile, as in Configuration.
                  bgcolor: isProvider ? "#ffffff" : "background.paper",
                  border: faint ? `1.5px dashed ${theme.palette.divider}` : `1.5px solid ${alpha(accent, 0.5)}`,
                  opacity: faint ? 0.7 : 1,
                  boxShadow: faint ? "none" : `0 4px 14px ${alpha(accent, 0.25)}`,
                  animation: isThingport
                    ? `${land} ${PERIOD_S}s ease-in-out ${START_S - PERIOD_S * 0.92}s infinite`
                    : "none",
                }}
              >
                {node.icon}
              </Box>
            </Box>
            <Typography
              variant="caption"
              sx={{ fontSize: "0.68rem", fontWeight: 600, lineHeight: 1.2, textAlign: "center" }}
            >
              {node.label}
            </Typography>
            {node.need && (
              <Typography
                variant="caption"
                sx={{
                  mt: -0.5,
                  fontSize: "0.62rem",
                  lineHeight: 1.2,
                  color: node.need === "optional" ? "text.secondary" : textAccent,
                  fontWeight: node.need === "required" ? 700 : 500,
                }}
              >
                {t(`providerAbout.need.${node.need}`)}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
