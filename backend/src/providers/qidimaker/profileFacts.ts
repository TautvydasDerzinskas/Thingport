import {
  compactFacts,
  filamentsOf,
  hexColor,
  percentText,
  plainText,
  plateName,
  positive,
  rounded,
  text,
  type ProfileFilament,
  type ProfilePlateFacts,
  type ProviderProfileFactsById,
} from "../../services/printProfileFacts";
import { asRecord, recordsOf } from "../../services/trendingModel";
import { fetchQidimakerDetail, fetchQidimakerProfileGroups, qidimakerId } from "./api";

// Its printers by the code a profile was exported for, with their maker, as the printer catalogue and QIDI Studio name
// them. A code it adds later is left to the profile's 3MF, which names its printer itself.
const PRINTERS: Record<string, string> = {
  QD_Q2: "QIDI Q2",
  QD_Q2C: "QIDI Q2C",
  QD_PLUS4: "QIDI X-Plus 4",
  QD_PLUS5: "QIDI X-Plus 5",
  QD_MAX4: "QIDI X-Max 4",
  S5: "QIDI X-Smart 5",
};

/** QIDI Maker gives times in hours, to a tenth. */
function hours(value: unknown): number | null {
  const n = positive(value);
  return n === null ? null : Math.round(n * 3600);
}

/** A plate's filaments, by the slot each one is in. */
function plateFilaments(plate: Record<string, unknown>): ProfileFilament[] {
  return filamentsOf(
    recordsOf(plate.slicePlateConsumableVOList).map((material) => ({
      type: text(material.plateConsumableType),
      color: hexColor(material.plateConsumableColor),
      grams: rounded(material.plateConsumableNumber, 2),
    })),
  );
}

/** The profile's filaments with their weights, added up from its plates by the slot each one is in. Without plates,
 *  the one filament type the profile names. */
function profileFilaments(config: Record<string, unknown>, plates: Record<string, unknown>[]): ProfileFilament[] {
  const bySlot = new Map<string, ProfileFilament>();
  for (const plate of plates) {
    for (const material of recordsOf(plate.slicePlateConsumableVOList)) {
      const type = text(material.plateConsumableType);
      const color = hexColor(material.plateConsumableColor);
      const slot = Number(material.filamentId);
      const key = Number.isInteger(slot) && slot >= 0 ? String(slot) : `${type}|${color}`;
      const grams = rounded(material.plateConsumableNumber, 2);
      const seen = bySlot.get(key);
      if (seen) seen.grams = rounded((seen.grams ?? 0) + (grams ?? 0), 2);
      else bySlot.set(key, { type, color, grams });
    }
  }
  if (bySlot.size) {
    const slots = [...bySlot.entries()].toSorted(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    return filamentsOf(slots.map(([, filament]) => filament));
  }
  return filamentsOf([{ type: text(config.modelConsumable), color: null, grams: rounded(config.modelMaterials, 2) }]);
}

/** Its plates, numbered from 1 as QIDI Studio and the 3MF number them; a plate it names only by that number has no
 *  name of its own. */
function platesOf(plates: Record<string, unknown>[]): ProfilePlateFacts[] {
  return plates.flatMap((plate, position) => {
    const shown = text(plate.plateName);
    const number = shown && /^\d+$/.test(shown) ? Number(shown) : null;
    return [
      {
        index: number && number > 0 ? number : position + 1,
        name: number === null ? plateName(shown) : null,
        seconds: hours(plate.plateTime),
        grams: rounded(plate.plateMaterials, 2),
        filaments: plateFilaments(plate),
      },
    ];
  });
}

/** Each print profile of a model, as its public list of them describes it, by its id. A profile is the designer's as
 *  the import has it: its maker is the model's. */
export function qidimakerProfileFactsFrom(groups: unknown, designerId: string | null): ProviderProfileFactsById {
  const out: ProviderProfileFactsById = {};
  for (const group of recordsOf(groups)) {
    const makerId = qidimakerId(group.userId);
    for (const config of recordsOf(group.sliceModelConfigurationVOS)) {
      const id = qidimakerId(config.id);
      if (!id) continue;
      const plates = recordsOf(config.slicePlates);
      out[id] = compactFacts({
        title: text(config.translatedModelConfigurationName) ?? text(config.modelConfigurationName),
        description: plainText(
          text(config.translatedModelConfigurationSummary) ?? text(config.modelConfigurationSummary),
        ),
        origin: makerId ? (makerId === designerId ? "designer" : "community") : null,
        creator: text(group.nickname) ?? text(group.uuidName),
        seconds: hours(config.modelTime),
        grams: rounded(config.modelMaterials, 2),
        filaments: profileFilaments(config, plates),
        plates: platesOf(plates),
        printer: PRINTERS[text(config.exportPrinter)?.toUpperCase() ?? ""] ?? null,
        nozzleMm: positive(config.modelThreadSpecification),
        layerMm: positive(config.layerHeight),
        infill: percentText(config.sparseInfillDensity),
        walls: positive(config.wallLoops),
      });
    }
  }
  return out;
}

export async function qidimakerProfileFacts(
  _userId: string,
  modelId: string,
): Promise<ProviderProfileFactsById | null> {
  const detail = await fetchQidimakerDetail(modelId);
  if (!detail) return null;
  const designerId = qidimakerId(detail.userId) ?? qidimakerId(asRecord(detail.sliceModelUserVO)?.userId);
  return qidimakerProfileFactsFrom(await fetchQidimakerProfileGroups(modelId), designerId);
}
