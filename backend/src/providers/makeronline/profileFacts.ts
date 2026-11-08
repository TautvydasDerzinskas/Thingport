import {
  compactFacts,
  durationSeconds,
  filamentsOf,
  firstPositive,
  hexColor,
  plainText,
  plateName,
  positive,
  rounded,
  text,
  type ProfileFilament,
  type ProviderProfileFactsById,
} from "../../services/printProfileFacts";
import { recordsOf } from "../../services/trendingModel";
import { fetchMakeronlineDetail } from "./api";

function filaments(list: unknown): ProfileFilament[] {
  return filamentsOf(
    recordsOf(list).map((material) => ({
      type: text(material.material_type),
      // "R,G,B".
      color: hexColor(material.paint_color),
      grams: rounded(material.filament_used_g, 2),
    })),
  );
}

/** What its filaments add up to: MakerOnline gives no total of its own. Unknown while any one's weight is. */
function totalGrams(list: ProfileFilament[]): number | null {
  if (!list.length || list.some((filament) => filament.grams == null)) return null;
  return rounded(
    list.reduce((sum, filament) => sum + (filament.grams ?? 0), 0),
    2,
  );
}

/** Each print profile of a model, as its details describe it, by profile id. A profile's plates are its `files` rows,
 *  one per plate, all of one 3MF. Its printers are a list of every one it suits, not the one it's set up for, so the
 *  printer is left to the profile's 3MF. */
export function makeronlineProfileFactsFrom(detail: Record<string, unknown>): ProviderProfileFactsById {
  const designerId = text(detail.user_id);
  const out: ProviderProfileFactsById = {};
  for (const profile of recordsOf(detail.print_profiles)) {
    const id = text(profile.id);
    if (!id) continue;
    const makerId = text(profile.user_id);
    const designer = profile.is_author === 1 || (!!designerId && makerId === designerId);
    const plates = recordsOf(profile.files);
    const profileFilaments = filaments(profile.materials_label);
    out[id] = compactFacts({
      title: text(profile.title),
      description: plainText(profile.desc),
      origin: designer ? "designer" : profile.is_author === 0 || makerId ? "community" : null,
      creator: text(profile.user_display_name),
      seconds: durationSeconds(profile.print_time_label),
      grams: totalGrams(profileFilaments),
      filaments: profileFilaments,
      plates: plates.flatMap((plate) => {
        const index = positive(plate.id);
        if (!index) return [];
        const plateFilaments = filaments(plate.materials);
        return [
          {
            index,
            name: plateName(plate.name),
            seconds: durationSeconds(plate.print_time),
            grams: totalGrams(plateFilaments),
            filaments: plateFilaments,
          },
        ];
      }),
      // Given as "0.4", 0.4 or "", on the profile or its plates.
      nozzleMm: firstPositive([profile.nozzle, ...plates.map((plate) => plate.nozzle)]),
      layerMm: firstPositive(plates.map((plate) => plate.layer)),
    });
  }
  return out;
}

export async function makeronlineProfileFacts(
  _userId: string,
  modelId: string,
): Promise<ProviderProfileFactsById | null> {
  const detail = await fetchMakeronlineDetail(modelId);
  return detail ? makeronlineProfileFactsFrom(detail) : null;
}
