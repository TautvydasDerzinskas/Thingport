# <img src="../assets/providers/pixup3d.svg" alt="" width="36" height="36" align="absmiddle"> PIXUP

Phrozen's 3D model marketplace, at [pixup3d.com](https://pixup3d.com): figures, busts and tabletop miniatures from
independent designers, many of them pre-supported for resin printing, some free and most for sale. Its models, and
anyone's wishlist and collections, are anyone's to read; their files go only to a signed-in member who owns them.

| At a glance    |                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own PIXUP sign-in, per user, for the files                                                                                                       |
| Thingport Grab | Recommended -- it sends your sign-in as you visit pixup3d.com, and marks the paid models you haven't bought                                           |
| FlareSolverr   | Not used                                                                                                                                              |
| Imports        | Free models and the ones you bought; anyone's wishlist and collections, [synced](../guides/synced-collections.md) too; categories mapped from its own |

## How it works

PIXUP's pages are built on a JSON API of its own, which is what Thingport reads, with each model's page for its
description and pictures.

- **Models.** Paste a model link (`https://pixup3d.com/en/posts/<number>`, in any of its languages) in Thingport, or
  import it from the model page with Grab. A model comes in one or more **variants** -- "STL from Designer",
  "Pre-supported", "Ready-to-Print File" -- each with its own price and its files in groups. Thingport imports every
  variant with model files, one zip per file group, and leaves out the ones of nothing but sliced files for particular
  resin printers, which no slicer opens as a model.
- **Free models.** PIXUP hands out even a free model's files only once it's in your library, which its Download button
  does with a $0 order through your cart. Thingport places that order for you. Checking out takes the whole cart, so
  while your PIXUP cart holds a paid model Thingport doesn't order anything, and asks you to check out or empty your
  cart first.
- **Paid models.** Buy them on PIXUP first; once a model is in your library, Thingport imports it. In a list, paid
  models you haven't bought are marked and can't be picked, and a sync leaves them out until you own them.
- **Packaging.** PIXUP makes a file group's zip the first time it's asked for. Until it's ready, an import says to
  come back in a few minutes.
- **Wishlists.** Someone's wishlist is their profile's **Wishlists** tab, `https://pixup3d.com/en/p/<username>/saved_posts`,
  anyone's to read. Import it, or sync it so new models come in as they're added.
- **Collections.** A member's collections, the **Series** tab of their profile, are at
  `https://pixup3d.com/en/p/<username>/collections/<number>`. Public ones are anyone's to read; a private one only
  yours, with your sign-in. PIXUP's own curated series (`/series/…`) aren't imported.
- **Browse tab.** With your sign-in, the sync dialog lists your own wishlist and collections.
- **Trending.** The dashboard's panel shows the week's most viewed models, as the **Trending** link on its home page
  does.

## Setup: your sign-in

Per-user (**Configuration → Providers → PIXUP**). PIXUP keeps you signed in with one cookie, `_phrozen_session`, which
it renews with every page you open. Thingport keeps the newest one it's given, its own imports included.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on PIXUP, opening pixup3d.com while you're signed in connects
your account, and sends your sign-in on as it changes there.

### Manual: copy it from your browser

1. Sign in at [pixup3d.com](https://pixup3d.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://pixup3d.com`. Firefox: **Storage** tab > **Cookies**.
4. Copy the value of `_phrozen_session`. (The `Cookie` request header of any signed-in request to pixup3d.com works
   too.)
5. Right-click **PIXUP** in **Configuration → Providers**, choose **Connect** and paste it.
