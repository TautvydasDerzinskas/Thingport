import { describe, expect, it } from "vitest";
import { LOCALES } from "../constants/languages";
import { type AuthSlot, MANIFESTS, PROVIDER_IDS, type ProviderId } from "./index.generated";

const camelCase = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** The strings the UI looks up for a provider, by what its manifest says it has. */
function requiredKeys(id: ProviderId): string[] {
  const manifest = MANIFESTS[id];
  const auth = manifest.auth as readonly AuthSlot[];
  const own = auth.find((a) => a.slot === "default");
  const keys = ["about.summary", "about.signIn", "about.grab", "about.setup", "admin.description", "sync.notConnected"];
  if (!own) keys.push("status.alwaysConnected");
  else {
    keys.push("connect.steps", "connect.placeholder", "status.disabledReason");
    if (own.fields.length > 1) keys.push(...own.fields.map((f) => `connect.${camelCase(f.name)}Label`));
    if (own.scope === "instance") keys.push("connect.shared", "status.adminOnly");
    else keys.push("status.expired", "status.expiredStatus");
  }
  for (const extra of auth.filter((a) => a.slot !== "default")) {
    if (extra.scope === "instance") keys.push("admin.key.heading", "admin.keyStatus.set", "admin.keyStatus.missing");
    else keys.push(...["title", "paste", "save", "placeholder", "steps"].map((k) => `connect.${extra.slot}.${k}`));
  }
  if (own?.scope === "instance") keys.push("admin.key.heading", "admin.keyStatus.set", "admin.keyStatus.missing");
  if (manifest.capabilities.ownLists === "username") {
    keys.push("sync.usernameHint", "sync.usernamePlaceholder", "sync.showing", "sync.forgetMessage");
  }
  return keys;
}

const lookup = (node: unknown, path: string) =>
  path.split(".").reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as never)[key] : undefined), node);

describe("provider strings", () => {
  it.each(Object.keys(LOCALES))("%s has every string each provider's manifest calls for", (code) => {
    const providers = LOCALES[code].providers;
    const missing = PROVIDER_IDS.flatMap((id) =>
      requiredKeys(id)
        .filter((key) => lookup(providers?.[id], key) === undefined)
        .map((key) => `providers:${id}.${key}`),
    );
    expect(missing).toEqual([]);
  });
});
