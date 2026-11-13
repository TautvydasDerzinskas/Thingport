// QIDI Maker's own API, as its pages call it from www.qidimaker.com: a JSON POST that must carry the headers its pages
// send -- a timestamp near its own clock, a nonce it hasn't seen, and a few that say what's calling. Models and their
// print profiles need no sign-in, so none is sent.

const API = "/community/v1";
// What its pages send: the browser and its version, and a device id that's the same for every visitor.
const DEVICE_ID = "a3f8c2e91b4d7f6e5c0a8b2d4e6f1a9";
const CODE_OK = 200;

function deviceType(): string {
  return `chrome ${navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "121.0.0.0"}`;
}

function timezone(): string {
  const offset = -new Date().getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  return `${offset >= 0 ? "+" : "-"}${hours}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

type Answer = { code: number | null; data: unknown };

/** One call's answer, `code` 200 when it went well; null where it failed or couldn't be read at all. */
async function qidimakerApi(path: string, body: unknown): Promise<Answer | null> {
  try {
    const res = await fetch(`${API}/${path}`, {
      method: "POST",
      credentials: "omit",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Accept-Language": "en_US",
        language: "en",
        "X-Timezone": timezone(),
        "X-DeviceType": deviceType(),
        "X-DeviceId": DEVICE_ID,
        "X-Version": "1.0.0",
        "X-Platform": "Web",
        "X-Region": "NA",
        "X-Timestamp": String(Date.now()),
        "X-Nonce": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { code?: unknown; data?: unknown } | null;
    return { code: typeof json?.code === "number" ? json.code : null, data: json?.data };
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Its ids, as the API gives them: digits, as text. */
function idOf(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : (text(value) ?? "");
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** One of a model's print profiles as its page lists it: a QIDI Studio 3MF on the site's CDN, whose maker is the
 *  model's designer or someone else. */
export type QidimakerProfile = { id: string; title: string; url: string; designer: boolean };

export type QidimakerModel = { title: string | null; profiles: QidimakerProfile[] };

// A profile taken down, or whose model was, and a private one: its page leaves them out.
const OFF_SHELF = 4;
const MODEL_GONE = -1;
const PRIVATE = 1;

/** A model's title and its print profiles in the page's order, as the backend reads them (qidimakerProfilesFrom), from
 *  its details and its list of profiles. */
export function qidimakerModelFrom(detail: unknown, groups: unknown): QidimakerModel | null {
  if (!isRecord(detail)) return null;
  const designerId = idOf(detail.userId);
  const profiles = records(groups).flatMap((group) => {
    const makerId = idOf(group.userId);
    return records(group.sliceModelConfigurationVOS).flatMap((config) => {
      const id = idOf(config.id);
      const url = text(config.modelConfigurationUrl);
      if (!id || !url?.startsWith("https://")) return [];
      if (config.status === OFF_SHELF || config.modelStatus === MODEL_GONE || config.visibility === PRIVATE) return [];
      const title = text(config.translatedModelConfigurationName) ?? text(config.modelConfigurationName) ?? id;
      return [{ id, title, url, designer: !!makerId && makerId === designerId }];
    });
  });
  return { title: text(detail.translatedModelName) ?? text(detail.modelName), profiles };
}

/** The model's title and print profiles, from the same public API the page calls. Null when they can't be read. */
export async function loadQidimakerModel(modelId: string): Promise<QidimakerModel | null> {
  const [detail, list] = await Promise.all([
    qidimakerApi("sliceModel/getModelDetail", { id: modelId }),
    qidimakerApi("sliceModelConfiguration/getListByModelId", { id: modelId }),
  ]);
  if (detail?.code !== CODE_OK || list?.code !== CODE_OK) return null;
  return qidimakerModelFrom(detail.data, list.data);
}
