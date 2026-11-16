import { backgroundText } from "./localize";

/** The instance's own message for an error it answered. Thingport's backend gives every error one as `detail`, so
 *  null means something in front of it answered instead: a reverse proxy, or the web server that ships with it. */
export async function thingportDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown } | null;
    return typeof body?.detail === "string" && body.detail.trim() ? body.detail : null;
  } catch {
    return null;
  }
}

/** What an error answered by something in front of the instance means, by its status. */
export function proxyErrorText(status: number): Promise<string> {
  if (status === 413) return backgroundText("proxyTooLarge");
  if (status === 502 || status === 503) return backgroundText("proxyNoAnswer", { status });
  if (status === 504) return backgroundText("proxyTimedOut");
  return backgroundText("proxyRefused", { status });
}

/** The instance's message for an error response, or, where something in front of it answered, what that means. */
export async function instanceErrorText(res: Response): Promise<string> {
  return (await thingportDetail(res)) ?? proxyErrorText(res.status);
}
