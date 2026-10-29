// Guards what clients depend on (docs/PROVIDER_DEVELOPMENT.md, "What never changes"): change these literal contracts
// deliberately. Some lists are read from the source text because they aren't exported.
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
import { LOOKUP_PROVIDERS } from "../src/services/authorLinkingService";
import { MANIFESTS, PROVIDER_IDS } from "../src/providers/index.generated";
import { PROFILE_PROVIDERS } from "../src/providers/registry";

const app = createApp();
const source = (file: string) => readFileSync(new URL(`../src/services/${file}`, import.meta.url), "utf8");

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
        "https://makeitreal.eufymake.com/models/be7c829023dd11f19919128e55eac07e/",
        "https://pinshape.com/items/111504-articulated-dragon",
        "https://www.toymakr3d.com/product/8-transformable-sofa-robot",
        "https://www.makerables.com/project/acrylic-knife",
        "https://www.cgtrader.com/3d-print-models/jewelry/ring/lotus-ring-with-opening-and-closing-mechanism",
        "https://grabcad.com/library/arduino-uno-r3-1",
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
      "eufymake",
      "pinshape",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
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
      "eufymake",
      "pinshape",
      "owlcad",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
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
      "eufymake",
      "pinshape",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
    ]);
  });

  it("pins the provider IDs from the manifests, which collection sync and description refetch take", () => {
    expect([...PROVIDER_IDS]).toEqual([
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
      "eufymake",
      "pinshape",
      "owlcad",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
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
      "eufymake",
      "pinshape",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
    ]);
  });

  it("pins author lookup provider IDs", () => {
    expect([...LOOKUP_PROVIDERS]).toEqual([
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
      "eufymake",
      "pinshape",
      "owlcad",
      "toymakr3d",
      "makerables",
      "cgtrader",
      "grabcad",
    ]);
  });

  it("pins profile provider IDs", () => {
    expect([...PROFILE_PROVIDERS]).toEqual(["makerworld", "snapmaker", "makeronline", "crealitycloud", "nexprint"]);
  });

  it("pins client-facing provider error codes", () => {
    const files = ["importService.ts", "flaresolverr.ts", "providerSettingsService.ts"];
    const codes = [
      ...files.flatMap((file) =>
        [...source(file).matchAll(/export const [A-Z0-9_]+_CODE = "([^"]+)"/g)].map((part) => part[1]),
      ),
      ...Object.values(MANIFESTS).flatMap((manifest) => Object.values(manifest.errorCodes)),
    ];
    expect(codes.toSorted()).toEqual(
      [
        "CLOUDFLARE_BLOCKED",
        "MAKERWORLD_AUTH",
        "MAKERWORLD_DOWNLOAD_LIMIT",
        "THANGS_DOWNLOAD_LIMIT",
        "crealitycloud_session",
        "cults3d_session",
        "eufymake_session",
        "pinshape_session",
        "makeronline_grab",
        "myminifactory_session",
        "nexprint_session",
        "owlcad_needs_grab",
        "provider_disabled",
        "snapmaker_session",
        "thangs_session",
        "toymakr3d_session",
        "makerables_session",
        "cgtrader_session",
        "CGTRADER_DOWNLOAD_LIMIT",
        "grabcad_session",
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
    // Each provider's own, in its details (providers/<id>/index.ts, MakerWorld's details.ts).
    const codes = PROVIDER_IDS.flatMap((id) =>
      [`../src/providers/${id}/index.ts`, `../src/providers/${id}/details.ts`].flatMap((file) => {
        let text: string;
        try {
          text = readFileSync(new URL(file, import.meta.url), "utf8");
        } catch {
          return [];
        }
        const details = text.match(/Details: ProviderDetails = \{([\s\S]*?)\n\};/)?.[1] ?? "";
        return [...details.matchAll(new RegExp(`"(${id}_[a-z_]+)"`, "g"))].map((part) => part[1]);
      }),
    );
    expect([...new Set(codes)].toSorted()).toEqual(
      [
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
      ].toSorted(),
    );
  });

  it("pins provider paths in API-token scopes", () => {
    expect(
      API_TOKEN_SCOPES.flatMap(({ id, paths }) =>
        paths
          .filter((path) =>
            /makerworld|thingiverse|printables|myminifactory|snapmaker|makeronline|crealitycloud|nexprint|thangs|cults3d|eufymake|pinshape|provider/.test(
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
        // Providers' own routers are mounted inside one router of theirs (providers/routes.ts).
        const layers = (router: { stack?: Layer[] }): Layer[] =>
          (router.stack ?? []).flatMap((layer) => (layer.route ? [layer] : layers(layer.handle)));
        return layers(mount.handle).flatMap((layer) => {
          if (!layer.route) return [];
          const path = `${prefix}${layer.route.path}`;
          if (
            !wholeRouter &&
            !/makerworld|thingiverse|printables|myminifactory|snapmaker|makeronline|crealitycloud|nexprint|thangs|cults3d|eufymake|pinshape|provider/i.test(
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
          "eufymake_cat_ids",
          "pinshape_cat_ids",
          "owlcad_cat_ids",
          "toymakr3d_cat_ids",
          "makerables_cat_ids",
          "cgtrader_cat_ids",
          "grabcad_cat_ids",
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
