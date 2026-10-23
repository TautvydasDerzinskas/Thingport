// Guards the provider-module refactor (docs/rfc/provider-modules.md): change these literal contracts deliberately.
// Some lists are read from the source text because they aren't exported; Phase 3 points these at the provider registry.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { PROVIDERS } from "../src/services/providerSettingsService";
import { BROWSABLE_PROVIDERS } from "../src/services/providerCollectionsService";
import { TRENDING_PROVIDERS } from "../src/services/providerTrendingService";
import { API_TOKEN_SCOPES, scopeForPath } from "../src/services/apiTokenScopes";
import importsRoutes from "../src/routes/imports";
import settingsRoutes from "../src/routes/settings";
import providerCollectionsRoutes from "../src/routes/providerCollections";
import { identifySourceModel } from "../src/services/importService";

const app = createApp();
const source = (file: string) => readFileSync(new URL(`../src/services/${file}`, import.meta.url), "utf8");

function quotedList(file: string, start: RegExp): string[] {
  const match = source(file).match(start);
  if (!match) throw new Error(`Cannot find provider list in ${file}`);
  return [...match[1].matchAll(/["']([a-z0-9_]+)["']/g)].map((part) => part[1]);
}

describe("provider-module freeze", () => {
  it("pins every sourceProvider value produced for a model URL", () => {
    expect(
      [
        "https://makerworld.com/en/models/1234",
        "https://www.thingiverse.com/thing:1234",
        "https://www.printables.com/model/1234-example",
        "https://www.myminifactory.com/object/3d-print-example-1234",
        "https://space.snapmaker.com/en/model/1234-example",
        "https://www.makeronline.com/en/model/Example/1234.html",
        "https://www.crealitycloud.com/model-detail/6ac6f004729f5ba4b3574093",
        "https://www.nexprint.com/en/models/G1215164",
        "https://www.thangs.com/m/1137615",
        "https://cults3d.com/en/3d-model/art/example",
      ].map((url) => identifySourceModel(url)?.provider),
    ).toEqual([
      "makerworld",
      "thingiverse",
      "printables",
      "myminifactory",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
      "thangs",
      "cults3d",
    ]);
  });

  it("pins settings provider IDs", () => {
    expect([...PROVIDERS]).toEqual([
      "makerworld",
      "printables",
      "thingiverse",
      "myminifactory",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
      "thangs",
      "cults3d",
    ]);
  });

  it("pins browsable collection provider IDs", () => {
    expect([...BROWSABLE_PROVIDERS]).toEqual([
      "makerworld",
      "printables",
      "thingiverse",
      "myminifactory",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
      "thangs",
      "cults3d",
    ]);
  });

  it("pins collection sync provider IDs", () => {
    expect(quotedList("collectionSyncService.ts", /export type SyncProvider =([\s\S]*?);/)).toEqual([
      "makerworld",
      "printables",
      "thingiverse",
      "myminifactory",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
      "thangs",
      "cults3d",
    ]);
  });

  it("pins trending provider IDs", () => {
    expect([...TRENDING_PROVIDERS]).toEqual([
      "printables",
      "makerworld",
      "thangs",
      "makeronline",
      "thingiverse",
      "myminifactory",
      "cults3d",
      "crealitycloud",
      "nexprint",
      "snapmaker",
    ]);
  });

  it("pins author lookup provider IDs", () => {
    expect(quotedList("authorLinkingService.ts", /const LOOKUP_PROVIDERS = \[([\s\S]*?)\] as const/)).toEqual([
      "makerworld",
      "thingiverse",
      "printables",
      "myminifactory",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
      "thangs",
      "cults3d",
    ]);
  });

  it("pins profile provider IDs", () => {
    expect(quotedList("importService.ts", /const PROFILE_PROVIDERS = new Set\(\[([\s\S]*?)\]\)/)).toEqual([
      "makerworld",
      "snapmaker",
      "makeronline",
      "crealitycloud",
      "nexprint",
    ]);
  });

  it("pins client-facing provider error codes", () => {
    const files = ["importService.ts", "makerworldCaptcha.ts", "flaresolverr.ts", "providerSettingsService.ts"];
    const codes = files.flatMap((file) =>
      [...source(file).matchAll(/export const [A-Z0-9_]+_CODE = "([^"]+)"/g)].map((part) => part[1]),
    );
    expect(codes.toSorted()).toEqual(
      [
        "CLOUDFLARE_BLOCKED",
        "MAKERWORLD_AUTH",
        "MAKERWORLD_DOWNLOAD_LIMIT",
        "THANGS_DOWNLOAD_LIMIT",
        "crealitycloud_session",
        "cults3d_session",
        "makeronline_grab",
        "myminifactory_session",
        "nexprint_session",
        "provider_disabled",
        "snapmaker_session",
        "thangs_session",
      ].toSorted(),
    );
    // The dashboard's provider failure is a route-local literal, not a *_CODE constant.
    expect(readFileSync(new URL("../src/routes/dashboard.ts", import.meta.url), "utf8")).toContain(
      '"PROVIDER_UNAVAILABLE"',
    );
    expect(readFileSync(new URL("../src/services/authorService.ts", import.meta.url), "utf8")).toContain(
      '"PROVIDER_ALREADY_LINKED"',
    );
  });

  it("pins provider-specific author lookup problem codes sent in job results", () => {
    expect(quotedList("authorLinkingService.ts", /export type LookupProblem =([\s\S]*?);/)).toEqual([
      "thingiverse_no_token",
      "thingiverse_token_rejected",
      "thingiverse_rate_limited",
      "myminifactory_no_key",
      "myminifactory_key_rejected",
      "myminifactory_rate_limited",
      "makerworld_captcha",
      "makerworld_login_rejected",
      "cults3d_no_key",
      "cults3d_key_rejected",
      "cults3d_rate_limited",
    ]);
  });

  it("pins provider paths in API-token scopes", () => {
    expect(
      API_TOKEN_SCOPES.flatMap(({ id, paths }) =>
        paths
          .filter((path) =>
            /makerworld|thingiverse|printables|myminifactory|snapmaker|makeronline|crealitycloud|nexprint|thangs|cults3d|provider/.test(
              path,
            ),
          )
          .map((path) => `${id}: ${path}`),
      ),
    ).toEqual(["imports: /import/makeronline/waiting"]);
    expect(scopeForPath("/import/makeronline/waiting")).toBe("imports");
  });

  it("pins the Express method and path inventory for provider routes and their routers", () => {
    // Express 4 keeps mounted routers in app._router.stack, and route methods in layer.route.methods.
    // Check every router, then include all routes in these three provider-heavy routers.
    type Layer = {
      regexp: RegExp;
      handle: { stack?: Layer[] };
      route?: { path: string; methods: Record<string, boolean> };
    };
    // eslint-disable-next-line no-underscore-dangle
    const stack = (app as typeof app & { _router: { stack: Layer[] } })._router.stack;
    const routes = stack
      .flatMap((mount) => {
        if (!mount.handle.stack) return [];
        const prefix = mount.regexp.test("/api/__freeze__")
          ? "/api"
          : mount.regexp.test("/api/admin/__freeze__")
            ? "/api/admin"
            : null;
        if (!prefix) throw new Error(`Unknown Express mount: ${mount.regexp}`);
        const wholeRouter = [importsRoutes, settingsRoutes, providerCollectionsRoutes].includes(mount.handle as never);
        return mount.handle.stack.flatMap((layer) => {
          if (!layer.route) return [];
          const path = `${prefix}${layer.route.path}`;
          if (
            !wholeRouter &&
            !/makerworld|thingiverse|printables|myminifactory|snapmaker|makeronline|crealitycloud|nexprint|thangs|cults3d|provider/i.test(
              path,
            )
          )
            return [];
          return Object.keys(layer.route.methods)
            .filter((method) => layer.route!.methods[method])
            .map((method) => `${method.toUpperCase()} ${path}`);
        });
      })
      .toSorted();
    const expected = JSON.parse(
      readFileSync(new URL("./providerRoutes.snapshot.json", import.meta.url), "utf8"),
    ) as string[];
    expect(routes).toEqual(expected);
  });

  it("pins the CategoryOut keys returned by the categories API", async () => {
    const email = `provider-freeze-${Date.now()}@example.com`;
    const registered = await request(app).post("/api/register").send({
      displayName: "Provider freeze",
      email,
      password: "freeze-password-123",
    });
    expect(registered.status).toBe(200);
    const userId = registered.body.user.id as string;
    try {
      const res = await request(app).get("/api/categories").set("Authorization", `Bearer ${registered.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(Object.keys(res.body[0]).toSorted()).toEqual(
        [
          "id",
          "name",
          "tags",
          "parent_id",
          "kind",
          "position",
          "meta_title",
          "meta_description",
          "makerworld_cat_ids",
          "thingiverse_cat_ids",
          "printables_cat_ids",
          "myminifactory_cat_ids",
          "snapmaker_cat_ids",
          "makeronline_cat_ids",
          "crealitycloud_cat_ids",
          "nexprint_cat_ids",
          "thangs_cat_ids",
          "cults3d_cat_ids",
        ].toSorted(),
      );
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
