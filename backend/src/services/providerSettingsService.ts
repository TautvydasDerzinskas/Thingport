import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { MANIFESTS, PROVIDER_IDS, providerOfHost, type ProviderId } from "../providers/index.generated";

// An admin can turn a provider off for the whole instance: nothing new comes from it (imports by link, Thingport
// Grab, the queue, collection imports), its collection syncs pause, and background jobs leave it alone. Models
// already imported from it stay as they are.

export const PROVIDERS = PROVIDER_IDS;
export type Provider = ProviderId;

const SETTING_KEY = "disabled_providers";
export const PROVIDER_DISABLED_CODE = "provider_disabled";

// Any number, as long as only this list's writers take it. The list is read, changed and saved whole: two admins
// switching different providers at once would otherwise both read it unchanged, and the later save would undo the
// other's change.
const LIST_LOCK = 74_210_304;

export async function getDisabledProviders(
  db: Pick<Prisma.TransactionClient, "setting"> = prisma,
): Promise<Set<Provider>> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  const value = Array.isArray(row?.value) ? row.value : [];
  return new Set(value.filter((p): p is Provider => (PROVIDERS as readonly unknown[]).includes(p)));
}

export async function setProviderEnabled(provider: Provider, enabled: boolean): Promise<Set<Provider>> {
  return setProvidersEnabled([provider], enabled);
}

/** One write for all of them, one writer at a time. */
export async function setProvidersEnabled(providers: readonly Provider[], enabled: boolean): Promise<Set<Provider>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LIST_LOCK})`;
    const disabled = await getDisabledProviders(tx);
    for (const provider of providers) {
      if (enabled) disabled.delete(provider);
      else disabled.add(provider);
    }
    const value = [...disabled] as unknown as Prisma.InputJsonValue;
    await tx.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
    return disabled;
  });
}

export async function isProviderEnabled(provider: string): Promise<boolean> {
  return !(await getDisabledProviders()).has(provider as Provider);
}

/** The provider a link belongs to, by its host; null for any other site. */
export function providerOfUrl(url: string): Provider | null {
  try {
    return providerOfHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Throws when an admin has turned the provider off; any other value passes. */
export async function assertProviderEnabled(provider: string | null | undefined): Promise<void> {
  if (!provider || !(PROVIDERS as readonly string[]).includes(provider)) return;
  if (await isProviderEnabled(provider)) return;
  throw new HttpError(
    403,
    `${MANIFESTS[provider as Provider].name} is turned off on this Thingport instance. An admin can turn it back on in Administration > Providers.`,
    PROVIDER_DISABLED_CODE,
  );
}

export async function assertUrlProviderEnabled(url: string): Promise<void> {
  await assertProviderEnabled(providerOfUrl(url));
}
