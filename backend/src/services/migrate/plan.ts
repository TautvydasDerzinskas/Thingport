import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db";
import { SECRET_SETTING_KEYS, SETTING_KEYS } from "./rules";
import type { SourceFiles } from "./sourceFiles";

/** One of the old instance's people, and who they'd be here. */
export type PlanPerson = {
  id: string;
  email: string;
  name: string;
  role: string;
  owner: boolean;
  models: number;
  /** The account here with the same email, which they're merged into; null for a new account. */
  merge: { id: string; name: string } | null;
};

export type MigratePlan = {
  /** What it was given. */
  dump: { name: string; size: number } | null;
  folder: string;
  /** What the check found, once it has. */
  version?: string | null;
  /** Its database changes, and those of this instance's it lacked, applied to its copy on the way. */
  changes?: { applied: number; added: number };
  counts?: {
    people: number;
    models: number;
    files: number;
    collections: number;
    designs: number;
    widgets: number;
    tools: number;
    syncs: number;
    signIns: number;
    settings: number;
    secrets: number;
  };
  people?: PlanPerson[];
  /** Of the model files its database lists, those the folder doesn't have. */
  missingFiles?: number;
  /** Repository tools installed there and not here: installed first, what they keep for people comes too. */
  toolsNotHere?: { slug: string; name: string }[];
  /** What stays with the old instance, by kind, where it has any. */
  staysBehind?: Record<string, number>;
};

export type PlanProgress = (done: number, total: number) => void;

/** What the working copy, brought up to date, would bring. */
export async function readPlan(
  source: PrismaClient,
  files: SourceFiles,
  onFiles: PlanProgress,
): Promise<Required<Pick<MigratePlan, "counts" | "people" | "missingFiles" | "toolsNotHere" | "staysBehind">>> {
  const users = await source.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isOwner: true,
      _count: { select: { prints: { where: { toolId: null } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const here = await prisma.user.findMany({
    where: { email: { in: users.map((user) => user.email.trim()), mode: "insensitive" } },
    select: { id: true, email: true, displayName: true },
  });
  const byEmail = new Map(here.map((user) => [user.email.trim().toLowerCase(), user]));
  const people: PlanPerson[] = users.map((user) => {
    const match = byEmail.get(user.email.trim().toLowerCase());
    return {
      id: user.id,
      email: user.email,
      name: user.displayName,
      role: user.role,
      owner: user.isOwner,
      models: user._count.prints,
      merge: match ? { id: match.id, name: match.displayName } : null,
    };
  });

  const ownModel = { print: { toolId: null } };
  const [
    models,
    plates,
    printFiles,
    collections,
    designs,
    widgets,
    tools,
    syncs,
    signIns,
    settings,
    secretKeys,
    ai,
    oidc,
  ] = await Promise.all([
    source.print.count({ where: { toolId: null } }),
    source.plate.count({ where: ownModel }),
    source.printFile.count({ where: ownModel }),
    source.collection.count({ where: { toolId: null } }),
    source.studioDesign.count(),
    source.customWidget.count(),
    source.tool.count({ where: { source: "own" } }),
    source.collectionSync.count(),
    source.providerConnection.count({ where: { secret: { not: { equals: null } } } }),
    source.setting.count({ where: { key: { in: [...SETTING_KEYS] } } }),
    source.setting.count({ where: { key: { in: [...SECRET_SETTING_KEYS] } } }),
    source.aiConnection.count(),
    source.oidcProvider.count(),
  ]);

  const missingFiles = await countMissingFiles(source, files, plates + printFiles, onFiles);

  const repoTools = await source.tool.findMany({ where: { source: "repo" }, select: { slug: true, manifest: true } });
  const installed = new Set(
    (await prisma.tool.findMany({ where: { source: "repo" }, select: { slug: true } })).map((tool) => tool.slug),
  );
  const toolsNotHere = repoTools
    .filter((tool) => !installed.has(tool.slug))
    .map((tool) => {
      const manifest = tool.manifest as { name?: unknown } | null;
      return { slug: tool.slug, name: typeof manifest?.name === "string" ? manifest.name : tool.slug };
    });

  const [queued, waiting, chats, partners] = await Promise.all([
    source.importJob.count({ where: { status: { in: ["RUNNING", "QUEUED", "PAUSED"] } } }),
    source.grabImport.count(),
    source.chat.count({ where: { hostPeerId: null } }),
    source.peer.count({ where: { status: { in: ["ACTIVE", "PAUSED"] } } }),
  ]);
  const staysBehind = Object.fromEntries(
    Object.entries({ queued, waiting, chats, partners }).filter(([, count]) => count > 0),
  );

  return {
    counts: {
      people: users.length,
      models,
      files: plates + printFiles,
      collections,
      designs,
      widgets,
      tools,
      syncs,
      signIns,
      settings,
      secrets: secretKeys + ai + oidc,
    },
    people,
    missingFiles,
    toolsNotHere,
    staysBehind,
  };
}

/** How many of the model files the copy lists the folder doesn't have: all of them when it's the wrong folder. */
export async function countMissingFiles(
  source: PrismaClient,
  files: SourceFiles,
  total: number,
  onFiles: PlanProgress,
): Promise<number> {
  let missing = 0;
  let done = 0;
  const step = async (paths: string[]) => {
    for (const relative of paths) if (!(await files.exists(relative))) missing += 1;
    done += paths.length;
    onFiles(done, total);
  };
  for (const table of ["plate", "printFile"] as const) {
    let cursor: string | undefined;
    for (;;) {
      const args = {
        where: { print: { toolId: null } },
        select: { id: true, storagePath: true },
        orderBy: { id: "asc" as const },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };
      const rows = table === "plate" ? await source.plate.findMany(args) : await source.printFile.findMany(args);
      if (!rows.length) break;
      cursor = rows.at(-1)!.id;
      await step(rows.map((row) => row.storagePath));
    }
  }
  return missing;
}
