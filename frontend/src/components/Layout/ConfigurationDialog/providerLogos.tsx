// Glyphs from Simple Icons (CC0) where it has them, otherwise the marks from the sites themselves; each provider's
// manifest in providers/ says which, and why its colours are what they are.
import { MANIFESTS, PROVIDER_IDS, type Logo, type ProviderId } from "../../../providers/index.generated";

export type { ProviderId };

/** Sites shown as "Coming soon": listed, but nothing can be done with them yet. */
export const COMING_SOON_PROVIDERS: { id: ProviderId; name: string }[] = [];

const logo = (id: ProviderId): Logo => MANIFESTS[id].brand.logo;

/** Whether a provider name, such as a model's source, is one there's a logo for. */
export function hasProviderLogo(id: string | null | undefined): id is ProviderId {
  return !!id && Object.hasOwn(MANIFESTS, id);
}

/** A provider's logo as SVG markup, to show as an image; its black-and-white marks are drawn in black. */
export function providerLogoSvg(id: ProviderId): string {
  const { viewBox = "0 0 24 24", color, path, fillRule, layers } = logo(id);
  const fill = (value: string) => (value === "currentColor" ? "#000" : value);
  const paths = [
    `<path d="${path}" fill="${fill(color)}"${fillRule ? ` fill-rule="${fillRule}"` : ""}/>`,
    ...(layers ?? []).map((layer) => `<path d="${layer.d}" fill="${fill(layer.color)}"/>`),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths.join("")}</svg>`;
}

export const PROVIDER_LOGO_IDS: readonly ProviderId[] = PROVIDER_IDS;

export function ProviderLogo({ id, size }: { id: ProviderId; size: number }) {
  const { viewBox = "0 0 24 24", color, path, fillRule, layers } = logo(id);
  return (
    <svg width={size} height={size} viewBox={viewBox} aria-hidden="true" style={{ display: "block" }}>
      <path d={path} fill={color} fillRule={fillRule} />
      {layers?.map((layer) => (
        <path key={layer.d} d={layer.d} fill={layer.color} />
      ))}
    </svg>
  );
}
