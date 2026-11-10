# <img src="../assets/providers/3dexport.svg" alt="" width="36" height="36" align="absmiddle"> 3DExport

One of the oldest 3D model marketplaces, at [3dexport.com](https://3dexport.com), open since 2004: game and film
assets, textures and a large 3D printing catalogue, sold by their designers and some given away free. Its models, its
listings and anyone's public collections are anyone's to read; their files go only to a signed-in user, and a paid
model's only once it's theirs.

| At a glance    |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own 3DExport sign-in, per user, for the files and your own collections                                                                                                |
| Thingport Grab | Recommended -- it sends your sign-in as you visit 3dexport.com, and marks the paid models you haven't bought                                                               |
| FlareSolverr   | Not used                                                                                                                                                                   |
| Imports        | Free models and the ones you bought; your own collections and anyone's public ones, [synced](../guides/synced-collections.md) too; 3D print categories mapped from its own |

## How it works

3DExport has no API of its own, so Thingport reads its pages, as it does for Toymakr3D.

- **Models.** Paste a model link (`https://3dexport.com/3d-model-<name>-<number>`, in any of its languages) in
  Thingport, or import it from the model page with Grab. Only the number counts: the site sends any other name to the
  model's own.
- **Formats.** 3DExport packs each of a model's formats into a zip of its own, and a CG model often comes in a dozen,
  scenes and textures among them. Thingport downloads the ones a slicer or LightBurn opens -- STL, 3MF, STEP (`.step`
  or `.stp`) and LightBurn projects (`.lbrn`, `.lbrn2`) -- first. Its OBJ or GLB, and any download whose format the
  page doesn't say, come only when those brought no model file: when none is offered, or their zips held none. A model
  with none of them has nothing to import.
- **Free models.** Signed in, a free model's page lists each format's download, which is what Thingport fetches. No
  cart or checkout is involved.
- **Paid models.** Buy them on 3DExport first; once a model is yours, Thingport imports it, and never buys anything.
  Grab marks a paid model you haven't bought on its page. A bought model's download hasn't been tried against a real
  purchase yet: it's expected to show the same downloads a free one does.
- **Collections.** 3DExport keeps bookmarks as collections. Your **Default Collection**, always private, is at
  `https://3dexport.com/mybookmarks/default`. Any other collection, yours or anyone's, is at
  `https://3dexport.com/bookmarks/3d-collection-<number>`: a public one, as its **Bookmarks** page lists them, needs no
  sign-in, and a private one shows only to its owner, so Thingport reads it with your sign-in. Import one, or sync it so
  new models come in as they're added. A sync takes paid models in too, as the pages don't say which you bought: one
  you haven't bought is refused and counts as failed, and later checks don't try it again. Once you've bought it,
  **Retry** it under **Needs attention** in the import queue.
- **Browse tab.** With your sign-in, the sync dialog lists your own collections.
- **Categories.** A 3D print model's category is the path its breadcrumb names (`characters/animals`), mapped to
  Thingport's own. A CG model's comes from 3DExport's other catalogue, which isn't mapped, so its category is left to
  you or the AI suggestion.
- **Licences.** A free model is under 3DExport's Royalty Free licence: use it in your own work, commercial too, but
  never pass the files on. A bought one is under its Basic licence, the one it's sold with: the model's page doesn't
  say if you paid for the Extended one. Either may carry its author's "No AI Training".
- **Trending.** The dashboard's panel shows its best-selling 3D print models.

## Setup: your sign-in

Per-user (**Configuration → Providers → 3DExport**). 3DExport keeps you signed in with two cookies, `nm_userid` and
`nm_hash`, which last ten years. **Signing out of 3dexport.com, in any browser, ends them** and Thingport's copy with
them; sign in again with Grab, or paste the new ones.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on 3DExport, opening 3dexport.com while you're signed in
connects your account, and sends your sign-in on whenever it changes there.

### Manual: copy it from your browser

1. Sign in at [3dexport.com](https://3dexport.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Go to the **Network** tab, reload the page and click any request to 3dexport.com.
4. Copy its `Cookie` request header, which holds `nm_userid` and `nm_hash`.
5. Right-click **3DExport** in **Configuration → Providers**, choose **Connect** and paste it.
