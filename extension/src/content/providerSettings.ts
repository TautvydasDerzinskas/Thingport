import type { Provider } from "../shared/urls";
import { api } from "./runtime";

type ProviderSettings = { providers: { id: string; enabled: boolean }[] };

/**
 * Whether an admin has left the provider on for the instance. Grab stays out of a turned-off provider's pages,
 * as the instance refuses anything from it. On any failure it counts as on: an instance older than this setting
 * has no such endpoint, and the server still refuses what it must.
 */
export async function providerEnabled(provider: Provider): Promise<boolean> {
  try {
    const { providers } = await api<ProviderSettings>("GET", "/settings/providers");
    return providers.find((p) => p.id === provider)?.enabled ?? true;
  } catch {
    return true;
  }
}
