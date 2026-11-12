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
import { fetchNexprintDetail } from "./api";

/** NexPrint gives times in minutes. */
function minutes(value: unknown): number | null {
  const n = positive(value);
  return n === null ? null : Math.round(n * 60);
}

/** A profile's id ("G", or "C" on some models, and digits), as the import tags its plate with it. */
function profileId(value: unknown): string | null {
  const id = text(value)?.toUpperCase();
  return id && /^[GC]\d+$/.test(id) ? id : null;
}

function plateFilaments(plate: Record<string, unknown>): ProfileFilament[] {
  return filamentsOf(
    recordsOf(plate.materialList).map((material) => ({
      type: text(material.materialName),
      color: hexColor(material.materialColor),
      grams: rounded(material.materialWeight, 2),
    })),
  );
}

/** The profile's filaments with their weights, added up from its plates by the filament each one uses; the profile's
 *  own material list has no weights. Without plates, that list. */
function profileFilaments(
  setting: Record<string, unknown>,
  params: Record<string, unknown> | null,
  plates: Record<string, unknown>[],
): ProfileFilament[] {
  const types = Array.isArray(setting.filamentType) ? setting.filamentType : [];
  const colours = Array.isArray(setting.filamentColour) ? setting.filamentColour : [];
  const bySlot = new Map<number | string, ProfileFilament>();
  for (const plate of plates) {
    for (const material of recordsOf(plate.materialList)) {
      const slot = Number(material.filamentColourIndex);
      const known = Number.isInteger(slot) && slot >= 0;
      const type = (known ? text(types[slot]) : null) ?? text(material.materialName);
      const color = (known ? hexColor(colours[slot]) : null) ?? hexColor(material.materialColor);
      const key = known ? slot : `${type}|${color}`;
      const grams = rounded(material.materialWeight, 2);
      const seen = bySlot.get(key);
      if (seen) seen.grams = rounded((seen.grams ?? 0) + (grams ?? 0), 2);
      else bySlot.set(key, { type, color, grams });
    }
  }
  if (bySlot.size) {
    const slots = [...bySlot.entries()].toSorted(([a], [b]) =>
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
    );
    return filamentsOf(slots.map(([, filament]) => filament));
  }
  return filamentsOf(
    recordsOf(params?.materialList).map((material) => ({
      type: text(material.materialName),
      color: hexColor(material.materialColor),
      grams: rounded(material.materialWeight, 2),
    })),
  );
}

function platesOf(plates: Record<string, unknown>[]): ProfilePlateFacts[] {
  return plates.flatMap((plate) => {
    // Numbered from 0 on NexPrint, from 1 in slicers and the 3MF.
    const position = Number(plate.plateIndex);
    if (!Number.isInteger(position) || position < 0) return [];
    return [
      {
        index: position + 1,
        name: plateName(plate.plateName),
        seconds: minutes(plate.printTime),
        grams: rounded(plate.filamentWeightG, 2),
        filaments: plateFilaments(plate),
      },
    ];
  });
}

/** Each print profile ("setting") of a model, as its public details describe it, by its "G" (or "C") id. A profile is the
 *  designer's as the import has it: the site says so (`isCreator`), or its maker is the model's author. */
export function nexprintProfileFactsFrom(data: Record<string, unknown>): ProviderProfileFactsById {
  const authorId = text(data.authorId);
  const out: ProviderProfileFactsById = {};
  for (const setting of recordsOf(data.settingInfoList)) {
    const id = profileId(setting.settingOutId);
    if (!id) continue;
    const params = recordsOf(setting.settingParamList)[0] ?? null;
    const plates = recordsOf(setting.plateList);
    const makerId = text(setting.userId);
    const designer = setting.isCreator === true || (!!authorId && makerId === authorId);
    out[id] = compactFacts({
      title: text(setting.settingName),
      description: plainText(setting.settingContent),
      origin: designer ? "designer" : setting.isCreator === false || makerId ? "community" : null,
      creator: text(asRecord(setting.author)?.nickname),
      seconds: minutes(params?.printTime),
      grams: rounded(params?.filamentWeightG, 2),
      filaments: profileFilaments(setting, params, plates),
      plates: platesOf(plates),
      printer: text(params?.printerModel),
      nozzleMm: positive(params?.nozzleDiameterMm),
      layerMm: positive(params?.layerHeightMm),
      infill: percentText(params?.infillDensity),
      walls: positive(params?.wallLoops),
      supports: typeof params?.supportEnabled === "boolean" ? params.supportEnabled : null,
    });
  }
  return out;
}

export async function nexprintProfileFacts(_userId: string, modelId: string): Promise<ProviderProfileFactsById | null> {
  const detail = await fetchNexprintDetail(modelId);
  return detail ? nexprintProfileFactsFrom(detail) : null;
}
