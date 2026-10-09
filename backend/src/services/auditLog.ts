import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

export type LogAction =
  | "user_logged_in"
  | "user_logged_out"
  | "password_reset_requested"
  | "password_reset"
  | "api_token_generated"
  | "api_token_revoked"
  | "user_invited"
  | "authors_linked"
  | "descriptions_refetched"
  | "model_uploaded"
  | "model_imported"
  | "import_completed"
  | "model_edited"
  | "model_reimported"
  | "model_deleted"
  | "collection_created"
  | "collection_edited"
  | "collection_deleted"
  | "collection_item_added"
  | "collection_item_removed"
  | "collection_sync_enabled"
  | "collection_sync_disabled"
  | "ai_categorization_run";

/** Fire-and-forget: a logging failure must never break the action it records. */
export async function createLog(params: {
  userId: string;
  action: LogAction;
  targetId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.log.create({
      data: {
        userId: params.userId,
        action: params.action,
        targetId: params.targetId ?? null,
        details: (params.details ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("[auditLog] Failed to write log entry:", err);
  }
}
