import type { Peer, Prisma, RemoteCollection, RemoteModel, RemotePerson } from "@prisma/client";
import { prisma } from "../db";
import { mediaAddress } from "./media";

/** What Explore shows of partners, from the index (remoteIndex.ts): only ACTIVE partners', pictures through this
 *  instance (media.ts). Read-only: downloading and copying come later. */

export type InstanceOut = { id: string; name: string; origin: string; http: boolean };

export type RemoteOwnerOut = { id: string; display_name: string; avatar_url: string | null };

export type RemotePersonOut = RemoteOwnerOut & {
  /** username@their-instance, when they have a username. */
  handle: string | null;
  collection_count: number;
  model_count: number;
  shared_at: string | null;
  instance: InstanceOut;
};

export type RemoteModelCardOut = {
  id: string;
  title: string;
  thumb_url: string | null;
  file_count: number;
  shared_at: string | null;
  owner: RemoteOwnerOut;
  instance: InstanceOut;
};

export type RemoteCollectionCardOut = {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  cover_urls: string[];
  updated_at: string | null;
  owner: RemoteOwnerOut;
  instance: InstanceOut;
};

export type RemoteOverviewOut = {
  people: RemotePersonOut[];
  recent_models: RemoteModelCardOut[];
  recent_collections: RemoteCollectionCardOut[];
};

const PEOPLE = 48;
const RECENT_MODELS = 12;
const RECENT_COLLECTIONS = 8;
const ACTIVE = { status: "ACTIVE" } as const;

const instanceOut = (peer: Pick<Peer, "id" | "name" | "origin">): InstanceOut => ({
  id: peer.id,
  name: peer.name ?? new URL(peer.origin).host,
  origin: peer.origin,
  http: peer.origin.startsWith("http:"),
});

const ownerOut = (person: Pick<RemotePerson, "id" | "displayName" | "avatarUrl">): RemoteOwnerOut => ({
  id: person.id,
  display_name: person.displayName,
  avatar_url: mediaAddress(person.avatarUrl),
});

type PersonRow = RemotePerson & { peer: Peer };
type ModelRow = RemoteModel & { peer: Peer; person: RemotePerson };
type CollectionRow = RemoteCollection & { peer: Peer; person: RemotePerson };

function personOut(row: PersonRow): RemotePersonOut {
  return {
    ...ownerOut(row),
    handle: row.username ? `${row.username}@${new URL(row.peer.origin).host}` : null,
    collection_count: row.collectionCount,
    model_count: row.modelCount,
    shared_at: row.sharedAt?.toISOString() ?? null,
    instance: instanceOut(row.peer),
  };
}

function modelCardOut(row: ModelRow): RemoteModelCardOut {
  return {
    id: row.id,
    title: row.title,
    thumb_url: mediaAddress(row.images[0]),
    file_count: Array.isArray(row.files) ? row.files.length : 0,
    shared_at: row.sharedAt?.toISOString() ?? null,
    owner: ownerOut(row.person),
    instance: instanceOut(row.peer),
  };
}

/** Collections with what's in them, as far as the index has it, and a few of their pictures: only their covers'
 *  pictures are read, however many models they hold. */
async function collectionCardsOut(rows: CollectionRow[]): Promise<RemoteCollectionCardOut[]> {
  // What's in a collection is its owner's own models.
  const owners = [...new Set(rows.map((row) => row.personId))];
  const indexed = owners.length
    ? await prisma.remoteModel.findMany({ where: { personId: { in: owners } }, select: { apId: true, personId: true } })
    : [];
  const have = new Set(indexed.map((model) => `${model.personId} ${model.apId}`));
  const inIt = new Map(
    rows.map((row) => [row.id, row.modelApIds.filter((apId) => have.has(`${row.personId} ${apId}`))]),
  );
  // A few more than the four shown, as some have no picture.
  const candidates = [...new Set(rows.flatMap((row) => inIt.get(row.id)!.slice(0, 8)))];
  const pictures = candidates.length
    ? await prisma.remoteModel.findMany({
        where: { apId: { in: candidates }, personId: { in: owners } },
        select: { apId: true, images: true },
      })
    : [];
  const firstPicture = new Map(pictures.map((model) => [model.apId, model.images[0]]));
  return rows.map((row) => {
    const apIds = inIt.get(row.id)!;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      item_count: apIds.length,
      cover_urls: apIds
        .slice(0, 8)
        .flatMap((apId) => mediaAddress(firstPicture.get(apId)) ?? [])
        .slice(0, 4),
      updated_at: row.updatedAt?.toISOString() ?? null,
      owner: ownerOut(row.person),
      instance: instanceOut(row.peer),
    };
  });
}

/** Partners there's something of to show, for Explore's filter. */
export async function instancesOut(): Promise<InstanceOut[]> {
  const peers = await prisma.peer.findMany({
    where: { ...ACTIVE, people: { some: {} } },
    orderBy: { connectedAt: "asc" },
  });
  return peers.map(instanceOut);
}

