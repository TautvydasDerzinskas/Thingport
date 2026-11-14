import { beforeEach, describe, expect, it, vi } from "vitest";

// Telling the address changes Grab makes itself, picking a print profile on the page, from the user going elsewhere.
const PAGE = "https://makerworld.com/en/models/100-phoenix";
const page = { href: PAGE };
vi.stubGlobal("location", page);

const { holdingNavigation, isImporting, isOwnNavigation, whileImporting } = await import("./runtime");

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

  describe("during an import", () => {
    it("is a profile the site writes after the click's own hold has ended", async () => {
      let late = false;
      await whileImporting(PAGE, async () => {
        // The click, the address not moved yet.
        await holdingNavigation(async () => undefined);
        page.href = `${PAGE}#profileId-11`;
        late = isOwnNavigation();
      });
      expect(late).toBe(true);
    });

    it("is any address on the model, whatever its locale or slug", async () => {
      const seen: boolean[] = [];
      await whileImporting(PAGE, async () => {
        page.href = `${PAGE}#profileId-11`;
        seen.push(isOwnNavigation());
        page.href = "https://makerworld.com/de/models/100-phoenix-v2#profileId-12";
        seen.push(isOwnNavigation());
      });
      expect(seen).toEqual([true, true]);
    });

    it("is never another model", async () => {
      let seen = true;
      await whileImporting(PAGE, async () => {
        page.href = "https://makerworld.com/en/models/200-other";
        seen = isOwnNavigation();
      });
      expect(seen).toBe(false);
    });

    it("is the user's again once the run is over, but for where the run left the address", async () => {
      await whileImporting(PAGE, async () => void (page.href = `${PAGE}#profileId-11`));
      expect(isOwnNavigation()).toBe(true);

      page.href = `${PAGE}#profileId-12`;
      expect(isOwnNavigation()).toBe(false);
    });

    it("is under way for its model only while it runs", async () => {
      let during = false;
      let other = true;
      await whileImporting(PAGE, async () => {
        during = isImporting(`${PAGE}#profileId-3`);
        other = isImporting("https://makerworld.com/en/models/200-other");
      });
      expect([during, other, isImporting(PAGE)]).toEqual([true, false, false]);
    });
  });
});
