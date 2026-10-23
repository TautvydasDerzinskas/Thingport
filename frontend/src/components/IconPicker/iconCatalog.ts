import { useMemo } from "react";
import markColor from "../../assets/logos/thingport-mark-color.svg?raw";
import iconColor from "../../assets/logos/thingport-icon-color.svg?raw";
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

/** Thingport's own icons, the logo and app icon in the theme's accent first. */
export function useIconCatalog(): CatalogIcon[] {
  const mark = useTintedSvg(markColor)!;
  const icon = useTintedSvg(iconColor)!;
  return useMemo(
    () => [
      { value: "builtin:thingport/mark", name: "Thingport", group: "thingport", src: mark },
      { value: "builtin:thingport/icon", name: "Thingport", group: "thingport", src: icon },
      ...STATIC,
    ],
    [mark, icon],
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