/** Explore's rows of what partners share, from one partner (`peerId`) or all. */
export async function remoteOverview(peerId: string | null): Promise<RemoteOverviewOut> {
  const peer: Prisma.PeerWhereInput = peerId ? { ...ACTIVE, id: peerId } : ACTIVE;
  const [people, models, collections] = await Promise.all([
    prisma.remotePerson.findMany({
      where: { peer },
      orderBy: [{ sharedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: PEOPLE,
      include: { peer: true },
    }),
    prisma.remoteModel.findMany({
      where: { peer },
      orderBy: [{ sharedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: RECENT_MODELS,
      include: { peer: true, person: true },
    }),
    prisma.remoteCollection.findMany({
      where: { peer },
      orderBy: [{ updatedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: RECENT_COLLECTIONS,
      include: { peer: true, person: true },
    }),
  ]);
  return {
    people: people.map(personOut),
    recent_models: models.map(modelCardOut),
    recent_collections: await collectionCardsOut(collections),
  };
}

export type RemotePersonPageOut = {
  person: RemotePersonOut & {
    bio: string | null;
    links: string[];
    background_url: string | null;
    cover_preset: string | null;
    cover_position_y: number;
    joined_at: string | null;
  };
  collections: RemoteCollectionCardOut[];
};

export async function remotePerson(id: string): Promise<RemotePersonPageOut | null> {
  const row = await prisma.remotePerson.findFirst({ where: { id, peer: ACTIVE }, include: { peer: true } });
  if (!row) return null;
  const collections = await prisma.remoteCollection.findMany({
    where: { personId: row.id },
    orderBy: [{ updatedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    include: { peer: true, person: true },
  });
  return {
    person: {
      ...personOut(row),
      bio: row.bio,
      links: row.links,
      background_url: mediaAddress(row.coverUrl),
      cover_preset: row.coverUrl ? null : row.coverPreset,
      cover_position_y: row.coverPositionY,
      joined_at: row.joinedAt?.toISOString() ?? null,
    },
    collections: await collectionCardsOut(collections),
  };
}

/** A page of a partner's person's models, the latest shared first. */
export async function remotePersonModels(
  id: string,
  limit: number,
  offset: number,
): Promise<{ models: RemoteModelCardOut[]; total: number } | null> {
  const person = await prisma.remotePerson.findFirst({ where: { id, peer: ACTIVE }, select: { id: true } });
  if (!person) return null;
  const where = { personId: person.id };
  const [rows, total] = await Promise.all([
    prisma.remoteModel.findMany({
      where,
      orderBy: [{ sharedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: offset,
      take: limit,
      include: { peer: true, person: true },
    }),
    prisma.remoteModel.count({ where }),
  ]);
  return { models: rows.map(modelCardOut), total };
}

export type RemoteModelOut = RemoteModelCardOut & {
  description: string | null;
  images: string[];
  files: { name: string; size: number | null; media_type: string | null }[];
  updated_at: string | null;
  owner_handle: string | null;
  /** Its owner's public collections it's in. */
  collections: { id: string; name: string }[];
};

export async function remoteModel(id: string): Promise<RemoteModelOut | null> {
  const row = await prisma.remoteModel.findFirst({
    where: { id, peer: ACTIVE },
    include: { peer: true, person: true },
  });
  if (!row) return null;
  const collections = await prisma.remoteCollection.findMany({
    where: { personId: row.personId, modelApIds: { has: row.apId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const files = (Array.isArray(row.files) ? row.files : []) as {
    name?: unknown;
    size?: unknown;
    mediaType?: unknown;
  }[];
  return {
    ...modelCardOut(row),
    description: row.description,
    images: row.images.flatMap((url) => mediaAddress(url) ?? []),
    files: files.map((file) => ({
      name: typeof file.name === "string" ? file.name : "file",
      size: typeof file.size === "number" ? file.size : null,
      media_type: typeof file.mediaType === "string" ? file.mediaType : null,
    })),
    updated_at: row.updatedAt?.toISOString() ?? null,
    owner_handle: row.person.username ? `${row.person.username}@${new URL(row.peer.origin).host}` : null,
    collections,
  };
}

export type RemoteCollectionPageOut = {
  collection: RemoteCollectionCardOut;
  /** A page of them, in the collection's own order; `total` counts all the index has. */
  models: RemoteModelCardOut[];
  total: number;
};

export async function remoteCollection(
  id: string,
  limit: number,
  offset: number,
): Promise<RemoteCollectionPageOut | null> {
  const row = await prisma.remoteCollection.findFirst({
    where: { id, peer: ACTIVE },
    include: { peer: true, person: true },
  });
  if (!row) return null;
  const [collection] = await collectionCardsOut([row]);
  const indexed = await prisma.remoteModel.findMany({
    where: { personId: row.personId, apId: { in: row.modelApIds } },
    select: { apId: true },
  });
  const have = new Set(indexed.map((model) => model.apId));
  const pageIds = row.modelApIds.filter((apId) => have.has(apId)).slice(offset, offset + limit);
  const models = await prisma.remoteModel.findMany({
    where: { personId: row.personId, apId: { in: pageIds } },
    include: { peer: true, person: true },
  });
  const order = new Map(pageIds.map((apId, index) => [apId, index]));
  return {
    collection,
    models: models.toSorted((a, b) => (order.get(a.apId) ?? 0) - (order.get(b.apId) ?? 0)).map(modelCardOut),
    total: collection.item_count,
  };
}
