import {
  compactFacts,
  durationSeconds,
  filamentsOf,
  hexColor,
  percentText,
  plainText,
  plateName,
  positive,
  rounded,
  text,
  withMaker,
  type ProfileFilament,
  type ProviderProfileFactsById,
} from "../../services/printProfileFacts";
import { asRecord, recordsOf } from "../../services/trendingModel";
import { fetchMakerworldPublicDesign } from "./api";

// Its compatibility names the printer without its maker ("A1 mini"); slicers and the profile's 3MF say "Bambu Lab A1 mini".
const MAKER = "Bambu Lab";

function filaments(list: unknown): ProfileFilament[] {
  return filamentsOf(
    recordsOf(list).map((filament) => ({
      type: text(filament.type),
      color: hexColor(filament.color),
      grams: rounded(filament.usedG, 2),
    })),
  );
}

/** Each profile ("instance") of a design, as its design data describes it, by instance id. A profile is the
 *  designer's when its `instanceCreator` is the `designCreator`. */
export function makerworldProfileFactsFrom(design: Record<string, unknown>): ProviderProfileFactsById {
  const designerUid = text(asRecord(design.designCreator)?.uid);
  const out: ProviderProfileFactsById = {};
  for (const instance of recordsOf(design.instances)) {
    const id = text(instance.id);
    if (!id) continue;
    const creator = asRecord(instance.instanceCreator);
    const creatorUid = text(creator?.uid);
    const info = asRecord(asRecord(instance.extention)?.modelInfo);
    const compatibility = asRecord(info?.compatibility);
    const settings = asRecord(info?.projectSettings);
    out[id] = compactFacts({
      title: text(instance.title),
      description: plainText(instance.summary),
      origin: designerUid && creatorUid ? (creatorUid === designerUid ? "designer" : "community") : null,
      creator: text(creator?.name),
      seconds: durationSeconds(instance.prediction),
      grams: rounded(instance.weight, 2),
      filaments: filaments(instance.instanceFilaments),
      plates: recordsOf(info?.plates).flatMap((plate) => {
        const index = positive(plate.index);
        if (!index) return [];
        return [
          {
            index,
            name: plateName(plate.name),
            seconds: durationSeconds(plate.prediction),
            grams: rounded(plate.weight, 2),
            filaments: filaments(plate.filaments),
          },
        ];
      }),
      printer: withMaker(MAKER, compatibility?.devProductName),
      nozzleMm: positive(compatibility?.nozzleDiameter),
      layerMm: positive(settings?.layerHeight),
      infill: percentText(settings?.sparseInfillDensity),
      walls: positive(settings?.wallLoops),
    });
  }
  return out;
}

/** Read from the public design data, so no one's session is spent on it. */
export async function makerworldProfileFacts(
  _userId: string,
  designId: string,
): Promise<ProviderProfileFactsById | null> {
  const design = await fetchMakerworldPublicDesign(designId);
  return design ? makerworldProfileFactsFrom(design) : null;
}
