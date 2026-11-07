import type { Router } from "express";
import { describe, expect, it } from "vitest";
import chatRoutes from "../src/routes/chats";
import socialRoutes from "../src/routes/social";
import { SOCIAL_SURFACES } from "../src/federation/socialSurfaces";

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: unknown };
};

// A route on a child router would slip past the list below: there's none, and one added fails here until this
// walks into it with its mount path.
function routesOf(router: Router): string[] {
  return (router.stack as unknown as Layer[]).flatMap((layer) => {
    if (layer.name === "router" || Array.isArray(layer.handle?.stack)) {
      throw new Error("A social router mounts a child router: list its routes here too");
    }
    return layer.route
      ? Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route!.path}`)
      : [];
  });
}

// Everything social has to work for partners' people too: a social route nobody has thought about federating fails
// here. Decide how it crosses (or why it stays here) in src/federation/socialSurfaces.ts.
describe("social routes and connected instances", () => {
  const routes = [...routesOf(socialRoutes), ...routesOf(chatRoutes)];

  it("says how every social route crosses to partners", () => {
    // Any listed here: add them to src/federation/socialSurfaces.ts.
    expect(routes.filter((route) => !(route in SOCIAL_SURFACES))).toEqual([]);
  });

  it("lists no route that's gone", () => {
    // Any listed here: remove them from src/federation/socialSurfaces.ts.
    expect(Object.keys(SOCIAL_SURFACES).filter((route) => !routes.includes(route))).toEqual([]);
  });

  it("gives every plan its reason", () => {
    const unexplained = Object.entries(SOCIAL_SURFACES)
      .filter(([, plan]) => (plan.kind === "local" ? plan.why : plan.how).trim().length <= 10)
      .map(([route]) => route);
    expect(unexplained).toEqual([]);
  });
});
