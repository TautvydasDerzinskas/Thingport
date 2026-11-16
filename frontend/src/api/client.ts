import i18next from "i18next";
import { THINGPORT_WEBSITE_URL } from "../constants/website";

const REVERSE_PROXY_GUIDE = `${THINGPORT_WEBSITE_URL}docs/guides/reverse-proxy/`;

// Always same-origin /api/*: nginx proxies it in production, Vite in dev.
export function apiBase(): string {
  return "/api";
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Signed in, but not allowed, e.g. an admin-only endpoint read by a user who isn't one. */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class LastPlateError extends Error {
  constructor(message = "Cannot remove the only remaining plate. Delete the print instead.") {
    super(message);
    this.name = "LastPlateError";
  }
}

export class EmailNotVerifiedError extends Error {
  constructor(message = "Please verify your email before signing in.") {
    super(message);
    this.name = "EmailNotVerifiedError";
  }
}

export function assertOk(res: Response, message: string) {
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    throw new Error(message);
  }
}

/** What an error answered by something in front of the backend means, by its status. */
function proxyErrorMessage(status: number): string {
  if (status === 413) return i18next.t("proxyErrors.tooLarge", { ns: "common", url: REVERSE_PROXY_GUIDE });
  if (status === 502 || status === 503) return i18next.t("proxyErrors.noAnswer", { ns: "common", status });
  if (status === 504) return i18next.t("proxyErrors.timedOut", { ns: "common", url: REVERSE_PROXY_GUIDE });
  return i18next.t("proxyErrors.refused", { ns: "common", status, url: REVERSE_PROXY_GUIDE });
}

export async function readErrorMessage(res: Response, fallback: string) {
  let body = "";
  try {
    body = await res.text();
  } catch {
    return fallback;
  }
  try {
    const data = JSON.parse(body);
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail.trim();
    }
  } catch {}
  // The backend gives every error a `detail`: without one, a reverse proxy, or the web server that ships with
  // Thingport, answered instead, and its page says nothing a person can act on.
  return res.ok ? fallback : proxyErrorMessage(res.status);
}

/** Like `assertOk`, but a failure carries the server's own message. */
export async function assertOkWithMessage(res: Response, fallback: string) {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
}
