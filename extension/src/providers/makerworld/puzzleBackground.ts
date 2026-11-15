// Opens MakerWorld's own puzzle in the page that asked, where only the site's script can (see pagePuzzle.ts).

import type { BackgroundMessages } from "../../shared/messages";
import { senderTabId } from "../../shared/messages";
import { openPuzzleInPage } from "./pagePuzzle";
import { urls } from "./urls.generated";

/** Only on MakerWorld's own pages: `onRetry` on another site would be anyone's. Answers whether the puzzle opened;
 *  its answer comes to the page on `eventName`. */
export async function showMakerworldPuzzle(
  { challenge, eventName }: BackgroundMessages["SHOW_MAKERWORLD_PUZZLE"]["payload"],
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  const tabId = senderTabId(sender);
  const page = sender.url ? new URL(sender.url) : null;
  if (!page || page.protocol !== "https:" || !urls.isHost(page.hostname)) return false;
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [sender.frameId ?? 0] },
    world: "MAIN",
    func: openPuzzleInPage,
    args: [challenge, eventName],
  });
  return frame?.result === true;
}
