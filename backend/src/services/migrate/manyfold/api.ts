import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { MigrateError } from "../errors";

// Manyfold's API, as a migration reads it: an API key an admin or moderator made there (Manyfold's client credentials,
// with the read scope, which sees what its owner sees), the models with their files, collections and creators. The
// address is the admin's to give, often on the local network, so it's fetched as given. Manyfold builds absolute links
// from its own idea of its hostname, which can differ from the address that reaches it, so every link is followed on
// the address the admin gave.

export type ManyfoldConnection = { address: string; clientId: string; clientSecret: string };

/** Reaching it failed part-way: it stopped, or the network did. A run stops here, to be started again. */
const lost = () => new MigrateError("manyfold_lost", "Manyfold stopped answering.");
/** It answered, with an error: about one model, which is left out, unless it's a list the run needs. Asked to slow
 *  down, by Manyfold or a proxy in front, the run stops instead, or every model after would be left out the same way. */
const answered = (status: number) =>
  status === 429
    ? new MigrateError("manyfold_slow_down", "Manyfold asks to wait a few minutes.")
    : new MigrateError("manyfold_error", `Manyfold answered ${status}.`, { status });

const MEDIA_TYPE = "application/vnd.manyfold.v0+json";
const TIMEOUT_MS = 30_000;
// A file's whole download, its body included: a big one over a slow link takes a while.
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

type Ref = { "@id": string; "@type"?: string };
/** A list's member: its link and its name. */
export type Member = Ref & { name?: string };
type ListPage = { totalItems?: number; member?: Member[]; view?: { next?: string } };

export type ManyfoldModel = Ref & {
  name?: string;
  caption?: string;
  description?: string;
  "spdx:license"?: { licenseId?: string };
  hasPart?: (Ref & { name?: string; encodingFormat?: string })[];
  isPartOf?: Ref[];
  creator?: Ref;
  keywords?: string[];
  preview_file?: Ref;
  links?: { url?: string; text?: string }[];
};

export type ManyfoldFile = Ref & {
  name?: string;
  contentUrl?: string;
  encodingFormat?: string;
  contentSize?: number;
  description?: string;
};

export type ManyfoldCollection = Ref & { name?: string; isPartOf?: Ref };
export type ManyfoldCreator = Ref & { name?: string };

