import type { TFunction } from "i18next";
import {
  featureNumber,
  profileNumber,
  profileOf,
  type Feature,
  type StudioPlate,
  type StudioProfile,
} from "../../studio/document";

/** A feature as the page names it: its own name, else its type and number in the user's language, e.g. Box 3. */
export function featureLabel(feature: Feature, t: TFunction): string {
  // A mirror is a pattern of one kind, but reads as itself.
  const type = feature.type === "pattern" && feature.kind === "mirror" ? "mirror" : feature.type;
  return feature.name || `${t(`studio.types.${type}`)} ${featureNumber(feature.id)}`;
}

export function plateLabel(plate: StudioPlate, t: TFunction): string {
  return plate.default_name === undefined ? plate.name : t("studio.plates.defaultName", { count: plate.default_name });
}

export function profileLabel(profile: StudioProfile, t: TFunction): string {
  return profile.name ?? t("studio.profiles.defaultName", { number: profileNumber(profile) });
}

export function groupedPlateLabel(plate: StudioPlate, profiles: readonly StudioProfile[], t: TFunction): string {
  const profile = profiles.length > 1 && profiles.find((entry) => entry.id === profileOf(plate));
  return profile ? `${profileLabel(profile, t)} · ${plateLabel(plate, t)}` : plateLabel(plate, t);
}
