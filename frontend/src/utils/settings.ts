// Older versions kept a copy of the MakerWorld cookie in this browser. Nothing reads it now, as the server fills in the
// saved sign-in itself, so it goes.
const RETIRED_KEY = "thingport_settings";

export function forgetRetiredSettings(): void {
  try {
    window.localStorage.removeItem(RETIRED_KEY);
  } catch {}
}
