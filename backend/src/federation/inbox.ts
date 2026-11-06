import type { InboxListenerSetters } from "@fedify/fedify";
import type * as Vocab from "@fedify/vocab";
import { onAcceptReceived, onDisconnectReceived, onFollowReceived, onRejectReceived } from "./peers";

/** What partners send, already verified by Fedify (a stranger's activity never gets this far: see edge.ts). Every
 *  change to who we're connected with is in peers.ts. */
export function registerInbox(listeners: InboxListenerSetters<void>, vocab: typeof Vocab): void {
  listeners
    .on(vocab.Follow, async (_ctx, follow) => {
      if (follow.actorId && follow.id) await onFollowReceived(follow.actorId.origin, follow);
    })
    .on(vocab.Accept, async (_ctx, accept) => {
      if (accept.actorId) await onAcceptReceived(accept.actorId.origin, accept.objectId?.href ?? null);
    })
    .on(vocab.Reject, async (_ctx, reject) => {
      if (reject.actorId) await onRejectReceived(reject.actorId.origin, reject.objectId?.href ?? null);
    })
    .on(vocab.Undo, async (_ctx, undo) => {
      if (undo.actorId) await onDisconnectReceived(undo.actorId.origin, undo.objectId?.href ?? null);
    })
    .on(vocab.Block, async (_ctx, block) => {
      if (block.actorId) await onDisconnectReceived(block.actorId.origin, null);
    })
    .onError((_ctx, error) => {
      console.error("[federation] Failed to handle an activity:", error);
    });
}
