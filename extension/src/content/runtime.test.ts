import { beforeEach, describe, expect, it, vi } from "vitest";

// Telling the address changes Grab makes itself, picking a print profile on the page, from the user going elsewhere.
const PAGE = "https://makerworld.com/en/models/100-phoenix";
const page = { href: PAGE };
vi.stubGlobal("location", page);

const { holdingNavigation, isOwnNavigation } = await import("./runtime");

/** Holds while `during` moves the address, and says what the watcher would have concluded meanwhile. */
async function heldWhile(during: () => void): Promise<boolean> {
  let seen = false;
  await holdingNavigation(async () => {
    during();
    seen = isOwnNavigation();
  });
  return seen;
}

describe("own navigation", () => {
  beforeEach(() => {
    page.href = PAGE;
    isOwnNavigation();
  });

  it("is a profile picked on the held page", async () => {
    expect(await heldWhile(() => (page.href = `${PAGE}#profileId-11`))).toBe(true);
  });

  it("is never the user going to another page meanwhile", async () => {
    expect(await heldWhile(() => (page.href = "https://makerworld.com/en/models/200-other"))).toBe(false);
  });

  it("is a profile picked just before the hold ended, noticed once afterwards", async () => {
    await holdingNavigation(async () => void (page.href = `${PAGE}#profileId-11`));
    expect(isOwnNavigation()).toBe(true);

    page.href = `${PAGE}#profileId-12`;
    expect(isOwnNavigation()).toBe(false);
  });

  it("isn't a page the user reached during the hold, once it ends", async () => {
    await holdingNavigation(async () => void (page.href = "https://makerworld.com/en/models/200-other"));
    expect(isOwnNavigation()).toBe(false);
  });
});
