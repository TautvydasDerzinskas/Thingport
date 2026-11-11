import { licenseOut, type LicenseOut } from "../services/licenseService";
import type { RemoteModelDetails } from "./remoteIndex";
import { buildImportSourceUrl } from "../services/importService";
import type { Peer, Prisma, RemoteCollection, RemoteModel, RemotePerson } from "@prisma/client";
import { canSeeRemoteModel } from "./sharedCollections";
import type { RemoteOriginOut } from "../dto";
import { prisma } from "../db";
import { PERSON_COLLECTIONS_PAGE } from "../services/socialService";
import { mediaAddress } from "./media";
import { libraryCopyOfRemote, type RemoteSource } from "./remoteCopy";
import { fileKey, filesOf } from "./remoteFiles";
import { isFederationLive } from "./settings";

/** What Explore shows of partners, from the index (remoteIndex.ts): only ACTIVE partners', pictures through this
 *  instance (media.ts), files through it too (remoteFiles.ts). */

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
  /** What partners' people shared with the viewer, the latest shared with them first, with when. */
  shared_with_you: (RemoteCollectionCardOut & { shared_at: string })[];
  /** How many there are: the rest come a page at a time (`remoteSharedWithYou`). */
  shared_with_you_total: number;
};

const PEOPLE = 48;
const RECENT_MODELS = 12;
const RECENT_COLLECTIONS = 8;
// What partners' people shared with the viewer: on Explore's first page, then a page at a time.
const SHARED_WITH_YOU = 48;
export const REMOTE_SHARED_PAGE = 24;
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
    ? await prisma.remoteModel.findMany({
        where: { personId: { in: owners } },
        select: { apId: true, personId: true, limited: true },
      })
    : [];
  // A collection shared openly holds only what's shared openly there: a model kept for a collection shared with some
  // people here is theirs to see, even where the open one still names it. One shared with the viewer holds it all.
  const open = new Set(indexed.filter((model) => !model.limited).map((model) => `${model.personId} ${model.apId}`));
  const all = new Set(indexed.map((model) => `${model.personId} ${model.apId}`));
  const inIt = new Map(
    rows.map((row) => [
      row.id,
      row.modelApIds.filter((apId) => (row.limited ? all : open).has(`${row.personId} ${apId}`)),
    ]),
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
    // Someone it shares: a partner known only from chats has nothing to show here.
    where: { ...ACTIVE, people: { some: { listed: true } } },
    orderBy: { connectedAt: "asc" },
  });
  return peers.map(instanceOut);
}

/** A page of what partners' people (`peerId`'s, or every connected partner's) shared with `viewerId`, the latest
 *  shared with them first, each with when; and how many there are. */
export async function remoteSharedWithYou(
  peerId: string | null,
  viewerId: string,
  limit: number,
  offset: number,
): Promise<{ collections: (RemoteCollectionCardOut & { shared_at: string })[]; total: number }> {
  const peer: Prisma.PeerWhereInput = peerId ? { ...ACTIVE, id: peerId } : ACTIVE;
  const where = {
    userId: viewerId,
    collection: { peer, limited: true },
  } satisfies Prisma.RemoteCollectionViewerWhereInput;
  const [views, total] = await Promise.all([
    prisma.remoteCollectionViewer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { collectionId: "asc" }],
      take: limit,
      skip: offset,
      include: { collection: { include: { peer: true, person: true } } },
    }),
    prisma.remoteCollectionViewer.count({ where }),
  ]);
  const cards = await collectionCardsOut(views.map((view) => view.collection));
  return {
    collections: cards.map((card, index) => ({ ...card, shared_at: views[index].createdAt.toISOString() })),
    total,
  };
}

/** Explore's rows of what partners share, from one partner (`peerId`) or all, and what their people shared with
 *  `viewerId`. What was shared with some people here only is never on the other rows. */
