# <img src="../assets/providers/nexprint.svg" alt="" width="36" height="36" align="absmiddle"> NexPrint

Elegoo's open model platform, launched in 2025, with print profiles and Elegoo Slicer and OrcaSlicer built in. Its
details and collections, private ones included, need nothing; its files go only to a signed-in user.

| At a glance    |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Sign-in        | Your own NexPrint sign-in, per user; the site renews it as you use it                            |
| Thingport Grab | **Recommended** -- sends the renewed sign-in as you visit                                        |
| FlareSolverr   | Not used                                                                                         |
| Imports        | Models with print profiles, collections (private too), [synced](../guides/synced-collections.md) |

## What comes in

- A model comes in like a MakerWorld one: its print profile's 3MF, as a file tagged with the profile. Another profile
  (`?printConfigId=` in the link, or picking the designer's or all profiles) adds more; a model without print profiles
  brings its model files instead.
- Collections, private ones too. NexPrint lists no liked models anywhere, so there are no likes to import.
- Its 3MFs are Elegoo Slicer projects; other slicers open them as [adapted 3MFs](../features/adapted-3mf.md), and Thingport
  Grab downloads them adapted on NexPrint itself, once you allow it there.

## Setup

Per-user (**Configuration → Providers → NexPrint**). The sign-in is the `auth_token` cookie, which the API takes as a
Bearer token. The site keeps it for a week and sets it again as it refreshes the token while you use it.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on NexPrint, opening nexprint.com while you're signed in
connects your account, and sends the new token whenever the site renews it. If NexPrint turns it down, Thingport says
the sign-in ran out, and your next visit connects it again.

### Manual: copy it from your browser

1. Sign in at [nexprint.com](https://www.nexprint.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and reload the page.
3. On the **Network** tab, pick any request to `nexprint.com/gateway` and copy its `Authorization` request header (or
   the `auth_token` cookie, or the whole `Cookie` header).
4. Right-click **NexPrint** in **Configuration → Providers**, choose **Connect** and paste it.
