# Providers

Thingport imports from the model sites below. **MakerWorld**, **Printables** and **Thingiverse** are the main ones and
have been supported the longest; the rest came later. Each has a page of its own with what it imports, what it needs and
how to connect it:

<!-- providers:list -->
<!-- Written by scripts/sync-providers.mjs from providers/: change it there. -->

- <img src="assets/providers/makerworld.svg" alt="" width="18" height="18" align="absmiddle"> [MakerWorld](providers/makerworld.md) -- your own session cookie; Thingport Grab connects it for you.
- <img src="assets/providers/printables.svg" alt="" width="18" height="18" align="absmiddle"> [Printables](providers/printables.md) -- works out of the box.
- <img src="assets/providers/thingiverse.svg" alt="" width="18" height="18" align="absmiddle"> [Thingiverse](providers/thingiverse.md) -- one App Token, set by an admin.
- <img src="assets/providers/myminifactory.svg" alt="" width="18" height="18" align="absmiddle"> [MyMiniFactory](providers/myminifactory.md) -- one API key, set by an admin; your own sign-in for paid models.
- <img src="assets/providers/snapmaker-space.svg" alt="" width="18" height="18" align="absmiddle"> [Snapmaker Space](providers/snapmaker-space.md) -- your own sign-in, which only Thingport Grab keeps alive.
- <img src="assets/providers/makeronline.svg" alt="" width="18" height="18" align="absmiddle"> [MakerOnline](providers/makeronline.md) -- its files come only through Thingport Grab.
- <img src="assets/providers/creality-cloud.svg" alt="" width="18" height="18" align="absmiddle"> [Creality Cloud](providers/creality-cloud.md) -- your own sign-in, for a week at a time.
- <img src="assets/providers/nexprint.svg" alt="" width="18" height="18" align="absmiddle"> [NexPrint](providers/nexprint.md) -- your own sign-in, renewed as you use the site.
- <img src="assets/providers/thangs.svg" alt="" width="18" height="18" align="absmiddle"> [Thangs](providers/thangs.md) -- your own sign-in, which Thingport renews for about a year.
- <img src="assets/providers/cults3d.svg" alt="" width="18" height="18" align="absmiddle"> [Cults3D](providers/cults3d.md) -- your own API key, and your browser's sign-in for files.
- <img src="assets/providers/eufymake.svg" alt="" width="18" height="18" align="absmiddle"> [eufyMake](providers/eufymake.md) -- no sign-in to import; yours adds your likes.
- <img src="assets/providers/pinshape.svg" alt="" width="18" height="18" align="absmiddle"> [Pinshape](providers/pinshape.md) -- your own sign-in, for the files; collections and likes read without it.

<!-- /providers:list -->

Inside Thingport, **About** in a provider's menu under **Configuration → Providers**, or a click on a model's provider
badge, shows the same in short.

## At a glance

<!-- providers:table -->
<!-- Written by scripts/sync-providers.mjs from providers/: change it there. -->

| Provider                                                                                                                                         | Sign-in                         | Thingport Grab | FlareSolverr | Collections | Likes | Sync | Print profiles |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------- | ------------ | ----------- | ----- | ---- | -------------- |
| <img src="assets/providers/makerworld.svg" alt="" width="18" height="18" align="absmiddle"> [MakerWorld](providers/makerworld.md)                | Your cookie                     | Recommended    | Optional     | ✓           |       | ✓    | ✓              |
| <img src="assets/providers/printables.svg" alt="" width="18" height="18" align="absmiddle"> [Printables](providers/printables.md)                | None                            | Optional¹      | Recommended  | ✓           | ✓¹    | ✓    |                |
| <img src="assets/providers/thingiverse.svg" alt="" width="18" height="18" align="absmiddle"> [Thingiverse](providers/thingiverse.md)             | Admin's App Token               | Optional       | Recommended  | ✓           | ✓     | ✓    |                |
| <img src="assets/providers/myminifactory.svg" alt="" width="18" height="18" align="absmiddle"> [MyMiniFactory](providers/myminifactory.md)       | Admin's API key, yours for paid | Optional       | Recommended  | ✓           |       | ✓    |                |
| <img src="assets/providers/snapmaker-space.svg" alt="" width="18" height="18" align="absmiddle"> [Snapmaker Space](providers/snapmaker-space.md) | Yours, for a day                | Recommended²   |              | Bookmarks   | ✓     | ✓    | ✓              |
| <img src="assets/providers/makeronline.svg" alt="" width="18" height="18" align="absmiddle"> [MakerOnline](providers/makeronline.md)             | Yours, for likes only           | **Required**   |              | ✓           | ✓     | ✓    | ✓              |
| <img src="assets/providers/creality-cloud.svg" alt="" width="18" height="18" align="absmiddle"> [Creality Cloud](providers/creality-cloud.md)    | Yours, for a week               | Recommended    |              | ✓           | ✓     | ✓    | ✓              |
| <img src="assets/providers/nexprint.svg" alt="" width="18" height="18" align="absmiddle"> [NexPrint](providers/nexprint.md)                      | Yours                           | Recommended    |              | ✓           |       | ✓    | ✓              |
| <img src="assets/providers/thangs.svg" alt="" width="18" height="18" align="absmiddle"> [Thangs](providers/thangs.md)                            | Yours, renewed for a year       | Recommended    | Optional     | ✓           | ✓     | ✓    |                |
| <img src="assets/providers/cults3d.svg" alt="" width="18" height="18" align="absmiddle"> [Cults3D](providers/cults3d.md)                         | Your API key + browser sign-in  | Recommended³   |              | Printlists  | ✓     | ✓    |                |
| <img src="assets/providers/eufymake.svg" alt="" width="18" height="18" align="absmiddle"> [eufyMake](providers/eufymake.md)                      | Yours, for likes only           | Recommended    |              |             | ✓     | ✓    |                |
| <img src="assets/providers/pinshape.svg" alt="" width="18" height="18" align="absmiddle"> [Pinshape](providers/pinshape.md)                      | Yours, for the files            | Recommended    |              | ✓           | ✓     | ✓    |                |

