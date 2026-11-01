import { providersApi } from "../api/providers";

// Older versions kept a copy of the MakerWorld cookie in this browser and sent it with imports. Nothing reads it now, as
// the server fills in the saved sign-in itself, so it goes. It may be the only copy, though: the server's began later and
// saving there could fail, so it's handed over first, or someone upgrading would lose their sign-in.
const RETIRED_KEY = "thingport_settings";

function readRetiredCookie(): string {
  try {
    const cookie = JSON.parse(window.localStorage.getItem(RETIRED_KEY) ?? "{}")?.makerworld?.cookie;
    return typeof cookie === "string" ? cookie.trim() : "";
  } catch {
    return "";
  }
}

function forgetRetiredSettings(): void {
  try {
    window.localStorage.removeItem(RETIRED_KEY);
  } catch {}
}

/** Once signed in. Kept for the next visit only when the server couldn't be reached. */
export async function settleRetiredSettings(): Promise<void> {
  const cookie = readRetiredCookie();
  try {
    if (cookie) {
      const providers = await providersApi.list();
      const makerworld = providers.find((provider) => provider.id === "makerworld");
      if (makerworld?.slots.default?.status === "disconnected") {
        await providersApi.saveConnection("makerworld", "default", { cookie });
      }
    }
  } catch (err) {
    if (err instanceof TypeError) return;
  }
  forgetRetiredSettings();
}
