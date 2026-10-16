import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";

// An admin can turn a provider off for the whole instance: nothing new comes from it (imports by link, Thingport
// Grab, the queue, collection imports), its collection syncs pause, and background jobs leave it alone. Models
// already imported from it stay as they are.

export const PROVIDERS = ["makerworld", "printables", "thingiverse"] as const;
export type Provider = (typeof PROVIDERS)[number];

const PROVIDER_NAMES: Record<Provider, string> = {
  makerworld: "MakerWorld",
  printables: "Printables",
  thingiverse: "Thingiverse",
};

const SETTING_KEY = "disabled_providers";
export const PROVIDER_DISABLED_CODE = "provider_disabled";

export async function getDisabledProviders(): Promise<Set<Provider>> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  const value = Array.isArray(row?.value) ? row.value : [];
  return new Set(value.filter((p): p is Provider => (PROVIDERS as readonly unknown[]).includes(p)));
}

export async function setProviderEnabled(provider: Provider, enabled: boolean): Promise<Set<Provider>> {
  const disabled = await getDisabledProviders();
  if (enabled) disabled.delete(provider);
  else disabled.add(provider);
  const value = [...disabled] as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  return disabled;
}

export async function isProviderEnabled(provider: string): Promise<boolean> {
  return !(await getDisabledProviders()).has(provider as Provider);
}

/** The provider a link belongs to, by its host; null for any other site. */
export function providerOfUrl(url: string): Provider | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const provider of PROVIDERS) {
    if (host === `${provider}.com` || host.endsWith(`.${provider}.com`)) return provider;
  }
  return null;
}

/** Throws when an admin has turned the provider off; any other value passes. */
export async function assertProviderEnabled(provider: string | null | undefined): Promise<void> {
  if (!provider || !(PROVIDERS as readonly string[]).includes(provider)) return;
  if (await isProviderEnabled(provider)) return;
  throw new HttpError(
    403,
    `${PROVIDER_NAMES[provider as Provider]} is turned off on this Thingport. An admin can turn it back on in Administration > Providers.`,
    PROVIDER_DISABLED_CODE,
  );
}

export async function assertUrlProviderEnabled(url: string): Promise<void> {
  await assertProviderEnabled(providerOfUrl(url));
}