1. Your private Printables collections and your likes are read by Grab, while you're on Printables.
2. Snapmaker's sign-in lasts a day and only Grab renews it; without Grab you paste a new one every day.
3. Cults3D's files need your browser's Cloudflare clearance, and Thingport on the same IP address as that browser.

<!-- /providers:table -->

**Sign-in** is what Thingport needs before it can import; "yours" means each user connects their own account.

## Dependencies

### Thingport Grab

[Thingport Grab](../extension/README.md) is Thingport's browser extension for Chrome, Edge and Firefox. Besides
importing straight from a model's page, it hands your browser's sign-in to Thingport, so the sites that need one connect
by just being visited, and stay connected. On MakerOnline it does the downloading itself, so there it's required.
Sites after MakerWorld, Printables and Thingiverse need one click first: **Enable** next to the site in Grab's popup.
Install it from the **Downloads** page. If a reverse proxy redirects your Thingport instance URL (for example,
from HTTP to HTTPS), enter the final HTTPS URL in Grab; instance requests reject redirects.

### FlareSolverr

[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) uses a real browser to solve Cloudflare challenges.
It's part of the standard Docker Compose stack. Set its global URL under **Administration → Connections →
FlareSolverr** to enable fallback for all declared provider routes. [System Health](guides/system-health.md) checks
the service. Clearing the URL disables all fallbacks, including when a previous request warmed the proxy cache.

Thingiverse and MyMiniFactory API requests first use guarded direct transport with a Chrome-like TLS handshake.
Only a 429 or Cloudflare challenge retries through the enabled solver, including the Thingiverse `access_token` or
MyMiniFactory `key` in the URL. Ordinary 401/403 rejections remain credential errors. MakerWorld, Printables and
Thangs support selected page/API fallbacks; Cults3D supports public pages only. Binary downloads, authenticated
Cults3D calls and MakerWorld's separate Bambu cloud API do not support solver fallback.

**Use a private, isolated solver.** It receives provider cookies and URL API tokens, and its logs may record them.
Thingport checks the initial HTTPS host, path and query against each provider's declarations, but the solver's
browser navigation, redirects and third-party requests are outside Thingport's per-hop destination guard. Isolate
its network access from private services and restrict access to the solver and its logs.

## Connecting a provider

Connect them under **Configuration → Providers**: open the user menu (your avatar, top right) and choose
**Configuration**, or click one of the provider chips at the bottom of that menu. Right-click a provider to connect or
disconnect it, or double-click one that isn't connected yet. A green tick means it's connected. A provider your admin
has [turned off](#turning-a-provider-off) isn't listed.

![Configuration, Providers section with MakerWorld, Thingiverse, Printables and MyMiniFactory connected](../frontend/src/assets/screenshots/11_configuration_providers.png)

## Turning a provider off

Admins choose which providers this Thingport imports from, under **Administration → Providers**. All are on by
default. Turn one off and nothing new comes from it for anyone: links to it, Thingport Grab and the import queue are
refused, its synced collections pause, and background jobs skip it. It also disappears from everyone's
**Configuration → Providers**. Models already imported from it stay as they are, and turning it back on picks up where
it left off. The Thingiverse App Token and the MyMiniFactory API key are set on the same page.
