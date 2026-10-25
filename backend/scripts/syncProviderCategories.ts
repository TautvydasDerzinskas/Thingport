// Refreshes frontend/src/components/categoryMapping/providerCategories.json: every provider's own category tree, as id, name and parent, so
// the category mapping dialog can show names instead of ids. Run from backend/ when a site changes its categories:
//
//   npx tsx scripts/syncProviderCategories.ts
//
// Thingiverse and MyMiniFactory list their categories only with an API key, so it reads this instance's (from the
// database in backend/.env, as the app does). Cults3D's API needs a user's own key: CULTS3D_NICK and CULTS3D_API_KEY,
// or else the first user's who set one. The rest are public.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { browserFetch } from "../src/utils/browserFetch";
import { getMyminifactoryApiKey, getThingiverseAccessToken } from "../src/services/settingsService";
import { cults3dNumericId } from "../src/providers/cults3d/api";
import { prisma } from "../src/db";

type Entry = { id: string; name: string; parent: string | null };
type Node = Record<string, unknown>;

const OUT = path.resolve(__dirname, "../../frontend/src/components/categoryMapping/providerCategories.json");

const isNode = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);
const nodes = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isNode) : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Walks a nested tree, depth first, in the site's own order; ids seen before are skipped. */
function flatten(
  roots: Node[],
  read: (node: Node) => { id: unknown; name: unknown; children: unknown },
  parent: string | null = null,
  out: Entry[] = [],
  seen = new Set<string>(),
): Entry[] {
  for (const node of roots) {
    const { id, name, children } = read(node);
    const key = id == null ? "" : String(id);
    const label = text(name);
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, name: label, parent });
    flatten(nodes(children), read, key, out, seen);
  }
  return out;
}

async function json(
  url: string,
  init: { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> } = {},
) {
  const res = await browserFetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  // Without the query string, which can carry an API key.
  if (!res.ok) throw new Error(`${url.split("?")[0]}: HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function nextData(url: string): Promise<Node> {
  const res = await browserFetch(url, { headers: { Accept: "text/html" } });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${url}: no page data (HTTP ${res.status})`);
  return JSON.parse(m[1]) as Node;
}

