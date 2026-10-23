# <img src="../assets/providers/makerworld.svg" alt="" width="36" height="36" align="absmiddle"> MakerWorld

Bambu Lab's platform for sharing 3D printable models, many with tuned print profiles, open to any printer. Thingport
imports a model with its print profiles, imports collections, and keeps them in sync.

| At a glance    |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own MakerWorld session cookie, per user                                                       |
| Thingport Grab | **Recommended** -- connects your cookie for you, and imports whole collections without rate limits |
| FlareSolverr   | Optional -- used only if Cloudflare ever challenges the server                                     |
| Imports        | Models with print profiles, collections, [synced collections](../guides/synced-collections.md)     |

## What comes in

- Every file of the model, and its print profiles: the one the link points to, all of the designer's, or the
  community's too. Each profile becomes its own 3MF file on the model, tagged with the profile.
- Models with no print profiles, only the files behind **Download STL/CAD files**, import with those files.
- Collections, private ones included, through your cookie. MakerWorld rate-limits bulk imports quickly, so collections
  are imported with Thingport Grab, which waits between models, and a synced collection brings in only models added
  from then on.
- MakerWorld's files are Bambu Studio projects; other slicers can open them as
  [normalized 3MFs](../features/normalized-3mf.md).

## Setup

MakerWorld has no developer API, so Thingport imports as _your own_ signed-in MakerWorld session, captured as a cookie.

### Easiest: Thingport Grab

[Thingport Grab](../../extension/README.md) reads the cookie the first time you import from a MakerWorld tab where
you're signed in, and connects MakerWorld in **Configuration → Providers** for you. There's nothing to copy by hand.

### Manual: copy it from your browser

1. Sign in at [makerworld.com](https://makerworld.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://makerworld.com`. Firefox: **Storage** tab > **Cookies**.
4. Copy the **Value** of the cookie named `token`.
5. Right-click **MakerWorld** in Thingport's **Configuration → Providers**, choose **Connect** and paste it. Thingport
   checks it with MakerWorld before storing it.

If there's no cookie named `token` (MakerWorld occasionally renames things), use the **Network** tab instead: reload the
page, pick any request to `makerworld.com`, and copy the whole `cookie:` request header. Thingport keeps only the
`token=...` part.

This is your own MakerWorld login session -- don't share it. MakerWorld sessions expire now and then; Thingport says so,
and Grab or a fresh paste connects it again.

## Limits

- A MakerWorld CAPTCHA or daily download limit pauses imports and syncs until it clears.
