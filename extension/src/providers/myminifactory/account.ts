// Who the user is signed in as on MyMiniFactory, read on its pages for the web app's Browse tab, and its session.

import { send } from "../../shared/messages";
import { MANIFESTS } from "../index.generated";

/** MyMiniFactory renders its top menu from data in the page, which names the signed-in user;
 *  `userDetails` is null when signed out. */
function readMyminifactoryUsername(): string | null {
  try {
    const data = document.querySelector('[data-component-name="TopMenu"]')?.textContent;
    const user = data ? (JSON.parse(data) as { userDetails?: { username?: unknown } | null }).userDetails : null;
    return typeof user?.username === "string" && user.username.trim() ? user.username.trim() : null;
  } catch {
    return null;
  }
}

export function captureMyminifactoryAccount(): void {
  const value = readMyminifactoryUsername();
  if (!value) return;
  const provider = MANIFESTS.myminifactory.id;
  void send("REPORT_PROVIDER_ACCOUNT", { provider, value });
  // Signed in: its session downloads the paid and login-only models in the user's library.
  void send("SYNC_PROVIDER_SESSION", { provider });
}
