import { darken, getContrastRatio, lighten, type Theme } from "@mui/material/styles";
import { MANIFESTS, PROVIDER_IDS, type Need, type ProviderId, type SignIn } from "../providers/_generated";
import { IMPORT_PROVIDER_INFO } from "./importProviders";
import { THINGPORT_WEBSITE_URL } from "./website";

export type { Need, SignIn };

export type ProviderFacts = {
  site: string;
  /** The page under docs/providers/ on the website. */
  docs: string;
  signIn: SignIn;
  grab: Need;
  flaresolverr: Need;
  collections: boolean;
  likes: boolean;
  profiles: boolean;
  paid: boolean;
};

// Mirrors docs/PROVIDER_SETUP.md's table.
export const PROVIDER_FACTS = Object.fromEntries(
  PROVIDER_IDS.map((id) => {
    const { site, docsSlug, signIn, helpers, capabilities } = MANIFESTS[id];
    const facts: ProviderFacts = {
      site,
      docs: docsSlug,
      signIn,
      grab: helpers.grab,
      flaresolverr: helpers.flaresolverr,
      collections: capabilities.collections,
      likes: capabilities.likes,
      profiles: capabilities.profiles,
      paid: capabilities.paidModels,
    };
    return [id, facts];
  }),
) as Record<ProviderId, ProviderFacts>;

export const PROVIDER_ORDER: ProviderId[] = [...PROVIDER_IDS];

export const providerDocsUrl = (id: ProviderId) => `${THINGPORT_WEBSITE_URL}docs/providers/${PROVIDER_FACTS[id].docs}/`;

/** The provider's brand colour; the black-and-white marks take the text colour, so they show in both themes. */
export function providerAccent(id: ProviderId, theme: Theme): string {
  const { color } = IMPORT_PROVIDER_INFO[id];
  return color.startsWith("#") ? color : theme.palette.text.primary;
}

/** The accent as text or a thin mark on the paper: brand colours like Thangs' yellow on white, or Cults3D's purple on
 *  navy, are shifted until they read (WCAG's 3:1 for large text and icons). */
export function providerAccentText(id: ProviderId, theme: Theme): string {
  const paper = theme.palette.background.paper;
  const shift = theme.palette.mode === "dark" ? lighten : darken;
  let color = providerAccent(id, theme);
  for (let step = 0; step < 6 && getContrastRatio(color, paper) < 3.5; step++) color = shift(color, 0.15);
  return color;
}
