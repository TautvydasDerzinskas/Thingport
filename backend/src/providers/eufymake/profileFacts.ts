import {
  compactFacts,
  percentText,
  positive,
  rounded,
  text,
  type ProviderProfileFacts,
  type ProviderProfileFactsById,
} from "../../services/printProfileFacts";
import { asRecord, recordsOf } from "../../services/trendingModel";
import { fetchEufymakeModel, printFileId } from "./api";

// Its printer field is whatever the uploader typed, often a part's name: only AnkerMake's own printers are taken from it.
const PRINTERS: Record<string, string> = { M5: "AnkerMake M5", M5C: "AnkerMake M5C" };

/** What its model data says of each print file, by the id its plate is tagged with: all its designer's own. Times
 *  are in seconds, weights in grams; a layer height of 0 is one it didn't say. */
export function eufymakeProfileFactsFrom(model: Record<string, unknown>): ProviderProfileFactsById {
  const creator = text(asRecord(model.user)?.nickname);
  const facts: ProviderProfileFactsById = {};
  for (const info of recordsOf(model.model_print_infos)) {
    const id = printFileId(info.info_id);
    if (!id) continue;
    const material = text(info.material);
    const grams = rounded(info.print_weight, 2);
    const profile: ProviderProfileFacts = {
      title: text(info.print_name)?.replace(/\.3mf$/i, "") ?? null,
      origin: "designer",
      creator,
      seconds: rounded(info.print_time),
      grams,
      filaments: material ? [{ type: material, color: null, grams }] : [],
      printer: PRINTERS[text(info.printer)?.toUpperCase() ?? ""] ?? null,
      nozzleMm: positive(info.nozzle),
      layerMm: positive(info.print_layer_height),
      infill: percentText(info.print_infill),
      walls: rounded(info.walls_num),
    };
    facts[id] = compactFacts(profile);
  }
  return facts;
}

/** Every print file of a model, read from its public details. Null when eufyMake doesn't know the model. */
export async function eufymakeProfileFacts(
  _userId: string,
  externalId: string,
  _profileIds: string[],
): Promise<ProviderProfileFactsById | null> {
  const model = await fetchEufymakeModel(externalId);
  return model ? eufymakeProfileFactsFrom(model) : null;
}
