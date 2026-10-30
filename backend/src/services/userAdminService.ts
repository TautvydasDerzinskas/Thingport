import fs from "node:fs/promises";
import path from "node:path";
import type { Role } from "@prisma/client";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { deleteAllPrintsForUser } from "./adminService";
import { createLog } from "./auditLog";
import { deleteAuthorIfOrphaned } from "./authorService";
import { removeUserTagMosaics } from "./tagMosaicService";
import { removeUserIcons } from "./iconService";

// Any admin manages members; only the owner (the first admin) manages other admins. Nobody demotes or
// deletes the owner, or themselves, so the instance always keeps an admin who can.

type Actor = { id: string; isOwner: boolean };
type Target = { id: string; role: Role; isOwner: boolean };

export type UserPermissions = { canPromote: boolean; canDemote: boolean; canDelete: boolean };

export function permissionsOver(actor: Actor, target: Target): UserPermissions {
  const untouchable = target.isOwner || target.id === actor.id;
  const outranked = target.role === "ADMIN" && !actor.isOwner;
  return {
    canPromote: !untouchable && target.role === "MEMBER",
    canDemote: !untouchable && !outranked && target.role === "ADMIN",
    canDelete: !untouchable && !outranked,
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
  // Model files live under u-<id>; anything left there (a file the database lost track of) goes too.
  await fs.rm(path.join(STORAGE, `u-${target.id}`), { recursive: true, force: true });
  await prisma.user.delete({ where: { id: target.id } });
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
