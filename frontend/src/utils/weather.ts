import { authHeaders } from "./auth";
import { apiBase, assertOk } from "../api/client";

// The dashboard's weather, through our own server, which talks to the weather and map services,
// caches their answers and keeps within their usage rules.

export type Weather = {
  temperature: number;
  code: number;
  high: number;
  low: number;
  /** A few hours from now. */
  later: { hours: number; temperature: number; code: number };
};

export type Place = { name: string; admin1?: string; country?: string; latitude: number; longitude: number };

export type TemperatureUnit = "celsius" | "fahrenheit";

export async function fetchWeather(lat: number, lon: number, unit: TemperatureUnit = "celsius"): Promise<Weather> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), unit });
  const res = await fetch(`${apiBase()}/dashboard/weather?${params}`, { headers: authHeaders() });
  assertOk(res, "Failed to load the weather");
  return res.json();
}

export async function searchPlaces(query: string, language: string): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, lang: language });
  const res = await fetch(`${apiBase()}/dashboard/weather/places?${params}`, { headers: authHeaders() });
  assertOk(res, "Place search failed");
  return (await res.json()).places as Place[];
}

/** The town or city at a point, or null when it can't be named. */
export async function placeName(lat: number, lon: number, language: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: language });
    const res = await fetch(`${apiBase()}/dashboard/weather/place-name?${params}`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()).name as string | null;
  } catch {
    return null;
  }
}

/** WMO weather codes, grouped into what the dashboard shows. */
export type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export function conditionOf(code: number): Condition {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}
