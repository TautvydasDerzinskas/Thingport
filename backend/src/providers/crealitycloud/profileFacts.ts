import {
  compactFacts,
  durationSeconds,
  filamentsOf,
  firstPositive,
  hexColor,
  percentText,
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
import { sleep } from "../../utils/concurrency";
import { fetchCrealitycloudModelRows, fetchCrealitycloudProfileDetail } from "./api";

// Its rows name the printer without its maker ("K1C"); slicers and the profile's 3MF say "Creality K1C".
const MAKER = "Creality";
// Each profile's plates are a call of their own: spaced out, as a person clicking through them would be.
const DETAIL_PAUSE_MS = 250;

function filaments(list: unknown): ProfileFilament[] {
  return filamentsOf(
    recordsOf(list).map((filament) => ({
      type: text(filament.type),
      color: hexColor(filament.color),
      grams: rounded(filament.weight, 2),
    })),
  );
}

function platesOf(detail: Record<string, unknown> | null | undefined): ProfilePlateFacts[] {
  return recordsOf(detail?.plateList).flatMap((plate) => {
    const index = positive(plate.index);
    if (!index) return [];
    // A plate the site couldn't slice reports zeros, which say nothing.
    const sliced = plate.success !== false;
    return [
      {
        index,
        name: plateName(plate.name),
        seconds: sliced ? durationSeconds(plate.printTime) : null,
        grams: sliced ? rounded(plate.filamentWeight, 2) : null,
        filaments: sliced ? filaments(plate.colorFilament) : [],
      },
    ];
  });
}

/** Each print profile of a model, from its 3MF list rows and, where read, each one's own details with its plates, by
 *  profile id. A profile is the designer's as the import has it: the site vouches for it (`isAuth`), or its maker owns
 *  the model. */
export function crealitycloudProfileFactsFrom(
  groupItem: Record<string, unknown>,
  profiles: Record<string, unknown>[],
  details: Record<string, Record<string, unknown> | null> = {},
): ProviderProfileFactsById {
  const ownerId = text(asRecord(groupItem.userInfo)?.userId);
  const out: ProviderProfileFactsById = {};
  for (const profile of profiles) {
    const id = text(profile.id);
    if (!id) continue;
    const user = asRecord(profile.userInfo);
    const creatorId = text(user?.userId);
    const designer = profile.isAuth === true || (!!ownerId && creatorId === ownerId);
    out[id] = compactFacts({
      // Its own name; `name` is the model's.
      title: text(profile.secondName),
      description: plainText(profile.desc),
      origin: designer ? "designer" : creatorId ? "community" : null,
      creator: text(user?.nickName),
      seconds: durationSeconds(profile.printTime),
      grams: rounded(profile.filamentWeight, 2),
      filaments: filaments(profile.colorFilament),
      plates: platesOf(details[id]),
      printer: withMaker(MAKER, profile.printerName),
      nozzleMm: firstPositive(profile.nozzleDiameter),
      layerMm: positive(profile.layerHeight),
      infill: percentText(profile.sparseInfillDensity),
      walls: positive(profile.wallLoops),
    });
  }
  return out;
}

/** The plates are read only for `profileIds`, the ones a model holds, as each is a call of its own. */
export async function crealitycloudProfileFacts(
  _userId: string,
  modelId: string,
  profileIds: string[],
): Promise<ProviderProfileFactsById | null> {
  const rows = await fetchCrealitycloudModelRows(modelId);
  if (!rows) return null;
  const wanted = new Set(profileIds);
  const details: Record<string, Record<string, unknown> | null> = {};
  for (const profile of rows.profiles) {
    const id = text(profile.id);
    if (!id || !wanted.has(id) || id in details) continue;
    if (Object.keys(details).length) await sleep(DETAIL_PAUSE_MS);
    // One profile's plates failing to come leaves the others', and every profile's own facts, as they are.
    details[id] = await fetchCrealitycloudProfileDetail(rows.groupId, id).catch(() => null);
  }
  const facts = crealitycloudProfileFactsFrom(rows.groupItem, rows.profiles, details);
  for (const [id, detail] of Object.entries(details)) {
    if (!detail && facts[id]) facts[id] = { ...facts[id], partial: true };
  }
  return facts;
}
