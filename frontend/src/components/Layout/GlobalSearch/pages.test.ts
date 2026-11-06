import { describe, expect, it } from "vitest";
import { matchPages, SEARCH_PAGES, type PageId } from "./pages";

const EN: Record<PageId, string> = {
  dashboard: "Dashboard",
  models: "Models",
  collections: "Collections",
  explore: "Explore",
  chats: "Chats",
  tags: "Tags",
  downloads: "Downloads",
  tools: "Tools",
  importQueue: "Import queue",
  myModels: "My models",
  profile: "Profile",
  admin: "Administration",
  adminProviders: "Providers",
  adminStorage: "Storage",
  adminAuth: "Auth",
  adminRendering: "Rendering",
  adminTools: "Tools",
  adminAi: "AI",
  adminUsers: "Users",
  adminLogs: "Logs",
  adminConnections: "Connections",
  adminCaptcha: "Captcha",
};
const ids = (query: string, isAdmin = false, explore = false, chats = false) =>
  matchPages(query, EN, isAdmin, explore, chats).map((page) => page.id);

describe("matchPages", () => {
  it("matches the shown name from the first letter, best first", () => {
    expect(ids("d")).toEqual(["dashboard", "downloads"]);
    expect(ids("prof")).toEqual(["profile"]);
    expect(ids("models")[0]).toBe("models");
    expect(ids("my")).toEqual(["myModels"]);
  });

  it("matches the extra terms", () => {
    expect(ids("bridge")).toEqual(["downloads"]);
    expect(ids("account")).toEqual(["profile"]);
    expect(ids("home")).toEqual(["dashboard"]);
  });

  it("leaves admin pages out for everyone but admins", () => {
    expect(ids("admin")).toEqual([]);
    expect(ids("users")).toEqual([]);
    expect(ids("captcha")).toEqual([]);
  });

  it("finds admin pages for admins", () => {
    expect(ids("users", true)).toEqual(["adminUsers"]);
    expect(ids("captcha", true)).toEqual(["adminCaptcha"]);
    expect(ids("health", true)).toEqual(["admin"]);
    expect(ids("oidc", true)).toEqual(["adminAuth"]);
    expect(ids("admin", true)).toHaveLength(SEARCH_PAGES.filter((page) => page.adminOnly).length);
  });

  it("finds the import queue for everyone, by a path that opens it for them", () => {
    expect(ids("import queue")).toContain("importQueue");
    expect(SEARCH_PAGES.find((page) => page.id === "importQueue")?.path).toBe("/import-queue");
  });

  it("marks every admin path as admin-only", () => {
    for (const page of SEARCH_PAGES) expect(page.adminOnly ?? false).toBe(page.path.startsWith("/admin"));
  });
  it("finds Explore only while the sidebar offers it", () => {
    expect(ids("explore")).toEqual([]);
    expect(ids("explore", false, true)).toEqual(["explore"]);
    expect(ids("public collections", false, true)[0]).toBe("explore");
  });

  it("finds Chats only while the sidebar offers it", () => {
    expect(ids("chats")).toEqual([]);
    expect(ids("chats", false, false, true)).toEqual(["chats"]);
    expect(ids("direct messages", false, false, true)[0]).toBe("chats");
  });
});
