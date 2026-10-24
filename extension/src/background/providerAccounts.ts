// Who the user is signed in as on a site whose lists are found by username, read on its pages, so the web app's
// Browse tab lists their collections without asking. Sent only when it changes; the signed-in
// account replaces a username typed into the app.

import type { AccountProvider } from "../shared/messages";
import { apiCall, requireConfig } from "./api";

/** Best-effort: an instance without the endpoint, or without Thingiverse or MyMiniFactory connected, just says no. */
export async function reportProviderAccount(provider: AccountProvider, value: string): Promise<null> {
  const config = await requireConfig().catch(() => null);
  if (!config) return null;
  // Per Thingport account, so switching the extension to another one sends it there too.
  const account = `${config.instanceUrl} ${config.email}`;
  const sent = config.lastSentProviderAccounts?.account === account ? config.lastSentProviderAccounts.values : {};
  if (sent[provider] === value) return null;
  try {
    await apiCall("PUT", `/provider-collections/accounts/${provider}`, { value });
    await chrome.storage.local.set({ lastSentProviderAccounts: { account, values: { ...sent, [provider]: value } } });
  } catch {}
  return null;
}