/** The address as the requests start: http or https, without a trailing slash, query or fragment. */
export function manyfoldAddress(given: string): string {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    throw new MigrateError("manyfold_address", "Give Manyfold's address, starting with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MigrateError("manyfold_address", "Give Manyfold's address, starting with http:// or https://.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** A model's or file's id: the last part of its link. */
export const idOf = (ref: Ref | undefined): string =>
  (ref?.["@id"] ?? "").split("?")[0].replace(/\/+$/, "").split("/").pop() ?? "";

/** A file's path in its model's folder, from its link, as Manyfold 0.149 and newer give it: `/models/<id>/raw/<path>`;
 *  null from an older Manyfold, whose links don't say. */
export function filePathOf(contentUrl: string | undefined): string | null {
  if (!contentUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(contentUrl, "http://manyfold.invalid").pathname;
  } catch {
    return null;
  }
  const match = /\/models\/[^/]+\/raw\/(.+)$/.exec(pathname);
  if (!match) return null;
  try {
    return match[1]
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return null;
  }
}

export class ManyfoldClient {
  private token: { value: string; until: number } | null = null;
  /** A sign-in under way, which requests made meanwhile wait for rather than signing in again. */
  private signingIn: Promise<string> | null = null;

  constructor(readonly connection: ManyfoldConnection) {}

  /** Any link Manyfold gave, on the address the admin gave. */
  private onAddress(link: string): string {
    const base = new URL(`${this.connection.address}/`);
    const given = new URL(link, base);
    const prefix = base.pathname.replace(/\/+$/, "");
    const pathname = prefix && !given.pathname.startsWith(`${prefix}/`) ? `${prefix}${given.pathname}` : given.pathname;
    return `${base.origin}${pathname}${given.search}`;
  }

  private async accessToken(fresh = false): Promise<string> {
    if (fresh) this.token = null;
    if (this.token && this.token.until > Date.now()) return this.token.value;
    this.signingIn ??= this.signIn().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  private async signIn(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.connection.address}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.connection.clientId,
          client_secret: this.connection.clientSecret,
          scope: "read",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MigrateError("manyfold_unreachable", `This server can't reach ${this.connection.address}.`, {
        address: this.connection.address,
      });
    }
    if (res.status === 404) {
      throw new MigrateError("manyfold_not_manyfold", "That address doesn't answer as Manyfold does.");
    }
    if (res.status === 429) {
      throw new MigrateError("manyfold_slow_down", "Manyfold asks to wait a few minutes before signing in again.");
    }
    if (!res.ok) throw new MigrateError("manyfold_key", "Manyfold turned the API key down.");
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new MigrateError("manyfold_key", "Manyfold turned the API key down.");
    // A minute short of its end, to never send one that runs out on the way.
    this.token = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 7200) - 60) * 1000 };
    return body.access_token;
  }

  private async call(link: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await fetch(this.onAddress(link), {
        ...init,
        headers: { Accept: MEDIA_TYPE, Authorization: `Bearer ${token}`, ...(init.headers as object) },
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw lost();
    }
    // Its tokens last two hours: one that ran out is asked for again, once.
    if (res.status === 401 && !retried) {
      await this.accessToken(true);
      return this.call(link, init, true);
    }
    return res;
  }

  async json<T>(link: string): Promise<T> {
    const res = await this.call(link);
    if (res.status === 401 || res.status === 403) {
      throw new MigrateError("manyfold_key", "Manyfold turned the API key down.");
    }
    if (!res.ok) throw answered(res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw lost();
    }
  }

  /** Every page of a list, by the page number: Manyfold's own links to the next page leave filters out. */
  private async *pages(route: string, query: Record<string, string> = {}): AsyncGenerator<ListPage> {
    for (let page = 1; page < 100_000; page++) {
      const params = new URLSearchParams({ ...query, page: String(page) });
      const body = await this.json<ListPage>(`${route}?${params}`);
      yield body;
      if (!body.view?.next || !body.member?.length) return;
    }
  }

  /** The models this key sees, by their links; with `owner`, those someone owns, by their username. */
  async modelRefs(owner?: string): Promise<{ total: number; refs: Member[] }> {
    const refs: Member[] = [];
    let total = 0;
    for await (const page of this.pages("/models", owner ? { owner } : {})) {
      total = page.totalItems ?? total;
      refs.push(...(page.member ?? []));
    }
    return { total: Math.max(total, refs.length), refs };
  }

  /** The first page of models: enough to look at a few. */
  async firstModels(): Promise<Member[]> {
    return (await this.json<ListPage>("/models?page=1")).member ?? [];
  }

  async count(route: "/models" | "/collections" | "/creators"): Promise<number> {
    const first = await this.json<ListPage>(`${route}?page=1`);
    return first.totalItems ?? first.member?.length ?? 0;
  }

  /** How many models someone owns there; zero for a username Manyfold doesn't know. */
  async ownedCount(username: string): Promise<number> {
    const res = await this.call(`/models?${new URLSearchParams({ owner: username, page: "1" })}`);
    if (res.status === 404) return 0;
    if (!res.ok) throw answered(res.status);
    const body = (await res.json().catch(() => ({}))) as ListPage;
    return body.totalItems ?? body.member?.length ?? 0;
  }

  async collections(): Promise<Member[]> {
    const refs: Member[] = [];
    for await (const page of this.pages("/collections")) refs.push(...(page.member ?? []));
    return refs;
  }

  /** Downloads a file to `to`, under another name until it's whole. A redirect to another host, as to a bucket a
   *  library is in, is followed without the token. */
  async download(link: string, to: string): Promise<boolean> {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    let res = await this.call(link, { headers: { Accept: "*/*" }, signal });
    // Each hop's address, which the next one's Location is read against: a bucket's relative one stays on the bucket.
    let at = new URL(this.onAddress(link));
    // Whether the answer is Manyfold's own, which a refused key is told by, or a bucket's it sent the download to.
    let fromManyfold = true;
    for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 3; hops++) {
      const location = res.headers.get("location");
      if (!location) break;
      const next = new URL(location, at);
      at = next;
      fromManyfold = next.origin === new URL(this.connection.address).origin;
      res = fromManyfold
        ? await this.call(next.toString(), { headers: { Accept: "*/*" }, signal })
        : await fetch(next, { redirect: "manual", signal }).catch(() => {
            throw lost();
          });
    }
    if (res.status === 404) return false;
    // As for a list: every file after it would be refused the same way, so the run stops, to be started again.
    if (fromManyfold && (res.status === 401 || res.status === 403)) {
      throw new MigrateError("manyfold_key", "Manyfold turned the API key down.");
    }
    if (!res.ok || !res.body) throw answered(res.status);
    await fs.mkdir(path.dirname(to), { recursive: true });
    const part = `${to}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(part));
      await fs.rename(part, to);
    } catch {
      await fs.rm(part, { force: true }).catch(() => undefined);
      throw lost();
    }
    return true;
  }
}
