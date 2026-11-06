import retro from "../assets/covers/retro.svg";
import pixel from "../assets/covers/pixel.svg";
import mosaic from "../assets/covers/mosaic.svg";
import ascii from "../assets/covers/ascii.svg";
import blueprint from "../assets/covers/blueprint.svg";

/** The covers Thingport draws, as the backend's COVER_PRESETS names them. */
export const COVER_PRESETS = ["retro", "pixel", "mosaic", "ascii", "blueprint"] as const;
export type CoverPreset = (typeof COVER_PRESETS)[number];

const PRESET_URLS: Record<CoverPreset, string> = { retro, pixel, mosaic, ascii, blueprint };

export const COVER_MAX_BYTES = 10 * 1024 * 1024;
export const BIO_MAX_LENGTH = 1000;
export const PROFILE_LINKS_MAX = 5;

/** A profile's cover as the API gives it. Optional: a user kept from before covers came has none of it yet. */
export type ProfileCoverValue = {
  background_url?: string | null;
  cover_preset?: CoverPreset | null;
  cover_position_y?: number;
};

export const presetCoverUrl = (preset: CoverPreset): string => PRESET_URLS[preset];

export function coverImageUrl(cover: ProfileCoverValue | null | undefined): string | null {
  if (cover?.background_url) return cover.background_url;
  return cover?.cover_preset && cover.cover_preset in PRESET_URLS ? PRESET_URLS[cover.cover_preset] : null;
}
