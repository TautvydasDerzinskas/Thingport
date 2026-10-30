# <img src="../assets/providers/toymakr3d.svg" alt="" width="36" height="36" align="absmiddle"> Toymakr3D

One designer's site of articulated robot and mecha models at [toymakr3d.com](https://www.toymakr3d.com) --
Transformers, Megazords, Gundams and the like, most of them free, the rest sold. Its model pages are anyone's to
read; its files, free ones included, go only to a signed-in user, and your liked products are yours alone to see.

| At a glance    |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Sign-in        | Your own Toymakr3D sign-in, per user, for the files and your likes                         |
| Thingport Grab | Recommended -- it sends your sign-in as you visit toymakr3d.com                            |
| FlareSolverr   | Not used                                                                                   |
| Imports        | Models; your liked products, [synced](../guides/synced-collections.md) too; its categories |

## How it works

Toymakr3D is a shop with no API of its own, so Thingport reads its pages, as a browser would.

- **Models.** Paste a model link (`https://www.toymakr3d.com/product/<id>-<name>`) in Thingport, or import it from
  the model page with Grab. A model is one print of the zip Toymakr3D hands over, unpacked into its files. Its page
  carries the description, the printing settings from its **Setting** tab, the whole gallery and the designer.
- **Free models.** They still need your sign-in: Toymakr3D sends anyone else to its sign-in page. Each import counts
  as one download in your **Free Download History**, as it would if you pressed Download yourself.
- **Paid models.** Thingport imports one you have already bought, from your account. Toymakr3D watermarks a buyer's
  files and builds the zip when it's first asked for, so an import started while that is still running says so --
  wait a minute and import it again. Thingport never buys anything.
- **Likes.** Your [liked products](https://www.toymakr3d.com/like-product) are Toymakr3D's only list, and only you
  can see them, so Thingport reads them with your sign-in. Import them in one go, or sync them so new ones follow.
- **Categories.** A model's page doesn't say which of Toymakr3D's categories it is in -- only its category listings
  do -- so Thingport reads those listings and keeps what it found for a few hours. Its "All Products", "Free
  Download" and "Premium" menu entries are price buckets rather than subjects, so they're left out of the mapping.
- **Browse tab.** With your sign-in, the sync dialog lists your liked products.

## Setup: your sign-in

Per-user (**Configuration → Providers → Toymakr3D**). Toymakr3D signs you in with two cookies: `toymakr3dcom_session`,
and a `remember_web_…` cookie that signs you in again once that one runs out. Thingport keeps both.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Toymakr3D, opening toymakr3d.com while you're signed in
connects your account, and sends a new sign-in whenever you sign in there again.

### Manual: copy it from your browser

1. Sign in at [toymakr3d.com](https://www.toymakr3d.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and go to the **Network** tab.
3. Reload the page, click any request to `www.toymakr3d.com` and find its **Cookie** request header.
4. Copy the whole header value.
5. Right-click **Toymakr3D** in **Configuration → Providers**, choose **Connect** and paste it.
