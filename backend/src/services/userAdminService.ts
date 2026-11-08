import fs from "node:fs/promises";
import { afterAccountGone, roomsWithPartnersOf } from "./chatService";
import path from "node:path";
import type { Role } from "@prisma/client";
import { STORAGE, STUDIO_ASSETS } from "../config";
import { prisma } from "../db";
import { kickSharing, queueAccountGone } from "../federation/sharedCollections";
import { HttpError } from "../utils/fileUtils";
import { deleteAllPrintsForUser } from "./adminService";
import { createLog } from "./auditLog";
import { deleteAuthorIfOrphaned } from "./authorService";
import { removeUserTagMosaics } from "./tagMosaicService";
import { removeUserIcons } from "./iconService";
import { removeUserCover } from "./publicProfileService";
import { removeUserAvatar } from "./avatarService";

// Any admin manages members; only the owner (the first admin) manages other admins. Nobody demotes or
// deletes the owner, or themselves, so the instance always keeps an admin who can. Emptying a library follows the same
// ranks, but anyone may empty their own: it leaves the account, and its admin, in place.

type Actor = { id: string; isOwner: boolean };
type Target = { id: string; role: Role; isOwner: boolean };

export type UserPermissions = {
  canPromote: boolean;
  canDemote: boolean;
  canDelete: boolean;
  canDeleteModels: boolean;
};

export function permissionsOver(actor: Actor, target: Target): UserPermissions {
  const untouchable = target.isOwner || target.id === actor.id;
  const outranked = target.role === "ADMIN" && !actor.isOwner;
  return {
    canPromote: !untouchable && target.role === "MEMBER",
    canDemote: !untouchable && !outranked && target.role === "ADMIN",
    canDelete: !untouchable && !outranked,
    canDeleteModels: target.id === actor.id || (!target.isOwner && !outranked),
  };
}

async function loadActor(actorId: string): Promise<Actor> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, isOwner: true } });
  if (!actor) throw new HttpError(401, "Unauthorized");
  return actor;
}

async function loadTarget(targetId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, isOwner: true, email: true, displayName: true },
  });
  if (!target) throw new HttpError(404, "User not found");
  return target;
}

export async function setUserRole(actorId: string, targetId: string, role: Role): Promise<void> {
  const [actor, target] = await Promise.all([loadActor(actorId), loadTarget(targetId)]);
  if (target.role === role) return;
  const allowed = permissionsOver(actor, target);
  if (role === "ADMIN" ? !allowed.canPromote : !allowed.canDemote) {
    throw new HttpError(403, "You can't change this user's role");
  }
  await prisma.user.update({ where: { id: target.id }, data: { role } });
  void createLog({
    userId: actor.id,
    action: "user_role_changed",
    targetId: target.id,
    details: { email: target.email, role },
  });
}

/** Every model of the user's and its files; the account and the rest of what's theirs stay. Returns how many went. */
export async function deleteUserModels(actorId: string, targetId: string): Promise<number> {
  const [actor, target] = await Promise.all([loadActor(actorId), loadTarget(targetId)]);
  if (!permissionsOver(actor, target).canDeleteModels) throw new HttpError(403, "You can't delete this user's models");
  const models = await deleteAllPrintsForUser(target.id);
  // The admin's, naming whose: the user's own model_deleted entries aren't written for these.
  void createLog({
    userId: actor.id,
    action: "user_models_deleted",
    targetId: target.id,
    details: { email: target.email, name: target.displayName, models },
  });
  return models;
}

/** The account's row, and everything that goes with it in the database. Partners with people on its collections' lists
 *  are told they're gone, by what's queued in the same transaction. */
export async function deleteAccountRow(userId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await queueAccountGone(tx, userId);
      await tx.user.delete({ where: { id: userId } });
    },
    // However much goes with the account.
    { timeout: 2 * 60 * 1000 },
  );
  kickSharing();
}

/** Everything of the user's: their models and every file of them, their own folders, then the account, whose
 *  collections, bookmarks, categories and the rest go with it. */
export async function deleteUser(actorId: string, targetId: string): Promise<{ models: number }> {
  const [actor, target] = await Promise.all([loadActor(actorId), loadTarget(targetId)]);
  if (!permissionsOver(actor, target).canDelete) throw new HttpError(403, "You can't delete this user");
  const models = await deleteAllPrintsForUser(target.id);
  // What a tool brought stays out of the count above -- it is the tool's, not theirs -- but the account taking it
  // with it is right: the models are the account's rows, and the tool's own files are not under u-<id>.
  const authorIds = (
    await prisma.print.findMany({
      where: { userId: target.id, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    })
  ).map((print) => print.authorId!);
  await removeUserTagMosaics(target.id);
  await removeUserIcons(target.id);
  await removeUserCover(target.id);
  await removeUserAvatar(target.id);
  // Model files live under u-<id>; anything left there (a file the database lost track of) goes too.
  await fs.rm(path.join(STORAGE, `u-${target.id}`), { recursive: true, force: true });
  // And the meshes their Studio designs imported, which the designs' rows took with them.
  await fs.rm(path.join(STUDIO_ASSETS, `u-${target.id}`), { recursive: true, force: true });
  // Rooms they shared with partners' people: told once they're out of them.
  const rooms = await roomsWithPartnersOf(target.id);
  await deleteAccountRow(target.id);
  await afterAccountGone(target.id, rooms).catch((err) => console.error("[federation] Couldn't tell partners:", err));
  // Their models went with the account, so an author only they had is now an author of nothing.
  for (const authorId of authorIds) await deleteAuthorIfOrphaned(authorId);
  // Logged as the admin's: the user's own log entries went with them.
  void createLog({
    userId: actor.id,
    action: "user_deleted",
    targetId: target.id,
    details: { email: target.email, name: target.displayName, models },
  });
  return { models };
}
