// Once per tab, what the provider's page has to tell the background (providers/accounts.ts).

import { PROVIDER_IDS, URLS } from "../shared/providers/_generated";
import { CAPTURE } from "../providers/accounts";

let captured = false;

export function captureProviderAccount(hostname: string): void {
  if (captured) return;
  const provider = PROVIDER_IDS.find((id) => URLS[id].isHost(hostname));
  const capture = provider && CAPTURE[provider];
  if (!capture) return;
  captured = true;
  capture(provider);
}
