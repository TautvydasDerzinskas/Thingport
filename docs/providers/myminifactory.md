# <img src="../assets/providers/myminifactory.svg" alt="" width="36" height="36" align="absmiddle"> MyMiniFactory

A curated marketplace of free and paid 3D printable files, best known for tabletop miniatures. Thingport reads it with
an API key an admin sets once; each user's own sign-in adds the models they bought.

| At a glance    |                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Sign-in        | One API key for everyone, set by an admin; your own MyMiniFactory session for paid models         |
| Thingport Grab | Optional -- connects your session for you                                                         |
| FlareSolverr   | **Recommended** -- without it, imports fail whenever Cloudflare challenges the server             |
| Imports        | Free and bought models, public collections, [synced collections](../guides/synced-collections.md) |

## What comes in

- With the API key alone, free models, their details, collections and authors, for everyone.
- With your own session, the **paid models you bought**, and free ones whose files only download when signed in, from
  your MyMiniFactory library. Where MyMiniFactory has unpacked a model's archives, Thingport fetches just the model
  files from them, so RAR archives and very large zips are no problem.
- A paid model you haven't bought can't be imported, and a collection's paid models are left out of its sync.

## Setup: the API key

Instance-wide and admin-configured (**Administration → Providers → MyMiniFactory API key**).

1. Sign in to MyMiniFactory, then go to
   [myminifactory.com/settings/developer](https://www.myminifactory.com/settings/developer).
2. Create an application. Its name doesn't matter.
3. Copy the application's **API key** -- not its client ID or client secret, which are for signing users in.
4. Save it under **Administration → Providers → MyMiniFactory API key**. Thingport checks it with MyMiniFactory first.

## Setup: your account

Per-user (**Configuration → Providers → MyMiniFactory**), only for paid and sign-in-only models.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on MyMiniFactory, opening a myminifactory.com page while
you're signed in connects your account. MyMiniFactory renews that session from time to time; the next page you open
sends the new one.

### Manual: copy it from your browser

1. Sign in at [myminifactory.com](https://www.myminifactory.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://www.myminifactory.com`. Firefox: **Storage** tab >
   **Cookies**.
4. Copy the value of the cookie named `PHPSESSID`. (The whole `Cookie` request header works too.)
5. Right-click **MyMiniFactory** in **Configuration → Providers**, choose **Connect** and paste it.

It's your own login session -- don't share it. It expires once you sign out of MyMiniFactory, or after a while;
Thingport then says so, and opening MyMiniFactory with Grab connects it again.

MyMiniFactory sits behind Cloudflare. Set up [FlareSolverr](../PROVIDER_SETUP.md#flaresolverr) so imports get through
when it challenges the server.

Configuring the URL under **Administration → Connections → FlareSolverr** enables this fallback. Requests try
the guarded direct connection first. On a 429 or Cloudflare challenge, the fallback sends
the API key (`key`) in the URL to the configured solver; ordinary credential rejections do not use it.
The solver and its logs may receive this secret. Use a private, isolated solver: its browser navigation and third-party
requests are outside Thingport's per-hop destination guard. Clearing the solver URL disables fallback for every provider and leaves direct requests active.
