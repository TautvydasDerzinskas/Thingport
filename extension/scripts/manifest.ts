// Generates each browser's manifest.json. Firefox has no extension service workers, so it runs the
// same bundle as an event page.

export const TARGETS = ["chrome", "firefox", "edge"] as const;
export type Target = (typeof TARGETS)[number];

export function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

const PROVIDER_MATCHES = ["*://*.thingiverse.com/*", "*://*.makerworld.com/*", "*://*.printables.com/*"];
const COOKIE_HOSTS = ["*://*.makerworld.com/*", "*://*.printables.com/*"];

function iconSet(variant: "color" | "dark"): Record<string, string> {
  return Object.fromEntries(
    [16, 32, 48, 128].map((size) => [String(size), `icons/thingport-icon-${variant}-${size}.png`]),
  );
}

export function buildManifest(target: Target, pkg: { version: string; description: string }): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: "Thingport Grab",
    version: pkg.version,
    description: pkg.description,
    icons: iconSet("color"),
    action: {
      default_popup: "popup.html",
      default_icon: iconSet("dark"),
    },
    background: target === "firefox" ? { scripts: ["background.js"] } : { service_worker: "background.js" },
    // scripting: the content script for sites the user turns on later (src/shared/optionalSites.ts). alarms: renewing
    // the Snapmaker sign-in on a timer (src/background/snapmakerSession.ts). Neither carries an install warning, so
    // adding them didn't need everyone to approve the update.
    permissions: ["storage", "cookies", "downloads", "scripting", "alarms"],
    // chrome.cookies needs these as host permissions; content script matches don't count. Their
    // session cookies are HttpOnly, so only the background can read them.
    host_permissions: COOKIE_HOSTS,
    // The user's instance origin, requested at setup, and the optional sites, requested when turned on.
    optional_host_permissions: ["*://*/*"],
    content_scripts: [
      { matches: PROVIDER_MATCHES, js: ["content.js"], run_at: "document_idle" },
      // Thingiverse's restyles, before the page paints so it doesn't flash white or show ads first (src/thingiverse/).
      { matches: ["*://*.thingiverse.com/*"], js: ["thingiverse.js"], run_at: "document_start" },
    ],
  };

  if (target === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        // Never change once builds have been distributed: it ties signed versions together.
        id: "grab@thingport.app",
        strict_min_version: "109.0",
        // The user's own instance counts as neither the developer nor a third party.
        data_collection_permissions: { required: ["none"] },
      },
    };
  }
  return manifest;
}
