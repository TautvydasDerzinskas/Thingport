import type { InboxListenerSetters } from "@fedify/fedify";
import type * as Vocab from "@fedify/vocab";
import { chatGoneFor, messageArrived, messageDeletedThere } from "../services/chatService";
import { textOfHtml } from "../utils/htmlEntities";
import {
  deletionFrom,
  leavingFrom,
  placeNote,
  roomChanged,
  roomFrom,
  type IncomingGroup,
  type IncomingNote,
  type IncomingPerson,
} from "./chats";
import { onAcceptReceived, onDisconnectReceived, onFollowReceived, onRejectReceived } from "./peers";
import { sharedCollectionFrom, sharedCollectionGoneFrom } from "./sharedCollections";

/** What partners send, already verified by Fedify against the key compared when connecting (a stranger's activity
 *  never gets this far: see edge.ts; a key other than that one isn't loaded: see pinning.ts). Every change to who
 *  we're connected with is in peers.ts, which also checks the actor is the instance actor connected with. */
export function registerInbox(listeners: InboxListenerSetters<void>, vocab: typeof Vocab): void {
  listeners
    .on(vocab.Follow, async (_ctx, follow) => {
      if (follow.actorId && follow.id) await onFollowReceived(follow.actorId, follow);
    })
    .on(vocab.Accept, async (_ctx, accept) => {
      if (accept.actorId) await onAcceptReceived(accept.actorId, accept.objectId?.href ?? null);
    })
    .on(vocab.Reject, async (_ctx, reject) => {
      if (reject.actorId) await onRejectReceived(reject.actorId, reject.objectId?.href ?? null);
    })
    .on(vocab.Undo, async (ctx, undo) => {
      if (!undo.actorId) return;
      // Their Follow of us, undone: when both admins asked at once, it isn't the one this side keeps the id of.
      const object = await undo
        .getObject({ documentLoader: noFetch, contextLoader: ctx.contextLoader })
        .catch(() => null);
      const theirFollow =
        object instanceof vocab.Follow &&
        object.actorId?.href === undo.actorId.href &&
        object.objectId?.href === ctx.getActorUri("instance").href;
      await onDisconnectReceived(undo.actorId, undo.objectId?.href ?? null, theirFollow);
    })
    .on(vocab.Block, async (ctx, block) => {
      // Only a Block of this instance ends it.
      if (block.actorId && block.objectId?.href === ctx.getActorUri("instance").href) {
        await onDisconnectReceived(block.actorId, null, true);
      }
    })
    // Chats with partners' people: see chats.ts, which checks each against the partner it came from.
    .on(vocab.Create, async (ctx, create) => {
      const note = await noteIn(vocab, ctx.contextLoader, await create.getObject(embedded(ctx)).catch(() => null));
      if (!create.actorId || !note) return;
      const placed = await placeNote(create.actorId, note, false);
      if (placed) await messageArrived({ ...placed, peerId: placed.peer.id });
    })
    .on(vocab.Announce, async (ctx, announce) => {
      const note = await noteIn(vocab, ctx.contextLoader, await announce.getObject(embedded(ctx)).catch(() => null));
      if (!announce.actorId || !note) return;
      const placed = await placeNote(announce.actorId, note, true);
      if (placed) await messageArrived({ ...placed, peerId: placed.peer.id, hostedHere: false });
    })
    .on(vocab.Update, async (ctx, update) => {
      // A collection shared with people here: only its address is taken from this; it's read from there.
      if (update.actorId && update.objectId && /\/collections\/[^/]+$/.test(update.objectId.pathname)) {
        await sharedCollectionFrom(update.actorId, update.objectId.href);
        return;
      }
      const object = await update.getObject(embedded(ctx)).catch(() => null);
      if (!update.actorId || !(object instanceof vocab.Group) || !object.id) return;
      const group: IncomingGroup = {
        id: object.id.href,
        name: object.name?.toString() ?? null,
        summary: object.summary?.toString() ?? null,
        updated: object.updated ? new Date(object.updated.epochMilliseconds) : null,
        members: [],
      };
      for await (const item of object.getAttachments(embedded(ctx))) {
        if (item instanceof vocab.Person && item.id) group.members.push(await personIn(vocab, ctx.contextLoader, item));
        if (group.members.length >= 1000) break;
      }
      const room = await roomFrom(update.actorId, group);
      if (room?.removed.length) await chatGoneFor(room.chatId, room.removed);
    })
    .on(vocab.Delete, async (_ctx, deletion) => {
      if (!deletion.actorId || !deletion.objectId) return;
      // A collection shared with people here, no longer: see sharedCollections.ts. Never a chat's, whatever's kept.
      if (/\/collections\/[^/]+$/.test(deletion.objectId.pathname)) {
        await sharedCollectionGoneFrom(deletion.actorId, deletion.objectId.href);
        return;
      }
      const gone = await deletionFrom(deletion.actorId, deletion.objectId.href);
      if (gone?.kind === "room") await chatGoneFor(gone.chatId, gone.members);
      if (gone?.kind === "message") {
        await messageDeletedThere(gone.chatId, gone.messageId, { hostedHere: gone.hostedHere, peerId: gone.peer.id });
      }
    })
    .on(vocab.Remove, async (_ctx, remove) => {
      if (!remove.actorId || !remove.objectId || !remove.targetId) return;
      const roomId = await leavingFrom(remove.actorId, remove.objectId.href, remove.targetId.href);
      if (roomId) await roomChanged(roomId);
    })
    .onError((_ctx, error) => {
      console.error("[federation] Failed to handle an activity:", error);
    });
}

