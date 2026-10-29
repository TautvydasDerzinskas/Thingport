# <img src="../assets/providers/grabcad.svg" alt="" width="36" height="36" align="absmiddle"> GrabCAD

Stratasys's community of engineers, at [grabcad.com](https://grabcad.com): a free library of millions of CAD models,
from single parts to whole machines, mostly shared as STEP files beside their CAD system's own. Its models, their file
lists and anyone's likes are anyone's to read; downloading a file takes a signed-in user.

| At a glance    |                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own GrabCAD sign-in, per user, for the files                                                     |
| Thingport Grab | Recommended -- it sends your sign-in as you visit grabcad.com                                         |
| FlareSolverr   | Not used                                                                                              |
| Imports        | Models; anyone's likes, [synced](../guides/synced-collections.md) too; categories mapped from its own |

## How it works

GrabCAD's library is a web app over a JSON API of its own, which is what Thingport reads: a model's details, its
gallery, and its files folder by folder. Only a file's download link needs your sign-in.

- **Models.** Paste a model link (`https://grabcad.com/library/<name>`) in Thingport, or import it from the model page
  with Grab. Most of GrabCAD's models are CAD parts, often the same part as STEP, IGES, Parasolid and in the format of
  the CAD system it was drawn in. Thingport imports what a slicer opens -- STEP, STL, 3MF -- and the zips its models
  list as one of those formats; OBJ files, and zips of a CAD system's own files, only when nothing else brought a model.
  A model shared only in CAD systems' own formats (`.SLDPRT`, `.ipt`, `.x_t`, …) has nothing Thingport can import.
- **Categories.** A model can be in several of GrabCAD's categories, which it lists alphabetically; the broad ones (3D
  printing, Educational, Miscellaneous, Just for fun) count last when Thingport files it.
- **Likes.** Someone's likes are their profile's **Likes** tab, `https://grabcad.com/<member>/likes`, anyone's to read.
  Import them, or sync them so new likes come in as they're added. The import dialog lists the first 600.
- **Browse tab.** With your sign-in, the sync dialog lists your own likes. GrabCAD's community has no collections.
- **Trending.** The dashboard's panel shows its library's **Popular** models in the 3D printing category with STL
  files.

## Setup: your sign-in

Per-user (**Configuration → Providers → GrabCAD**). GrabCAD keeps you signed in with one cookie, `_grabcad_session`.
It has no "remember me": a sign-in lasts two days from its last use, Thingport's imports included, so one that sits
unused for longer has to be sent again.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on GrabCAD, opening grabcad.com while you're signed in
connects your account, and sends a new sign-in whenever yours changes there. Visiting the site now and then keeps it
alive.

### Manual: copy it from your browser

1. Sign in at [grabcad.com](https://grabcad.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://grabcad.com`. Firefox: **Storage** tab > **Cookies**.
4. Copy the value of `_grabcad_session`. (The `Cookie` request header of any signed-in request to grabcad.com works
   too.)
5. Right-click **GrabCAD** in **Configuration → Providers**, choose **Connect** and paste it.
