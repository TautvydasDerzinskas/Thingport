import { useMemo } from "react";
import markColor from "../../assets/logos/thingport-mark-color.svg?raw";
import iconColor from "../../assets/logos/thingport-icon-color.svg?raw";
import hourglass from "../../assets/icons/hourglass.svg?raw";
import weather from "../../assets/icons/weather.svg";
import markDark from "../../assets/logos/thingport-mark-dark.svg";
import iconDark from "../../assets/logos/thingport-icon-dark.svg";
import chrome from "../../assets/logos/browsers/chrome.svg";
import edge from "../../assets/logos/browsers/edge.svg";
import firefox from "../../assets/logos/browsers/firefox.svg";
import { useTintedSvg } from "../../hooks/useBrandLogo";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import { PROVIDER_LOGO_IDS, providerLogoSvg } from "../Layout/ConfigurationDialog/providerLogos";
import { AI_LOGOS, type AiLogoName } from "../../pages/AiPage/aiLogos";
import { SERVICE_ICONS, type ServiceGroup } from "./serviceIcons";

// Thingport's own icons are kept as `builtin:<group>/<name>` (see iconRef.ts) rather than their file's address, which
// changes with each build; they're looked up here when drawn, so they also keep up with the logos. Every service
// icon is `builtin:services/<name>`, whichever group it's shown in, so moving one between groups keeps it.

export type IconGroup = "thingport" | "providers" | ServiceGroup | "ai" | "browsers";
export const ICON_GROUPS: IconGroup[] = [
  "thingport",
  "providers",
  "printing",
  "selfhosted",
  "media",
  "popular",
  "ai",
  "browsers",
];
/** `keywords`: other names to find it by, such as "pihole" for Pi-hole. */
export type CatalogIcon = { value: string; name: string; group: IconGroup; src: string; keywords?: string };

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const AI_NAMES: Partial<Record<AiLogoName, string>> = {
  ai21: "AI21",
  deepseek: "DeepSeek",
  huggingface: "Hugging Face",
  ibm: "IBM",
  internlm: "InternLM",
  lg: "LG",
  llava: "LLaVA",
  lmstudio: "LM Studio",
  minimax: "MiniMax",
  nousresearch: "Nous Research",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  stepfun: "StepFun",
  tii: "TII",
  vllm: "vLLM",
  xai: "xAI",
  xiaomimimo: "Xiaomi MiMo",
};
const titleCase = (name: string) => name[0].toUpperCase() + name.slice(1);

// Everything but the accent-tinted marks, which depend on the theme.
const STATIC: CatalogIcon[] = [
  { value: "builtin:thingport/mark-dark", name: "Thingport", group: "thingport", src: markDark },
  { value: "builtin:thingport/icon-dark", name: "Thingport", group: "thingport", src: iconDark },
  {
    value: "builtin:thingport/weather",
    name: "Weather",
    group: "thingport",
    src: weather,
    keywords: "sun cloud forecast",
  },
  ...PROVIDER_LOGO_IDS.map((id): CatalogIcon => ({
    value: `builtin:providers/${id}`,
    name: IMPORT_PROVIDER_INFO[id]?.label ?? titleCase(id),
    group: "providers",
    src: svgUrl(providerLogoSvg(id)),
  })),
  ...(Object.entries(AI_LOGOS) as [AiLogoName, string][]).map(([id, src]): CatalogIcon => ({
    value: `builtin:ai/${id}`,
    name: AI_NAMES[id] ?? titleCase(id),
    group: "ai",
    src,
  })),
  ...SERVICE_ICONS.map(({ slug, name, group, keywords, src }): CatalogIcon => ({
    value: `builtin:services/${slug}`,
    name,
    group,
    src,
    keywords,
  })),
  { value: "builtin:browsers/chrome", name: "Chrome", group: "browsers", src: chrome },
  { value: "builtin:browsers/edge", name: "Edge", group: "browsers", src: edge },
  { value: "builtin:browsers/firefox", name: "Firefox", group: "browsers", src: firefox },
];

// Drawn in Thingport green, so they take the theme's accent.
const TINTED = [
  { value: "builtin:thingport/mark", name: "Thingport", group: "thingport", svg: markColor },
  { value: "builtin:thingport/icon", name: "Thingport", group: "thingport", svg: iconColor },
  {
    value: "builtin:thingport/hourglass",
    name: "Hourglass",
    group: "thingport",
    svg: hourglass,
    keywords: "countdown timer time",
  },
] as const;

/** Every built-in icon by its stored value and name, without the images: what the MCP `list_icons` tool offers. */
export const BUILTIN_ICONS: Omit<CatalogIcon, "src">[] = [...TINTED, ...STATIC].map(
  ({ value, name, group, ...rest }) => ({
    value,
    name,
    group,
    ...("keywords" in rest && rest.keywords && { keywords: rest.keywords }),
  }),
);

/** Thingport's own icons, the logo and app icon in the theme's accent first. */
export function useIconCatalog(): CatalogIcon[] {
  const mark = useTintedSvg(TINTED[0].svg)!;
  const icon = useTintedSvg(TINTED[1].svg)!;
  const glass = useTintedSvg(TINTED[2].svg)!;
  return useMemo(
    () => [
      { value: TINTED[0].value, name: TINTED[0].name, group: "thingport", src: mark },
      { value: TINTED[1].value, name: TINTED[1].name, group: "thingport", src: icon },
      { value: TINTED[2].value, name: TINTED[2].name, group: "thingport", src: glass, keywords: TINTED[2].keywords },
      ...STATIC,
    ],
    [mark, icon, glass],
  );
}

/** What to load for a stored icon: a built-in's image, else the address as it is; null for none, or a built-in that's
 *  gone. */
export function useIconSrc(value: string | undefined | null): string | null {
  const catalog = useIconCatalog();
  if (!value) return null;
  if (!value.startsWith("builtin:")) return value;
  return catalog.find((icon) => icon.value === value)?.src ?? null;
}
