import { prisma } from "../db";
import { RELEASE_NOTES_URL } from "../config";
import { BRIDGE_UPDATE_RECEIPT_PREFIX, createNotification } from "./notificationService";
import { fetchText } from "./releaseNotesService";
import { compareVersions } from "./systemNotificationService";

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const BRIDGE_AGENT = /^Thingport-Bridge\/(\d+\.\d+\.\d+)(?:\s|$)/;
// Bridge 1.0.1 and older send Go's own User-Agent, without a version. Slicers that fetch these links send their own,
// so on a slicer link it's one of those Bridges, counted as the newer of the two.
const OLD_BRIDGE_AGENT = /^Go-http-client\//;
const OLD_BRIDGE_VERSION = "1.0.1";

/** The version of the Thingport Bridge that sent a request; null when it isn't one, or a dev build. */
export function bridgeVersionFromUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const match = BRIDGE_AGENT.exec(userAgent);
  if (match) return match[1];
  return OLD_BRIDGE_AGENT.test(userAgent) ? OLD_BRIDGE_VERSION : null;
}

/** The newest Bridge, from bridge/package.json among the repo files "What's new" reads, so turning those off turns
 *  this off too. Its release bumps that file. */
export async function latestBridgeVersion(baseUrl = RELEASE_NOTES_URL): Promise<string | null> {
  if (!baseUrl) return null;
  const text = await fetchText(`${baseUrl}/bridge/package.json`);
  if (!text) return null;
  try {
    const { version } = JSON.parse(text) as { version?: unknown };
    return typeof version === "string" && RELEASE_VERSION.test(version) ? version : null;
  } catch {
    return null;
  }
}

// Spares a database write for every file a Bridge downloads once its owner has been told.
const told = new Set<string>();

/** Tells someone that `latest` is out, once per version: the first time an older Bridge of theirs downloads a file. */
export async function notifyOutdatedBridge(userId: string, running: string, latest: string | null): Promise<boolean> {
  if (!latest || compareVersions(running, latest) >= 0) return false;
  const key = `${userId}\n${latest}`;
  if (told.has(key)) return false;
  // The receipt is the lock, so two files downloaded at once still make one notification. One transaction, so a
  // notification that fails to save leaves no receipt, and the next download tries again.
  const sent = await prisma.$transaction(async (tx) => {
    const { count } = await tx.systemReceipt.createMany({
      data: [{ userId, systemId: `${BRIDGE_UPDATE_RECEIPT_PREFIX}${latest}` }],
      skipDuplicates: true,
    });
    if (count) {
      await createNotification(
        userId,
        {
          type: "system",
          title: `Thingport Bridge ${latest} is available`,
          message: { key: "bridgeUpdate", values: { version: latest } },
          internalPath: "/downloads",
        },
        tx,
      );
    }
    return count > 0;
  });
  told.add(key);
  return sent;
}

/** A slicer link fetched by someone's Bridge. Never holds up the download. */
export function noteBridgeDownload(userId: string, userAgent: string | undefined): void {
  const running = bridgeVersionFromUserAgent(userAgent);
  if (!running) return;
  void latestBridgeVersion()
    .then((latest) => notifyOutdatedBridge(userId, running, latest))
    .catch((err) => console.error("Failed to check for a newer Thingport Bridge:", err));
}
