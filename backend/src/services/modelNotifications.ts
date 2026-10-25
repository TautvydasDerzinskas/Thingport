import { prisma } from "../db";
import { createKeyedLock } from "../utils/concurrency";
import { createNotification } from "./notificationService";
import { detectProvider, MANIFESTS } from "../providers/index.generated";

/** Lists names for a notification body, shortening long lists to the first few. */
export function nameList(names: string[], max = 5): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= max) return quoted.join(", ");
  return `${quoted.slice(0, max).join(", ")} and ${quoted.length - max} more`;
}

export type ImportOutcome = "created" | "profile_added" | "already_imported";

const MERGE_WINDOW_MS = 10 * 60 * 1000;
const SINGLE_IMPORT_GROUP = "single-import";
const MAX_GROUP_ITEMS = 200;

type ImportGroup = { key: typeof SINGLE_IMPORT_GROUP; items: { id: string; name: string }[] };

/** The stored JSON is checked, not trusted: anything malformed just starts a new notification. */
function readImportGroup(value: unknown): ImportGroup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { key, items } = value as Record<string, unknown>;
  if (key !== SINGLE_IMPORT_GROUP || !Array.isArray(items)) return null;
  const valid = items.filter(
    (item): item is { id: string; name: string } =>
      Boolean(item) && typeof item.id === "string" && typeof item.name === "string",
  );
  return { key, items: valid };
}

// Two imports finishing together would otherwise both miss, or both rewrite, the same notification.
const withUserLock = createKeyedLock();

// Single imports notify whether or not anyone is still waiting: a closed tab or extension, or a proxy
// timing out, would otherwise lose the result.
export async function notifySingleImport(
  userId: string,
  url: string,
  result: { printId: string; name: string; outcome: ImportOutcome } | { error: string },
): Promise<void> {
  if ("error" in result) {
    await createNotification(userId, {
      type: "import",
      title: "Couldn't import a model",
      body: result.error,
      externalUrl: url,
    });
    return;
  }
  if (result.outcome === "already_imported") {
    await createNotification(userId, {
      type: "import",
      title: `"${result.name}" is already in your library`,
      externalUrl: url,
      internalPath: `/models/${result.printId}`,
    });
    return;
  }
  const item = { id: result.printId, name: result.name };
  await withUserLock(userId, async () => {
    // Imports one after another fold into the newest notification while it's unread and recent, and
    // nothing else has come in since.
    const latest = await prisma.notification.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const group = readImportGroup(latest?.group);
    if (latest && group && !latest.readAt && Date.now() - latest.createdAt.getTime() < MERGE_WINDOW_MS) {
      const items = [...group.items.filter((i) => i.id !== item.id), item].slice(-MAX_GROUP_ITEMS);
      await prisma.notification.update({
        where: { id: latest.id },
        data: {
          title: items.length === 1 ? latest.title : `Imported ${items.length} models`,
          body: items.length === 1 ? latest.body : `${nameList(items.map((i) => i.name))}.`,
          externalUrl: items.length === 1 ? latest.externalUrl : null,
          internalPath: items.length === 1 ? latest.internalPath : "/models",
          group: { key: SINGLE_IMPORT_GROUP, items },
        },
      });
      return;
    }
    await createNotification(userId, {
      type: "import",
      title:
        result.outcome === "profile_added"
          ? `Added another print profile to "${result.name}"`
          : `Imported "${result.name}"`,
      externalUrl: url,
      internalPath: `/models/${result.printId}`,
      group: { key: SINGLE_IMPORT_GROUP, items: [item] },
    });
  });
}

/** One notification for a whole upload: a single request's, or a browser batch's summary. */
export async function notifyUpload(
  userId: string,
  uploaded: { id: string; name: string }[],
  failed: { names: string[]; reason?: string } = { names: [] },
): Promise<void> {
  const total = uploaded.length + failed.names.length;
  if (!total) return;
  if (!uploaded.length) {
    await createNotification(userId, {
      type: "upload",
      title: total === 1 ? "Couldn't upload a model" : `Couldn't upload ${total} models`,
      body: [nameList(failed.names), failed.reason].filter(Boolean).join(": "),
    });
    return;
  }
  const title =
    uploaded.length === 1 && !failed.names.length
      ? `Uploaded "${uploaded[0].name}"`
      : failed.names.length
        ? `Uploaded ${uploaded.length} of ${total} models`
        : `Uploaded ${uploaded.length} models`;
  const parts: string[] = [];
  if (uploaded.length > 1) parts.push(`${nameList(uploaded.map((p) => p.name))}.`);
  if (failed.names.length) {
    const reason = failed.reason ? `: ${failed.reason.replace(/\.$/, "")}` : "";
    parts.push(`Couldn't upload ${nameList(failed.names)}${reason}.`);
  }
  await createNotification(userId, {
    type: "upload",
    title,
    body: parts.join(" ") || null,
    internalPath: uploaded.length === 1 ? `/models/${uploaded[0].id}` : "/models",
  });
}

/** A client-driven run of single imports, summed up once at its end. */
export async function notifyImportRun(
  userId: string,
  run: {
    sourceUrl: string;
    total: number;
    prints: { id: string; name: string }[];
    collectionId: string | null;
    stopped: string | null;
  },
): Promise<void> {
  const imported = run.prints.length;
  const parts: string[] = [];
  if (imported) parts.push(`${nameList(run.prints.map((p) => p.name))}.`);
  if (run.stopped) parts.push(`Stopped early: ${run.stopped}`);
  const site = detectProvider(run.sourceUrl);
  await createNotification(userId, {
    type: "import",
    title: `Imported ${imported} of ${run.total} models${site ? ` from ${MANIFESTS[site].name}` : ""}`,
    body: parts.join(" ") || null,
    externalUrl: run.sourceUrl,
    internalPath: run.collectionId
      ? `/models/collections/${run.collectionId}`
      : imported === 1
        ? `/models/${run.prints[0].id}`
        : null,
  });
}