type ContextLoader = Parameters<Vocab.Object["getAttribution"]>[0] extends infer O
  ? O extends { contextLoader?: infer L }
    ? L
    : never
  : never;

/** Objects as an activity carries them, never fetched: what partners say is checked by chats.ts, not refetched. */
const embedded = (ctx: { contextLoader: unknown }) => ({
  documentLoader: noFetch,
  contextLoader: ctx.contextLoader as ContextLoader,
  crossOrigin: "trust" as const,
});

async function personIn(vocab: typeof Vocab, contextLoader: unknown, person: Vocab.Person): Promise<IncomingPerson> {
  const icon = await person.getIcon(embedded({ contextLoader })).catch(() => null);
  const url = icon instanceof vocab.Image ? icon.url : null;
  return {
    id: person.id!.href,
    name: person.name?.toString() ?? null,
    preferredUsername: person.preferredUsername?.toString() ?? null,
    icon: url instanceof URL ? url.href : (url?.href?.href ?? null),
  };
}

async function noteIn(vocab: typeof Vocab, contextLoader: unknown, object: unknown): Promise<IncomingNote | null> {
  if (!(object instanceof vocab.Note) || !object.id) return null;
  const options = embedded({ contextLoader });
  const author = await object.getAttribution(options).catch(() => null);
  const attachments: IncomingNote["attachments"] = [];
  for await (const item of object.getAttachments(options)) {
    if (item instanceof vocab.Link && item.href)
      attachments.push({ href: item.href.href, name: item.name?.toString() ?? "" });
    if (attachments.length >= 10) break;
  }
  const source = object.source;
  const text =
    source?.content && (!source.mediaType || source.mediaType === "text/plain")
      ? source.content.toString()
      : textOfHtml(object.content?.toString() ?? "");
  return {
    id: object.id.href,
    attributedTo: author instanceof vocab.Person && author.id ? await personIn(vocab, contextLoader, author) : null,
    to: object.toIds.map((url) => url.href),
    context: object.contextIds[0]?.href ?? null,
    text,
    attachments,
  };
}

/** A Note's HTML as the text it says: line breaks kept, tags dropped. */
// An Undo names what it undoes inline; nothing is fetched to find out.
const noFetch = async (url: string): Promise<never> => {
  throw new Error(`Not fetched: ${url}`);
};
