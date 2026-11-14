import {
  compactFacts,
  filamentsOf,
  hexColor,
  plainText,
  plateName,
  positive,
  rounded,
  text,
  withMaker,
  type ProfileFilament,
  type ProfilePlateFacts,
  type ProviderProfileFactsById,
} from "../../services/printProfileFacts";
import { asRecord, recordsOf } from "../../services/trendingModel";
import { fetchVoxelshareDetail, fetchVoxelshareProfiles, voxelshareId } from "./api";

/** Filaments as the site lists them, each with its colour and weight in grams. */
function filaments(list: unknown): ProfileFilament[] {
  return filamentsOf(
    recordsOf(list).map((filament) => ({
      type: text(filament.type),
      color: hexColor(filament.color),
      grams: rounded(filament.weight, 2),
    })),
  );
}

/** Its plates, numbered from 1 as Flashforge's slicers and the 3MF number them. */
function platesOf(plates: Record<string, unknown>[]): ProfilePlateFacts[] {
  return plates.map((plate, position) => {
    const number = positive(plate.plateNumber);
    const grams = recordsOf(plate.filaments).reduce((sum, filament) => sum + (positive(filament.weight) ?? 0), 0);
    return {
      index: number && Number.isInteger(number) ? number : position + 1,
      name: plateName(plate.name),
      seconds: rounded(plate.printDuration),
      grams: rounded(grams, 2),
      filaments: filaments(plate.filaments),
    };
  });
}

/** The printer a profile was made for, where it lists only one: with several, the one it was made on isn't said, and
 *  the profile's 3MF names it instead. */
function printerOf(config: Record<string, unknown>): string | null {
  const printers = (text(config.fullDeviceModels) ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return printers.length === 1 ? withMaker("Flashforge", printers[0]) : null;
}

/** Each print profile of a model, as its public list of them describes it, by its id. */
export function voxelshareProfileFactsFrom(items: unknown): ProviderProfileFactsById {
  const out: ProviderProfileFactsById = {};
  for (const config of recordsOf(items)) {
    const id = voxelshareId(config.id);
    if (!id) continue;
    out[id] = compactFacts({
      title: text(config.name),
      description: plainText(text(config.content)),
      origin: typeof config.modelCreator === "boolean" ? (config.modelCreator ? "designer" : "community") : null,
      creator: text(asRecord(config.creator)?.nickname),
      seconds: rounded(config.printDuration),
      grams: rounded(config.consumablesCount, 2),
      filaments: filaments(config.filaments),
      plates: platesOf(recordsOf(config.plateInfos)),
      printer: printerOf(config),
      nozzleMm: positive(recordsOf(config.nozzle)[0]?.size),
    });
  }
  return out;
}

/** Null for a model the site no longer has, whose list of profiles is as empty as a model's without any. */
export async function voxelshareProfileFacts(
  _userId: string,
  modelId: string,
): Promise<ProviderProfileFactsById | null> {
  const items = await fetchVoxelshareProfiles(modelId);
  if (!items.length && !(await fetchVoxelshareDetail(modelId))) return null;
  return voxelshareProfileFactsFrom(items);
}
