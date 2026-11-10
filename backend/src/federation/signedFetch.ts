import { federationFetch } from "./fetch";
import { getRuntime } from "./runtime";

/** A GET of a partner's document or file, signed as this instance, to that partner's own origin and nowhere else:
 *  what partners answer only for each other (publish.ts). */
export async function signedGet(
  url: string,
  origin: string,
  options: { accept?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const runtime = await getRuntime();
  const signed = await runtime.fedify.signRequest(
    new Request(url, { headers: { Accept: options.accept ?? "*/*" } }),
    runtime.keys.rsa.privateKey as never,
    runtime.keyId,
  );
  return federationFetch(url, { headers: signed.headers, signal: options.signal }, (allowed) => allowed === origin);
}
