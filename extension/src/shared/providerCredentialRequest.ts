import { CREDENTIAL_HOSTS, type CredentialDestination } from "./credentialHosts.generated";

type ProviderCredentialDestination = Extract<
  CredentialDestination,
  "makerworld-extension" | "printables-api" | "snapmaker-id" | "thangs-site"
>;

/** Content and background scripts never forward a provider secret to another origin. */
export function providerCredentialRequest(
  destination: ProviderCredentialDestination,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !(CREDENTIAL_HOSTS[destination].exact as readonly string[]).includes(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`Refusing to send ${destination} credentials to ${parsed.origin}`);
  }
  return fetch(parsed.href, { ...init, redirect: "error" });
}
