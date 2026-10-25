// Whether Thangs lets the signed-in user download a model, asked the way its own page asks. It costs none of their
// daily downloads, so the panel can say why before an import is tried.

import { parseThangsModelUrl } from "./urls.generated";

export type ThangsBlock = { title: string; hint: string };

function accessToken(): string | null {
  const pair = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("accessToken="));
  return pair ? decodeURIComponent(pair.slice("accessToken=".length)) : null;
}

/** Why the model can't be imported, or null when it can, or that can't be told (signed out there: the import says). */
export async function thangsDownloadBlock(url: string): Promise<ThangsBlock | null> {
  const parsed = parseThangsModelUrl(url);
  const token = accessToken();
  if (!parsed || !token) return null;
  try {
    const origin = new URL(location.href);
    if (origin.protocol !== "https:" || !["thangs.com", "www.thangs.com"].includes(origin.hostname)) return null;
    const res = await providerCredentialRequest(
      "thangs-site",
      `${origin.origin}/api/v4/models/${parsed.modelId}/can-download`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        credentials: "omit",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { canDownload?: boolean; disabledCode?: string | null };
    if (json.canDownload !== false) return null;
    if (json.disabledCode === "PrintOnly") {
      return { title: "Sold as a print", hint: "Its designer sells it printed only: Thangs doesn't offer its files." };
    }
    return {
      title: "Paid model",
      hint: "Buy it on Thangs, or join the designer's membership that includes it. Then Thingport can import it.",
    };
  } catch {
    return null;
  }
}
