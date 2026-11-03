import type { TFunction } from "i18next";
import { featureNumber, type Feature } from "../../studio/document";

/** A feature as the page names it: its own name, else its type and number in the user's language, e.g. Box 3. */
export function featureLabel(feature: Feature, t: TFunction): string {
  return feature.name || `${t(`studio.types.${feature.type}`)} ${featureNumber(feature.id)}`;
}
