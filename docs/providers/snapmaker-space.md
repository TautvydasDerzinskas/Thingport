# <img src="../assets/providers/snapmaker-space.svg" alt="" width="36" height="36" align="absmiddle"> Snapmaker Space

Snapmaker's model platform, built around its U1 printer, with print profiles tuned for multi-colour prints. Its files go
only to signed-in users, so every import runs as you.

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
5. Right-click **Snapmaker Space** in **Configuration → Providers**, choose **Connect** and paste it.

A sign-in pasted by hand lasts a day. Don't copy `login_refresh_token`: renewing with it would sign your browser out of
Snapmaker.