export async function remoteOverview(peerId: string | null, viewerId: string): Promise<RemoteOverviewOut> {
  const peer: Prisma.PeerWhereInput = peerId ? { ...ACTIVE, id: peerId } : ACTIVE;
  const [people, models, collections, sharedWithViewer] = await Promise.all([
    prisma.remotePerson.findMany({
      where: { peer, listed: true },
      orderBy: [{ sharedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: PEOPLE,
      include: { peer: true },
    }),
    prisma.remoteModel.findMany({
      where: { peer, limited: false },
      orderBy: [{ sharedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: RECENT_MODELS,
      include: { peer: true, person: true },
    }),
    prisma.remoteCollection.findMany({
      where: { peer, limited: false },
      orderBy: [{ updatedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: RECENT_COLLECTIONS,
      include: { peer: true, person: true },
    }),
    remoteSharedWithYou(peerId, viewerId, SHARED_WITH_YOU, 0),
  ]);
  return {
    people: people.map(personOut),
    recent_models: models.map(modelCardOut),
    recent_collections: await collectionCardsOut(collections),
    shared_with_you: sharedWithViewer.collections,
    shared_with_you_total: sharedWithViewer.total,
  };
}

/** Whether `viewerId` may open a partner's collection: one public there, or shared with them. */
async function canSeeCollection(row: { id: string; limited: boolean }, viewerId: string): Promise<boolean> {
  if (!row.limited) return true;
  return (await prisma.remoteCollectionViewer.count({ where: { collectionId: row.id, userId: viewerId } })) > 0;
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
  /** The first page of them; the rest from GET /explore/elsewhere/person/:id/collections. */
  collections: RemoteCollectionCardOut[];
  /** How many of them this instance has: what's listed, which can be fewer than they said they share. */
  collections_total: number;
};

const collectionsOrder: Prisma.RemoteCollectionOrderByWithRelationInput[] = [
  { updatedAt: { sort: "desc", nulls: "last" } },
  { id: "asc" },
];

export async function remotePerson(id: string): Promise<RemotePersonPageOut | null> {
  const row = await prisma.remotePerson.findFirst({
    where: { id, listed: true, peer: ACTIVE },
    include: { peer: true },
  });
  if (!row) return null;
  const [collections, total] = await Promise.all([
    prisma.remoteCollection.findMany({
      where: { personId: row.id, limited: false },
      orderBy: collectionsOrder,
      take: PERSON_COLLECTIONS_PAGE,
      include: { peer: true, person: true },
    }),
    prisma.remoteCollection.count({ where: { personId: row.id, limited: false } }),
  ]);
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
    collections_total: total,
  };
}

/** A page of a partner's person's collections, in their page's order. */
export async function remotePersonCollections(
  id: string,
  limit: number,
  offset: number,
): Promise<{ collections: RemoteCollectionCardOut[]; total: number } | null> {
  const person = await prisma.remotePerson.findFirst({
    where: { id, listed: true, peer: ACTIVE },
    select: { id: true },
  });
  if (!person) return null;
  const where = { personId: person.id, limited: false };
  const [rows, total] = await Promise.all([
    prisma.remoteCollection.findMany({
      where,
      orderBy: collectionsOrder,
      skip: offset,
      take: limit,
      include: { peer: true, person: true },
    }),
    prisma.remoteCollection.count({ where }),
  ]);
  return { collections: await collectionCardsOut(rows), total };
}

/** A page of a partner's person's models, the latest shared first. */
export async function remotePersonModels(
  id: string,
  limit: number,
  offset: number,
): Promise<{ models: RemoteModelCardOut[]; total: number } | null> {
  const person = await prisma.remotePerson.findFirst({
    where: { id, listed: true, peer: ACTIVE },
    select: { id: true },
  });
  if (!person) return null;
  const where = { personId: person.id, limited: false };
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
  /** As its owner's library has it; absent when its partner doesn't say. */
  license?: LicenseOut | null;
  creator?: string | null;
  source_provider?: string | null;
  source_url?: string | null;
  description: string | null;
  images: string[];
  /** `url` is API-relative, through this instance; null when the partner gave no address for it. */
  files: { name: string; folder: string | null; size: number | null; media_type: string | null; url: string | null }[];
  updated_at: string | null;
  owner_handle: string | null;
  /** Its owner's public collections it's in. */
  collections: { id: string; name: string }[];
  /** The viewer's own copy of it, if they made one. */
  library_copy_id: string | null;
};

/** Where a partner's model's file is downloaded through this instance, by a key from its address there; its name
 *  last, as slicers want. */
export const remoteFileRoute = (modelId: string, url: string, name: string) =>
  `/explore/elsewhere/model/${modelId}/files/${fileKey(url)}/${encodeURIComponent(name)}`;

export async function remoteModel(id: string, viewerId: string): Promise<RemoteModelOut | null> {
  const row = await prisma.remoteModel.findFirst({
    where: { id, peer: ACTIVE },
    include: { peer: true, person: true },
  });
  if (!row || !(await canSeeRemoteModel(row, viewerId))) return null;
  const collections = await prisma.remoteCollection.findMany({
    where: {
      personId: row.personId,
      modelApIds: { has: row.apId },
      OR: [{ limited: false }, { viewers: { some: { userId: viewerId } } }],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return {
    ...modelCardOut(row),
    description: row.description,
    images: row.images.flatMap((url) => mediaAddress(url) ?? []),
    files: filesOf(row, row.peer.origin).map((file) => ({
      name: file.name,
      folder: file.folder ?? null,
      size: file.size,
      media_type: file.mediaType,
      url: file.url ? remoteFileRoute(row.id, file.url, file.name) : null,
    })),
    updated_at: row.updatedAt?.toISOString() ?? null,
    owner_handle: row.person.username ? `${row.person.username}@${new URL(row.peer.origin).host}` : null,
    collections,
    library_copy_id: await libraryCopyOfRemote(viewerId, row),
    ...detailsOut(row.details),
  };
}

/** What its partner said of its licence and source, for the strip on its page. Nothing from a partner too old to
 *  say, so the page shows none rather than "not stated". */
function detailsOut(value: Prisma.JsonValue | null) {
  const details = value && typeof value === "object" && !Array.isArray(value) ? (value as RemoteModelDetails) : null;
  if (!details || details.license === undefined) return {};
  const from = details.importedFrom;
  return {
    license: details.license ? licenseOut({ license: details.license as unknown as Prisma.JsonValue }) : null,
    creator: details.creator,
    source_provider: from?.provider ?? null,
    source_url: from ? buildImportSourceUrl(from.provider, from.externalId) : null,
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
  viewerId: string,
): Promise<RemoteCollectionPageOut | null> {
  const row = await prisma.remoteCollection.findFirst({
    where: { id, peer: ACTIVE },
    include: { peer: true, person: true },
  });
  if (!row || !(await canSeeCollection(row, viewerId))) return null;
  const [collection] = await collectionCardsOut([row]);
  const indexed = await prisma.remoteModel.findMany({
    // As its card counts them: one shared openly holds only what's shared openly there.
    where: { personId: row.personId, apId: { in: row.modelApIds }, ...(row.limited ? {} : { limited: false }) },
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

/** Where a copy of a partner's model came from (`Print.remoteSource`), with the original while it's still shared. */
export async function remoteOriginOut(value: unknown): Promise<RemoteOriginOut | null> {
  const source = value as Partial<RemoteSource> | null;
  if (!source || typeof source.apId !== "string" || typeof source.origin !== "string") return null;
  // With connected instances off, there's no original to go to: what the copy kept is all it says.
  const original = (await isFederationLive())
    ? await prisma.remoteModel.findFirst({
        where: { apId: source.apId, peer: { ...ACTIVE, origin: source.origin } },
        include: { peer: true, person: true },
      })
    : null;
  const host = new URL(source.origin).host;
  return {
    instance: {
      name: original?.peer.name ?? (typeof source.instance === "string" ? source.instance : host),
      origin: source.origin,
      http: source.origin.startsWith("http:"),
    },
    owner_id: original?.person.id ?? null,
    owner_name: original?.person.displayName ?? (typeof source.ownerName === "string" ? source.ownerName : host),
    owner_handle:
      original?.person.username != null
        ? `${original.person.username}@${host}`
        : typeof source.ownerHandle === "string"
          ? source.ownerHandle
          : null,
    owner_avatar_url: original ? mediaAddress(original.person.avatarUrl) : null,
    original_id: original?.id ?? null,
  };
}
