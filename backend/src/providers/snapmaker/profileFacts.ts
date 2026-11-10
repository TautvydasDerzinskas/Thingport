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
import { fetchSnapmakerDetail } from "./api";

function filaments(list: unknown): ProfileFilament[] {
  return filamentsOf(
    recordsOf(list).map((filament) => ({
      type: text(filament.type),
      color: hexColor(filament.color),
      grams: rounded(filament.used_g, 2),
    })),
  );
}

/** Each print profile of a model, as its public details describe it, by profile id. Its title and description are
 *  read as the import reads them, the translation first. Snapmaker names no printer or settings outside the title:
 *  the profile's 3MF has them. */
export function snapmakerProfileFactsFrom(detail: Record<string, unknown>): ProviderProfileFactsById {
  const designerId = text(detail.creatorId);
  const out: ProviderProfileFactsById = {};
  for (const profile of recordsOf(detail.printProfiles)) {
    const id = text(profile.id);
    if (!id) continue;
    const creatorId = text(profile.creatorId);
    out[id] = compactFacts({
      title: text(profile.translatedTitle) ?? text(profile.title),
      description: plainText(profile.translatedDescription) ?? plainText(profile.description),
      origin: designerId && creatorId ? (creatorId === designerId ? "designer" : "community") : null,
      creator: text(profile.creatorName),
      seconds: durationSeconds(profile.secs),
      grams: rounded(profile.weight, 2),
      filaments: filaments(profile.filaments),
      plates: recordsOf(profile.partitions).flatMap((partition) => {
        const index = positive(partition.id);
        if (!index) return [];
        return [
          {
            index,
            name: plateName(partition.name),
            seconds: durationSeconds(partition.secs),
            grams: rounded(partition.weight, 2),
            filaments: filaments(partition.filaments),
          },
        ];
      }),
      // One per toolhead, all alike on the printers it lists.
      nozzleMm: firstPositive(profile.nozzle),
    });
  }
  return out;
}

export async function snapmakerProfileFacts(
  _userId: string,
  modelId: string,
): Promise<ProviderProfileFactsById | null> {
  const detail = await fetchSnapmakerDetail(modelId);
  return detail ? snapmakerProfileFactsFrom(detail) : null;
}
