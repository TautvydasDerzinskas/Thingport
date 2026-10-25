// Backup for providers/makerworld/downloadResolver.ts, which normally reads the file URL from the link
// MakerWorld clicks before any download starts: should a real browser download start instead, this
// captures it, cancels it, and reads its URL.
//
// Two messages (ARM, then AWAIT) because the click happens in the content script in between.

const DOWNLOAD_CAPTURE_TIMEOUT_MS = 8000;

// Only one capture is ever in flight.
let pending: { resolve: (url: string | null) => void; timeoutId: ReturnType<typeof setTimeout> } | null = null;
let currentCapture: Promise<string | null> | null = null;

chrome.downloads.onCreated.addListener((item) => {
  if (!pending) return;
  const { resolve, timeoutId } = pending;
  pending = null;
  clearTimeout(timeoutId);
  chrome.downloads.cancel(item.id).catch(() => undefined);
  chrome.downloads.erase({ id: item.id }).catch(() => undefined);
  // A blob: URL isn't fetchable by the backend, so it counts as nothing captured.
  resolve(/^https?:\/\//i.test(item.url) ? item.url : null);
});

export function armDownloadCapture(): null {
  if (pending) {
    clearTimeout(pending.timeoutId);
    pending.resolve(null);
  }
  currentCapture = new Promise<string | null>((resolve) => {
    const timeoutId = setTimeout(() => {
      if (pending && pending.resolve === resolve) {
        pending = null;
        resolve(null);
      }
    }, DOWNLOAD_CAPTURE_TIMEOUT_MS);
    pending = { resolve, timeoutId };
  });
  return null;
}

export function awaitDownloadCapture(): Promise<string | null> {
  return currentCapture ?? Promise.resolve(null);
}

/** Drops a capture the page's own file link already answered (see
 *  providers/makerworld/downloadResolver.ts), so it can't swallow the user's next real download. */
export function disarmDownloadCapture(): null {
  if (pending) {
    clearTimeout(pending.timeoutId);
    pending.resolve(null);
    pending = null;
  }
  return null;
}