const FETCHERS: Record<string, () => Promise<Entry[]>> = {
  async makerworld() {
    const data = await nextData("https://makerworld.com/en/3d-models");
    const tree = (data.props as Node)?.pageProps as Node;
    return flatten(nodes((tree.categoryTree as Node)?.children), (n) => ({
      id: n.id,
      name: n.name,
      children: n.children,
    }));
  },
  async thingiverse() {
    const token = await getThingiverseAccessToken();
    if (!token) throw new Error("no Thingiverse App Token on this instance");
    const headers = { Authorization: `Bearer ${token}` };
    const top = nodes(await json("https://api.thingiverse.com/categories", { headers }));
    const out: Entry[] = [];
    for (const category of top) {
      const id = String(category.id);
      out.push({ id, name: text(category.name), parent: null });
      const detail = await json(`https://api.thingiverse.com/categories/${text(category.slug)}`, { headers });
      for (const child of nodes(isNode(detail) ? detail.children : null)) {
        out.push({ id: String(child.id), name: text(child.name), parent: id });
      }
    }
    return out;
  },
  async printables() {
    const data = await json("https://api.printables.com/graphql/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ categories { id name path { id } } }" }),
    });
    const categories = nodes(((data as Node).data as Node)?.categories);
    return categories.map((c) => {
      const trail = nodes(c.path);
      return {
        id: String(c.id),
        name: text(c.name),
        parent: trail.length > 1 ? String(trail[trail.length - 2].id) : null,
      };
    });
  },
  async myminifactory() {
    const key = await getMyminifactoryApiKey();
    if (!key) throw new Error("no MyMiniFactory API key on this instance");
    // Pages its top-level categories, 30 at a time unless asked for more.
    const data = await json(
      `https://www.myminifactory.com/api/v2/categories?key=${encodeURIComponent(key)}&per_page=1000`,
    );
    return flatten(nodes((data as Node).items), (n) => ({
      id: n.id,
      name: n.name,
      children: isNode(n.children) ? n.children.items : n.children,
    }));
  },
  async snapmaker() {
    const data = await json("https://api-models.snapmaker.com/api/model/category/tree");
    // Its one root, "Categories", isn't a category of its own.
    const root = nodes((data as Node).data)[0];
    return flatten(nodes(root?.children), (n) => ({ id: n.id, name: n.nameKey, children: n.children }));
  },
  async makeronline() {
    const data = await json("https://www.makeronline.com/api/category/options");
    return flatten(nodes((data as Node).data), (n) => ({ id: n.id, name: n.name, children: n.children }));
  },
  async crealitycloud() {
    const data = await json("https://www.crealitycloud.com/api/cxy/v2/common/categoryList", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.crealitycloud.com",
        __cxy_app_id_: "cxy-gen2",
        __cxy_app_ver_: "7.3.28",
        __cxy_app_ch_: "Chrome 152.0.0.0",
        __cxy_brand_: "creality",
        __cxy_platform_: "2",
        __cxy_os_lang_: "0",
        __cxy_os_ver_: "macOS 10.15.7",
        __cxy_timezone_: "0",
        __cxy_duid_: randomUUID(),
        __cxy_requestid_: randomUUID(),
      },
      body: JSON.stringify({ type: 7 }),
    });
    const list = ((data as Node).result as Node)?.list;
    return flatten(nodes(list), (n) => ({ id: n.id, name: n.en_name || n.name, children: n.children }));
  },
  async nexprint() {
    const data = await json("https://www.nexprint.com/gateway/api/v1/model-library-server/model-classification/tree", {
      headers: { "client-id": "Nexprint", "user-lang": "en" },
    });
    return flatten(nodes((data as Node).data), (n) => ({
      id: n.id,
      name: n.classificationNameEn || n.name,
      children: n.children,
    }));
  },
  async thangs() {
    // Every page carries the tree; a missing one is the lightest.
    const data = await nextData("https://thangs.com/3d-models");
    const appData = (data.props as Node)?.appData as Node;
    const root = (appData?.["categories/root"] as Node)?.categories;
    const out: Entry[] = [];
    for (const category of nodes(root)) {
      const name = text(category.name);
      out.push({ id: name, name, parent: null });
      for (const sub of Array.isArray(category.subcategories) ? category.subcategories : []) {
        if (typeof sub === "string" && sub !== "All") out.push({ id: `${name}/${sub}`, name: sub, parent: name });
      }
    }
    return out;
  },
  async cults3d() {
    const user = await prisma.user.findFirst({
      where: { cults3dNick: { not: null }, cults3dApiKey: { not: null } },
      select: { cults3dNick: true, cults3dApiKey: true },
    });
    const nick = process.env.CULTS3D_NICK ?? user?.cults3dNick;
    const key = process.env.CULTS3D_API_KEY ?? user?.cults3dApiKey;
    if (!nick || !key) throw new Error("needs CULTS3D_NICK and CULTS3D_API_KEY, or a user with a Cults3D API key");
    const res = await fetch("https://cults3d.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${nick}:${key}`).toString("base64")}`,
      },
      body: JSON.stringify({ query: "{ categories(safe: false) { id name children { id name } } }" }),
    });
    if (!res.ok) throw new Error(`Cults3D: HTTP ${res.status}`);
    const data = ((await res.json()) as Node).data as Node;
    // Its ids are base64 of "Category/<number>"; the number is what imports carry.
    return flatten(nodes(data?.categories), (node) => ({
      id: cults3dNumericId(node.id),
      name: node.name,
      children: node.children,
    }));
  },
};

(async () => {
  const catalog: Record<string, Entry[]> = {};
  let failed = false;
  for (const [provider, fetch] of Object.entries(FETCHERS)) {
    try {
      const entries = await fetch();
      // A changed payload shape reads as no categories rather than an error.
      if (!entries.length) throw new Error("no categories in the response");
      catalog[provider] = entries;
      console.log(`${provider}: ${catalog[provider].length} categories`);
    } catch (err) {
      failed = true;
      console.error(`${provider}: failed --`, err instanceof Error ? err.message : err);
    }
  }
  await prisma.$disconnect();
  if (failed) {
    console.error("Not written: every provider has to come through, or its names would be lost.");
    process.exit(1);
  }
  writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
})();
