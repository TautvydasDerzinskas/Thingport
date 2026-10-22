// The dashboard's weather, through the server like every other outside service: one place to
// cache, rate-limit and identify ourselves. Open-Meteo gives the forecast and place search,
// OpenStreetMap's Nominatim names a detected location.

export type Forecast = {
  temperature: number;
  code: number;
  high: number;
  low: number;
  /** A few hours from now. */
  later: { hours: number; temperature: number; code: number };
};

export type Place = { name: string; admin1?: string; country?: string; latitude: number; longitude: number };

const LATER_HOURS = 6;
const REQUEST_TIMEOUT_MS = 10_000;
const FORECAST_TTL_MS = 30 * 60 * 1000;
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
// Plenty for one household's devices and searches; the oldest entries go first.
const CACHE_LIMIT = 500;
// Nominatim's usage policy: at most one request a second, with an identifying User-Agent.
const NOMINATIM_INTERVAL_MS = 1100;
const USER_AGENT = "Thingport/1.0 (self-hosted; +https://github.com/TautvydasDerzinskas/Thingport)";

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Lets tests answer for the outside services. */
export function setWeatherFetchForTest(impl?: typeof fetch): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
  forecasts.clear();
  searches.clear();
  placeNames.clear();
}

class TtlCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(private ttlMs: number) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.at > this.ttlMs) return undefined;
    return entry.value;
  }
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    if (this.entries.size > CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
  }
  clear(): void {
    this.entries.clear();
  }
}

// Kept in Celsius and unrounded, so either unit is converted from the exact reading.
const forecasts = new TtlCache<Forecast>(FORECAST_TTL_MS);
const searches = new TtlCache<Place[]>(SEARCH_TTL_MS);
// A town doesn't move, so names are kept as long as the cache has room.
const placeNames = new TtlCache<string | null>(Number.POSITIVE_INFINITY);

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Weather service returned HTTP ${res.status}`);
  return res.json();
}

// About 1 km apart: close enough to share a forecast, and it keeps exact coordinates out of the cache.
const round = (value: number, places: number) => Number(value.toFixed(places));

export const TEMPERATURE_UNITS = ["celsius", "fahrenheit"] as const;
export type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

export async function getForecast(lat: number, lon: number, unit: TemperatureUnit = "celsius"): Promise<Forecast> {
  const raw = await getRawForecast(lat, lon);
  const degrees = (celsius: number) => Math.round(unit === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius);
  return {
    ...raw,
    temperature: degrees(raw.temperature),
    high: degrees(raw.high),
    low: degrees(raw.low),
    later: { ...raw.later, temperature: degrees(raw.later.temperature) },
  };
}

async function getRawForecast(lat: number, lon: number): Promise<Forecast> {
  const key = `${round(lat, 2)},${round(lon, 2)}`;
  const cached = forecasts.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({
    latitude: String(round(lat, 2)),
    longitude: String(round(lon, 2)),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    forecast_hours: String(LATER_HOURS + 1),
    forecast_days: "1",
    timezone: "auto",
  });
  const data = (await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)) as {
    current: { temperature_2m: number; weather_code: number };
    hourly: { temperature_2m: number[]; weather_code: number[] };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const forecast: Forecast = {
    temperature: data.current.temperature_2m,
    code: data.current.weather_code,
    high: data.daily.temperature_2m_max[0],
    low: data.daily.temperature_2m_min[0],
    later: {
      hours: LATER_HOURS,
      temperature: data.hourly.temperature_2m[LATER_HOURS],
      code: data.hourly.weather_code[LATER_HOURS],
    },
  };
  forecasts.set(key, forecast);
  return forecast;
}

export async function searchPlaces(query: string, language: string): Promise<Place[]> {
  const key = `${language}:${query.trim().toLowerCase()}`;
  const cached = searches.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({ name: query.trim(), count: "5", language, format: "json" });
  const data = (await getJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`)) as {
    results?: Place[];
  };
  const places = (data.results ?? []).map(({ name, admin1, country, latitude, longitude }) => ({
    name,
    admin1,
    country,
    latitude,
    longitude,
  }));
  searches.set(key, places);
  return places;
}

let nominatimTurn: Promise<void> = Promise.resolve();

/** Waits its turn so the server never asks Nominatim more than once a second. */
function nominatimSlot(): Promise<void> {
  const turn = nominatimTurn.then(() => new Promise<void>((resolve) => setTimeout(resolve, NOMINATIM_INTERVAL_MS)));
  const mine = nominatimTurn;
  nominatimTurn = turn;
  return mine;
}

/** The town or city at a point, or null when it can't be named. */
export async function getPlaceName(lat: number, lon: number, language: string): Promise<string | null> {
  const key = `${language}:${round(lat, 3)},${round(lon, 3)}`;
  const cached = placeNames.get(key);
  if (cached !== undefined) return cached;
  await nominatimSlot();
  const params = new URLSearchParams({
    lat: String(round(lat, 3)),
    lon: String(round(lon, 3)),
    format: "json",
    zoom: "10",
  });
  try {
    const data = (await getJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      "Accept-Language": language,
    })) as { address?: Record<string, string | undefined> };
    const address = data.address ?? {};
    const name = address.city || address.town || address.village || address.county || null;
    placeNames.set(key, name);
    return name;
  } catch {
    // Not cached: the next detection gets another try.
    return null;
  }
}
