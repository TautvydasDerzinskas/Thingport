# <img src="../assets/providers/qidimaker.svg" alt="" width="36" height="36" align="absmiddle"> QIDI Maker

QIDI Tech's model community, at [www.qidimaker.com](https://www.qidimaker.com), for its X-Plus, X-Max and Q printers.
Most of its models come with print profiles, QIDI Studio projects made by their designers or by anyone else. Its models,
their files and anyone's public collections need nothing; your own collections and likes need your sign-in.

| At a glance    |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | None to import; your own sign-in for your collections and likes                                                                              |
| Thingport Grab | Recommended -- it sends your sign-in as you visit www.qidimaker.com                                                                          |
| FlareSolverr   | Not used                                                                                                                                     |
| Imports        | Models with their print profiles, with their category and licence; collections and your likes, [synced](../guides/synced-collections.md) too |

## How it works

Paste a model link (`https://www.qidimaker.com/en/models/detail/<id>`) in Thingport, or import it from the model page
with Grab. A model is one print:

- **With print profiles**, an import brings one of them: the one the link names with `?profile_id=<id>` (the page
  writes it into its address as you pick one), else the designer's first. The designer's or all of them can be picked
  as for other sites' print profiles; those left out can be added later. Each comes in as a plate of its own, named
  after the model, with the profile's print time, filament and plates beside it.
- **Without**, it brings the model's own files from the zip QIDI Maker makes of them. The site writes most of these
  zips without the index a zip reader needs -- its own **Download STL/CAD Files** gives the same broken file -- so
  Thingport puts the index back first. The files in it are named only by when they were uploaded, so they're named
  after the model.

Everything is on QIDI Maker's public file server, so nothing needs a sign-in. The site's own Download first counts the
download on your account; Thingport doesn't, so a sync's imports stay out of your download history there.

A collection's link (`https://www.qidimaker.com/en/collections/detail/<id>`) imports or syncs it: anyone's public one
without a sign-in, a private one of yours with it. Your likes are `https://www.qidimaker.com/en/my/collections/detail?type=1`,
which is whoever is signed in: import or sync it from there, or pick **QIDI Maker likes** in the sync dialog's Browse
tab, which lists your own collections, your **Default Collection** among them.

QIDI Maker answers a private collection, to anyone but its owner, as it answers one that was deleted. A sync of a
collection it can't read without your sign-in waits for you to connect it, rather than taking the collection for gone.

Its print profiles are QIDI Studio projects; other slicers open them as [adapted 3MFs](../features/adapted-3mf.md).
Thingport Grab's **Download adapted**, under a model's **Open in QIDI Studio** once you allow Grab there, saves a copy
of the picked profile made for yours, without your sign-in.

## Setup: your sign-in

Per-user (**Configuration → Providers → QIDI Maker**), only for your own collections and likes. Opening
www.qidimaker.com signed in, with Grab allowed there, connects it, and it sends a new one whenever you sign in there
again. The sign-in is the site's `token` cookie, which lasts 90 days. By hand:

1. Sign in at [www.qidimaker.com](https://www.qidimaker.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://www.qidimaker.com`. Firefox: **Storage** tab >
   **Cookies**.
4. Copy the value of the `token` cookie: 32 letters and digits.

   ```text
   0f1e2d3c4b5a69788796a5b4c3d2e1f0
   ```

5. Right-click **QIDI Maker** in **Configuration → Providers**, choose **Connect** and paste it.

The whole `Cookie` header of a signed-in www.qidimaker.com request works too, and so does the cookie's row copied from
the developer tools' cookie table.
