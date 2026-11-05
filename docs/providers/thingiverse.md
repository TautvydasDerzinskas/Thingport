# <img src="../assets/providers/thingiverse.svg" alt="" width="36" height="36" align="absmiddle"> Thingiverse

One of the oldest and largest libraries of user-made 3D printable designs, most of them openly licensed. Thingport reads
it through an App Token an admin sets once for the whole instance.

| At a glance    |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Sign-in        | One App Token for everyone, set by an admin                                                |
| Thingport Grab | Optional -- imports straight from Thingiverse pages                                        |
| FlareSolverr   | **Recommended** -- without it, imports fail whenever Cloudflare challenges the server      |
| Imports        | Models, collections, anyone's likes, [synced collections](../guides/synced-collections.md) |

## What comes in

- Every file of the thing, its photos, description, tags, category and author.
- Collections, and anyone's **Likes** page, to import or keep in sync.

## Setup

Instance-wide and admin-configured (**Configuration → Providers → Thingiverse**, or **Administration → Providers →
Thingiverse App Token**): one token serves every user's Thingiverse imports. Other users see Thingiverse as connected
once an admin has set it up.

1. Sign in to Thingiverse, then go to [thingiverse.com/apps/create](https://www.thingiverse.com/apps/create).
2. Register a new app. The name and description don't matter; pick an Application Type that doesn't ask for a redirect
   URL, such as "Desktop" or "Mobile" -- a "Web App" asks for OAuth details you don't need.
3. Thingiverse shows an **App Token** for it. It's not your password, but a permanent credential tied to that app.
4. Right-click **Thingiverse** in Thingport's **Configuration → Providers**, choose **Connect** and paste it. Thingport
   checks the token with Thingiverse before storing it, so a mistyped or revoked one is turned down at once.

Treat the token like a password. If it's ever exposed, revoke it from your Thingiverse account's Apps page and make a
new one.

Thingiverse sits behind Cloudflare, which sometimes challenges servers. Set up
[FlareSolverr](../PROVIDER_SETUP.md#flaresolverr) under **Administration → Connections** so those imports get
through.

Configuring the URL under **Administration → Connections → FlareSolverr** enables this fallback. Requests try
the guarded direct connection first. On a 429 or Cloudflare challenge, the fallback sends
the App Token (`access_token`) in the URL to the configured solver; ordinary credential rejections do not use it.
The solver and its logs may receive this secret. Use a private, isolated solver: its browser navigation and third-party
requests are outside Thingport's per-hop destination guard. Clearing the solver URL disables fallback for every provider and leaves direct requests active.
