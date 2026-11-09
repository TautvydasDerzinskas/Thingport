// What a PIXUP page shows of the signed-in user, read from the page itself, and whether they own the model, which the
// site's own API tells this browser's session.

import { MANIFESTS } from "../index.generated";
import { parsePixup3dModelUrl } from "./urls.generated";

/** Its menu's Sign out link, which only a signed-in member's pages have. A visitor gets a session cookie too, and
 *  sending that on would replace a working sign-in with one that isn't. */
export function pixup3dSignedIn(): boolean {
  return Boolean(document.querySelector('a[href="/users/sign_out"]'));
}

type Variant = {
  id: number;
  price: string;
  include_sliced?: boolean;
  include_pre_supported?: boolean;
  include_non_supported?: boolean;
  file_groups?: unknown[];
};

async function apiData(path: string): Promise<unknown> {
  // The panel waits on this to show the import button, so an answer that stalls doesn't block it.
  const res = await fetch(`${MANIFESTS.pixup3d.site}/api/v1${path}`, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { data?: unknown }).data;
}

/** A paid model the user hasn't bought any variant of that has model files. A free one isn't: the instance orders it
 *  for $0. One it can't tell about never blocks. */
export async function isUnboughtPixup3dModel(url: string): Promise<boolean> {
  const postId = parsePixup3dModelUrl(url)?.postId;
  if (!postId || !pixup3dSignedIn()) return false;
  try {
    const post = (await apiData(`/posts/${postId}`)) as { variants?: Variant[] } | null;
    const wanted = (post?.variants ?? []).filter(
      (v) => (!v.include_sliced || v.include_pre_supported || v.include_non_supported) && (v.file_groups ?? []).length,
    );
    if (!wanted.length || wanted.some((v) => !(Number(v.price) > 0))) return false;
    for (const variant of wanted) {
      const state = (await apiData(`/post_variants/${variant.id}`)) as { purchased?: boolean } | null;
      if (state?.purchased) return false;
    }
    return true;
  } catch {
    return false;
  }
}
