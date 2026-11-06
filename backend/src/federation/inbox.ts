import type { InboxListenerSetters } from "@fedify/fedify";
import type * as Vocab from "@fedify/vocab";
import { onAcceptReceived, onDisconnectReceived, onFollowReceived, onRejectReceived } from "./peers";

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
    .onError((_ctx, error) => {
      console.error("[federation] Failed to handle an activity:", error);
    });
}

// An Undo names what it undoes inline; nothing is fetched to find out.
const noFetch = async (url: string): Promise<never> => {
  throw new Error(`Not fetched: ${url}`);
};
