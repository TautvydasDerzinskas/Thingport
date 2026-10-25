# <img src="../assets/providers/pinshape.svg" alt="" width="36" height="36" align="absmiddle"> Pinshape

A long-running community model site, now run by MatterHackers, at [pinshape.com](https://pinshape.com): free models,
and collections anyone can follow. Its models, collections and likes are anyone's to read; its files go only to a
signed-in user.

| At a glance    |                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Sign-in        | Your own Pinshape sign-in, per user, for the files                                                           |
| Thingport Grab | Recommended -- it sends your sign-in as you visit pinshape.com                                               |
| FlareSolverr   | Not used                                                                                                     |
| Imports        | Models; anyone's collections and likes, [synced](../guides/synced-collections.md) too; no category of theirs |

## How it works

Pinshape has no API of its own, so Thingport reads its pages, as a browser would.

- **Models.** Paste a model link (`https://pinshape.com/items/<id>-<name>`) in Thingport, or import it from the model
  page with Grab. A model is one print of its model files, each downloaded on its own; where it lists none, its zip is
  unpacked. Its pages don't say which of Pinshape's categories a model is in, so it comes in without one: pick one, or
  let AI categorization file it.
- **Collections.** A collection is Pinshape's browse page showing it, `https://pinshape.com/items?collection_id=<id>`.
  Anyone's can be imported or synced. Pinshape shows them 12 models a page, so a large one takes a while to read; the
  import dialog lists its first 300 models.
- **Likes.** Someone's likes are their profile's **Likes** tab, `https://pinshape.com/users/<id>-<name>?tab=likes`.
  Pinshape's profile shows only 12 of them, the same for everyone, with no way to see the rest, so that's what an import
  offers. A synced one brings new likes in as they show up there.
- **Browse tab.** With your sign-in, the sync dialog lists your likes, your own collections and the ones you
  subscribed to.

## Setup: your sign-in

Per-user (**Configuration → Providers → Pinshape**). Pinshape signs you in with two cookies: `remember_token`, which
lasts a year if you tick **Remember Me** when signing in, and `session`. Either one works; Thingport keeps both.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Pinshape, opening pinshape.com while you're signed in
connects your account, and sends a new sign-in whenever you sign in there again.

### Manual: copy it from your browser

1. Sign in at [pinshape.com](https://pinshape.com), with **Remember Me** ticked.
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://pinshape.com`. Firefox: **Storage** tab > **Cookies**.
4. Copy the value of `remember_token`. (The `Cookie` request header of any signed-in request to pinshape.com works
   too.)
5. Right-click **Pinshape** in **Configuration → Providers**, choose **Connect** and paste it.
