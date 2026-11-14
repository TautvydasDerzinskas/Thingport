# <img src="../assets/providers/voxelshare.svg" alt="" width="36" height="36" align="absmiddle"> VoxelShare

Flashforge's model community, at [www.voxelshare.com](https://www.voxelshare.com), for its Adventurer and Creator
printers. Many of its models come with print profiles for those printers, made in Flash Studio, Flashforge's own slicer.
Its models, their files and anyone's public collections need nothing; your own collections and likes need your sign-in.

| At a glance    |                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | None to import; your own sign-in for your collections and likes                                                                              |
| Thingport Grab | Recommended -- it sends your sign-in as you visit www.voxelshare.com                                                                         |
| FlareSolverr   | Not used                                                                                                                                     |
| Imports        | Models with their print profiles, with their category and licence; collections and your likes, [synced](../guides/synced-collections.md) too |

## How it works

Paste a model link (`https://www.voxelshare.com/en/models/<id>-<name>`) in Thingport, or import it from the model page
with Grab. A model is one print:

- **With print profiles**, an import brings one of them: the designer's first, or with Grab, the one picked on the
  page. The page keeps its pick to itself rather than in its address, so a link names one only as Thingport writes it,
  with `#profileId-<id>`. The designer's or all of them can be picked as for other sites' print profiles; those left
  out can be added later. Each comes in as a plate of its own, named after the model, with the profile's print time,
  filament and plates beside it.
- **Without**, it brings the model's own files, in the folders the designer put them in. Many are kept zipped one by
  one, which Thingport unpacks.

Every file is a signed link on VoxelShare's image server, so nothing needs a sign-in. The site's own Download then
reports the download to count it on your account; Thingport doesn't, so a sync's imports stay out of your download
history there.

Many of VoxelShare's models are copies of models first published on other sites, such as MakerWorld, Printables or
NexPrint. Where it says so, the imported model's description ends with where that was, linked.

A collection's link (`https://www.voxelshare.com/en/collection/<id>-<name>`) imports or syncs it: anyone's public one
without a sign-in, a private one of yours with it. Your likes are `https://www.voxelshare.com/en/print_list?recordTab=like`,
which is whoever is signed in: import or sync it from there, or pick **VoxelShare likes** in the sync dialog's Browse
tab, which lists your own collections, your **My Collection** among them.

A sync of a private collection waits for your sign-in rather than reading it without, as VoxelShare may show its details
to anyone but not all of its models.

Its print profiles are OrcaSlicer-style projects for Flashforge printers; other slicers open them as
[adapted 3MFs](../features/adapted-3mf.md). Thingport Grab's **Download adapted**, under a model's **Open in Flash
Studio Desktop** once you allow Grab there, saves a copy of the picked profile made for yours, without your sign-in.

## Setup: your sign-in

Per-user (**Configuration → Providers → VoxelShare**), only for your own collections and likes. Opening
www.voxelshare.com signed in, with Grab allowed there, connects it, and it sends a new one whenever the site renews it.
The sign-in is the site's `token` cookie, which lasts 31 days. By hand:

1. Sign in at [www.voxelshare.com](https://www.voxelshare.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://www.voxelshare.com`. Firefox: **Storage** tab >
   **Cookies**.
4. Copy the value of the `token` cookie: a long value in three parts separated by dots, starting `eyJ`.

   ```text
   eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl
   ```

5. Right-click **VoxelShare** in **Configuration → Providers**, choose **Connect** and paste it.

The whole `Cookie` header of a signed-in www.voxelshare.com request works too, as does the `Authorization` header of one
of its API requests, or the cookie's row copied from the developer tools' cookie table. Thingport never uses the
`refresh_token` beside it.
