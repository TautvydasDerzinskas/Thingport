import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, type DefaultCategoryNode } from "../src/seedData/defaultCategories";
import { MANIFESTS, PROVIDER_IDS } from "../src/providers/index.generated";
import { PROVIDERS } from "../src/providers/registry";

// Validates the static starter tree against the constraints enforced on real categories.

function flatten(nodes: DefaultCategoryNode[], depth = 0): Array<{ node: DefaultCategoryNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children ?? [], depth + 1)]);
}

function duplicateSiblingNames(nodes: DefaultCategoryNode[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const node of nodes) {
    if (seen.has(node.name)) dupes.push(node.name);
    seen.add(node.name);
    if (node.children) dupes.push(...duplicateSiblingNames(node.children));
  }
  return dupes;
}

describe("DEFAULT_CATEGORIES", () => {
  const all = flatten(DEFAULT_CATEGORIES);

  it("is non-empty", () => {
    expect(DEFAULT_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("gives every node a non-empty name", () => {
    for (const { node } of all) {
      expect(node.name.trim()).not.toBe("");
    }
  });

  it("has no duplicate names among siblings", () => {
    expect(duplicateSiblingNames(DEFAULT_CATEGORIES)).toEqual([]);
  });
});

describe("each provider's categories.json", () => {
  const paths = new Set<string>();
  const walk = (nodes: DefaultCategoryNode[], parent: string[]) => {
    for (const node of nodes) {
      const path = [...parent, node.name];
      paths.add(path.join("/"));
      walk(node.children ?? [], path);
    }
  };
  walk(DEFAULT_CATEGORIES, []);

  for (const id of PROVIDER_IDS) {
    it(`${id}: names only starter categories, with ids its routes would take`, () => {
      const starter = PROVIDERS[id].starterCategories;
      expect(Object.keys(starter).filter((path) => !paths.has(path))).toEqual([]);
      const byPath = MANIFESTS[id].capabilities.categoryIds === "path";
      // As routes/categories.ts takes them: paths of non-blank names, or positive whole numbers of up to 16 digits.
      const valid = (siteId: number | string) =>
        byPath
          ? String(siteId)
              .split("/")
              .every((part) => part && part.trim() === part)
          : /^[1-9]\d{0,15}$/.test(String(siteId)) && Number.isSafeInteger(Number(siteId));
      expect(Object.values(starter).filter((ids) => !ids.length)).toEqual([]);
      expect(
        Object.values(starter)
          .flat()
          .filter((siteId) => !valid(siteId)),
      ).toEqual([]);
    });
  }
});
