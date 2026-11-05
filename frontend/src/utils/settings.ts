import { ConnectionRefusedError, providersApi } from "../api/providers";
import { readUser } from "./auth";

// Older versions kept a copy of the MakerWorld cookie in this browser and sent it with imports. Nothing reads it now, as
// the server fills in the saved sign-in itself, so it goes. It may be the only copy, though: the server's began later and
// saving there could fail, so it's offered to the server first, or someone upgrading would lose their sign-in. Nothing
// says whose it is, as a browser can be shared, so that's asked rather than assumed.
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

let settling = false;

/** Once signed in. `isTheirs` asks the person, only if there's a copy their account could use; null is no answer. The
 *  copy goes once that's answered no, the account has a sign-in or the server has turned it down; anything else, and the
 *  next visit tries again. */
export async function settleRetiredSettings(isTheirs: () => Promise<boolean | null>): Promise<void> {
  if (settling) return;
  settling = true;
  try {
    const cookie = readRetiredCookie();
    if (cookie) {
      const providers = await providersApi.list();
      const makerworld = providers.find((provider) => provider.id === "makerworld");
      if (makerworld?.slots.default?.status === "disconnected") {
        const askedOf = readUser()?.id;
        const answer = await isTheirs();
        // A save goes by who's signed in when it's sent, and another tab may have changed that since they were asked.
        if (answer === null || readUser()?.id !== askedOf) return;
        if (answer) await providersApi.saveConnection("makerworld", "default", { cookie });
      }
    }
    forgetRetiredSettings();
  } catch (err) {
    if (err instanceof ConnectionRefusedError) forgetRetiredSettings();
  } finally {
    settling = false;
  }
}
