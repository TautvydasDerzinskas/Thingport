# <img src="../assets/providers/snapmaker-space.svg" alt="" width="36" height="36" align="absmiddle"> Snapmaker Space

Snapmaker's model platform, built around its U1 printer, with print profiles tuned for multi-colour prints, and at
[space.snapmaker.cn](https://space.snapmaker.cn) in China. Its files go only to signed-in users, so every import runs as
you.

| At a glance    |                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Sign-in        | Your own Snapmaker sign-in, per user                                                            |
| Thingport Grab | **Recommended, close to required** -- the sign-in lasts a day, and only Grab renews it          |
| FlareSolverr   | Not used                                                                                        |
| Imports        | Models with print profiles, your likes and bookmarks, [synced](../guides/synced-collections.md) |

## What comes in

- A model comes in like a MakerWorld one: its print profile's 3MF, as a file tagged with the profile. Importing it
  again with another profile, or picking the designer's or all profiles, adds more. A model without print profiles
  brings its model files instead.
- Your likes and bookmarks, from your profile's **Interactions** tab, to import or keep in sync.
- Its 3MFs are Snapmaker Orca projects; other slicers open them as [adapted 3MFs](../features/adapted-3mf.md), and Thingport
  Grab downloads them adapted on Snapmaker Space itself, once you allow it there.

## Its China site

[space.snapmaker.cn](https://space.snapmaker.cn) works the same, from its own links: a model, or your likes and
bookmarks there, import and sync from it. It has models, featured models and accounts of its own, so:

- Thingport keeps what it reads from there apart from the main site's, so its links go back to space.snapmaker.cn. The
  two sites number their models separately: the same number is a different model on each.
- Your likes and bookmarks there are lists of their own (**Snapmaker Space China likes** and **bookmarks**), and the
  Browse tab lists each signed-in site's.
- Its sign-in is one of its own, renewed by Grab like the main site's: connect it as below, with **China** picked at the
  top of the form, or open space.snapmaker.cn signed in with Grab. Either site's sign-in connects the Snapmaker Space
  tile, and its menu offers the other.
- The dashboard's trending card shows its featured models to someone signed in there and not on the main site.
- Grab asks for the China site when you allow it on Snapmaker Space. If you allowed it before the China site was
  added, Grab keeps working on space.snapmaker.com; to use it on the China site too, allow Grab on space.snapmaker.cn
  and id.snapmaker.cn in your browser's extension settings (site access).

## Setup

Per-user (**Configuration → Providers → Snapmaker Space**). Snapmaker's sign-in lasts a day, and its renewal can be used
only once: whoever renews it signs out anyone else still holding the old one. So Thingport never renews it itself.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Snapmaker Space, opening space.snapmaker.com while you're
signed in connects your account. From then on Grab renews the sign-in for your browser and Thingport together, every
few hours while the browser is open. If the browser stays closed for a day, Thingport says the sign-in ran out, and the
next visit connects it again.

### Manual: copy it from your browser

1. Sign in at [space.snapmaker.com](https://space.snapmaker.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://space.snapmaker.com`. Firefox: **Storage** tab >
   **Cookies**.
4. Copy the value of the cookie named `login_access_token`. (The whole `Cookie` header, or an `Authorization: Bearer`
   value, works too.)
5. Right-click **Snapmaker Space** in **Configuration → Providers**, choose **Connect** and paste it. For the China
   site, copy it from `https://space.snapmaker.cn` instead and pick **China** at the top of the form.

A sign-in pasted by hand lasts a day. Don't copy `login_refresh_token`: renewing with it would sign your browser out of
Snapmaker.
