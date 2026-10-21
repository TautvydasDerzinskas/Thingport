import { prisma } from "../db";
import { toPrintOut } from "../dto";
import { HttpError } from "../utils/fileUtils";
import { normalizeImportUrl } from "../utils/urlUtils";
import { createLog } from "./auditLog";
import { assertCanImportUrl, importPrintFromUrl, type ImportRequestBody } from "./importService";
import { getUserMakerworldCookie } from "./makerworldCookieService";
import { notifySingleImport } from "./modelNotifications";

// One link imported into one model, with the activity log and notification that go with it. Shared
// by POST /import and the MCP import_model tool, so both run the same checks and leave the same trail.

export type SingleImportBody = ImportRequestBody & {
  /** False for each model of a run the client drives itself; the run sends one summary at the end. */
  notify?: boolean;
};

// Falls back to the cookie saved in Settings when the request doesn't carry one.
export async function withStoredMakerworldCookie<T extends { makerworld_cookie?: string | null }>(
  userId: string,
  body: T,
): Promise<T> {
  if (body.makerworld_cookie && body.makerworld_cookie.trim()) return body;
  const stored = await getUserMakerworldCookie(userId);
  return stored ? { ...body, makerworld_cookie: stored } : body;
}

/** The checks before an import starts: the stored MakerWorld cookie, a normalized public URL (never an
 *  internal address), a provider an admin hasn't turned off, and a category of the user's own. */
export async function prepareSingleImport<T extends SingleImportBody>(
  userId: string,
  body: T,
): Promise<{ url: string; body: T }> {
  const withCookie = await withStoredMakerworldCookie(userId, body);
  const url = await normalizeImportUrl(withCookie.url);
  await assertCanImportUrl(userId, url);
  if (withCookie.category_id) {
    const owned = await prisma.category.count({ where: { id: withCookie.category_id, userId } });
    if (!owned) throw new HttpError(404, "Category not found");
  }
  return { url, body: withCookie };
}

export async function importAndDescribe(
  userId: string,
  url: string,
  body: SingleImportBody,
  options?: { keepGrabImports?: boolean },
) {
  let result;
  try {
    result = await importPrintFromUrl(userId, url, body, options);
  } catch (err) {
    if (body.notify !== false) {
      const error = err instanceof HttpError ? err.message : "Something went wrong on the server.";
      await notifySingleImport(userId, url, { error }).catch((e) => console.error("Import notification failed:", e));
    }
    throw err;
  }
  const { print, plates, author, previewImages } = result;
  const importOutcome = result.alreadyImported ? "already_imported" : result.profileAdded ? "profile_added" : "created";
  void createLog({ userId, action: "model_imported", targetId: print.id, details: { name: print.name, url } });
  if (body.notify !== false) {
    await notifySingleImport(userId, url, {
      printId: print.id,
      name: print.title || print.name,
      outcome: importOutcome,
    }).catch((e) => console.error("Import notification failed:", e));
  }
  return { ...toPrintOut(print, plates, [], null, author, previewImages), import_outcome: importOutcome };
}
