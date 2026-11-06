import type { webcrypto } from "node:crypto";
import type { Context, Federation } from "@fedify/fedify";
import type * as Vocab from "@fedify/vocab";
import { getPublicUrl } from "../services/settingsService";
import { isAllowedOrigin } from "./allowlist";
import { FederationFetchError, federationFetch, readJson } from "./fetch";
import { getInstanceKeys, type InstanceKeys } from "./keys";
import { PrismaKvStore } from "./kvStore";
import { registerInbox } from "./inbox";

type CryptoKey = webcrypto.CryptoKey;
type RemoteDocument = { contextUrl: string | null; document: unknown; documentUrl: string };
export type DocumentLoader = (url: string) => Promise<RemoteDocument>;

/** Everything Fedify, built only once federation is on: instances that never turn it on never load it. */
export type Runtime = {
  origin: string;
  fedify: typeof import("@fedify/fedify");
  vocab: typeof Vocab;
  federation: Federation<void>;
  context: Context<void>;
  keys: InstanceKeys;
  actorUrl: URL;
  sharedInboxUrl: URL;
  /** The RSA key's id, which every request this instance signs names. */
  keyId: URL;
  /** Fetches only from partners, or the instance an admin is looking at; never signed. */
  documentLoader: DocumentLoader;
  /** The same, signed as this instance, for documents only partners may read. */
  signedLoader: DocumentLoader;
  /** JSON-LD contexts, from Fedify's own copies only: an instance on a LAN may have no internet at all. */
  contextLoader: DocumentLoader;
  toJson(object: Vocab.Object): Promise<unknown>;
};

export const INSTANCE = "instance";
export const AP_PREFIX = "/api/ap";

let current: { origin: string; runtime: Promise<Runtime> } | null = null;

/** The runtime for the instance's Public URL; made again if that changed, since every address it publishes starts
 *  with it. */
export async function getRuntime(): Promise<Runtime> {
  const publicUrl = await getPublicUrl();
  if (!publicUrl) throw new Error("This instance has no Public URL");
  const origin = new URL(publicUrl).origin;
  if (!current || current.origin !== origin) {
    const runtime = build(origin);
    current = { origin, runtime };
    runtime.catch(() => {
      if (current?.runtime === runtime) current = null;
    });
  }
  return current.runtime;
}

/** For tests, and after the keys change. */
export function resetRuntime(): void {
  current = null;
}

const ACCEPT = 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

async function build(origin: string): Promise<Runtime> {
  const fedify = await import("@fedify/fedify");
  const vocab = await import("@fedify/vocab");
  const { preloadedContexts } = await import("@fedify/vocab-runtime");
  const keys = await getInstanceKeys();

  const contextLoader: DocumentLoader = async (url) => {
    if (url in preloadedContexts) return { contextUrl: null, document: preloadedContexts[url], documentUrl: url };
    throw new FederationFetchError(`Unknown JSON-LD context: ${url}`, "not_allowed");
  };
  const makeLoader =
    (identity?: { keyId: URL; privateKey: CryptoKey }): DocumentLoader =>
    async (url) => {
      if (url in preloadedContexts) return contextLoader(url);
      let request = new Request(url, { headers: { Accept: ACCEPT } });
      if (identity) request = await fedify.signRequest(request, identity.privateKey as never, identity.keyId);
      const response = await federationFetch(url, { headers: request.headers }, isAllowedOrigin);
      if (!response.ok) {
        throw new FederationFetchError(`HTTP ${response.status} from ${url}`, "status", response.status);
      }
      return { contextUrl: null, document: await readJson(response), documentUrl: url };
    };

  const federation = fedify.createFederation<void>({
    kv: new PrismaKvStore(),
    origin,
    documentLoaderFactory: () => makeLoader() as never,
    contextLoaderFactory: () => contextLoader as never,
    authenticatedDocumentLoaderFactory: (identity) => makeLoader(identity as never) as never,
  });

  federation
    .setActorDispatcher(`${AP_PREFIX}/actors/{identifier}`, async (ctx, identifier) => {
      if (identifier !== INSTANCE) return null;
      const pairs = await ctx.getActorKeyPairs(identifier);
      const host = new URL(origin).host;
      return new vocab.Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: host,
        name: host,
        url: new URL(origin),
        inbox: ctx.getInboxUri(identifier),
        endpoints: new vocab.Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: pairs[0].cryptographicKey,
        assertionMethods: pairs.map((pair) => pair.multikey),
        manuallyApprovesFollowers: true,
      });
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) =>
      identifier === INSTANCE ? [keys.rsa as never, keys.ed25519 as never] : [],
    )
    // Anyone may read the instance actor: verifying a signed request needs the signer's key, so gating it too would
    // leave two instances waiting on each other forever. People's actors come later, for partners only.
    .authorize(async (_ctx, identifier) => identifier === INSTANCE);

  const listeners = federation
    .setInboxListeners(`${AP_PREFIX}/actors/{identifier}/inbox`, `${AP_PREFIX}/inbox`)
    // Keys and objects fetched while handling an activity are fetched signed as this instance, so partners' gated
    // documents answer.
    .setSharedKeyDispatcher(() => ({ identifier: INSTANCE }));
  registerInbox(listeners, vocab);

  const context = federation.createContext(new URL(origin), undefined);
  const pairs = await context.getActorKeyPairs(INSTANCE);
  return {
    origin,
    fedify,
    vocab,
    federation,
    context,
    keys,
    actorUrl: context.getActorUri(INSTANCE),
    sharedInboxUrl: context.getInboxUri(),
    keyId: pairs[0].keyId,
    documentLoader: makeLoader(),
    signedLoader: makeLoader({ keyId: pairs[0].keyId, privateKey: keys.rsa.privateKey }),
    contextLoader,
    toJson: (object) => object.toJsonLd({ format: "compact", contextLoader: contextLoader as never }),
  };
}
