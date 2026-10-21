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

export async function readErrorMessage(res: Response, fallback: string) {
  let body = "";
  try {
    body = await res.text();
  } catch {
    return fallback;
  }
  const trimmed = body.trim();
  if (!trimmed) return fallback;
  try {
    const data = JSON.parse(trimmed);
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail.trim();
    }
  } catch {}
  // An HTML page comes from a proxy in front of the backend, not from Thingport.
  if (/^<(!doctype|html)/i.test(trimmed)) {
    if (res.status === 504)
      return "The server took too long to answer, and a proxy in front of Thingport gave up (HTTP 504).";
    return `${fallback} (HTTP ${res.status})`;
  }
  return trimmed;
}

/** Like `assertOk`, but a failure carries the server's own message. */
export async function assertOkWithMessage(res: Response, fallback: string) {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
}
