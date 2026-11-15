# <img src="../assets/providers/creality-cloud.svg" alt="" width="36" height="36" align="absmiddle"> Creality Cloud

Creality's 3D printing platform: a large library of free and premium models, with print profiles for its printers. Its
details and collections need nothing; its files and your likes go only to a signed-in user.

| At a glance    |                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Sign-in        | Your own Creality Cloud sign-in, per user; lasts a week                                                      |
| Thingport Grab | **Recommended** -- sends each new sign-in as you sign in on the site                                         |
| FlareSolverr   | Not used                                                                                                     |
| Imports        | Models with print profiles, collections (private too), your likes, [synced](../guides/synced-collections.md) |

## What comes in

- A model comes in like a MakerWorld one: its print profile's 3MF, as a file tagged with the profile. Another profile,
  or the designer's or all profiles, adds more; a model without print profiles brings its model files instead.
- Collections, private ones included, read with nothing; your likes, through your sign-in.
- Its 3MFs are Creality Print projects; other slicers open them as [adapted 3MFs](../features/adapted-3mf.md), and Thingport
  Grab downloads them adapted on Creality Cloud itself, once you allow it there.

## Setup

Per-user (**Configuration → Providers → Creality Cloud**). The sign-in is two cookies, `model_token` and
`model_user_id`, which its API takes together. The site sets them once when you sign in, for a week, and never renews
them; Thingport doesn't either.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Creality Cloud, opening crealitycloud.com while you're
signed in connects your account, and sends the new sign-in each time you sign in there again. Once a week has passed,
Thingport says the sign-in ran out.

### Manual: copy it from your browser

1. Sign in at [crealitycloud.com](https://www.crealitycloud.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and reload the page.
3. On the **Network** tab, pick any request to `crealitycloud.com/api` and copy its `Cookie` request header. (Its
   `__cxy_token_` and `__cxy_uid_` request headers, copied together, work too.)
4. Right-click **Creality Cloud** in **Configuration → Providers**, choose **Connect** and paste it.
