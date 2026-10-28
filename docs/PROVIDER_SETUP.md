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
- <img src="assets/providers/owlcad.svg" alt="" width="18" height="18" align="absmiddle"> [OwlCAD](providers/owlcad.md) -- no sign-in at all; its CAD projects need Thingport Grab.
- <img src="assets/providers/toymakr3d.svg" alt="" width="18" height="18" align="absmiddle"> [Toymakr3D](providers/toymakr3d.md) -- your own sign-in, for the files and your likes; its models read without one.
- <img src="assets/providers/makerables.svg" alt="" width="18" height="18" align="absmiddle"> [Makerables](providers/makerables.md) -- no sign-in to import; yours adds your saved projects.

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
| <img src="assets/providers/owlcad.svg" alt="" width="18" height="18" align="absmiddle"> [OwlCAD](providers/owlcad.md)                            | None                            | Recommended⁴   |              |             |       |      |                |
| <img src="assets/providers/toymakr3d.svg" alt="" width="18" height="18" align="absmiddle"> [Toymakr3D](providers/toymakr3d.md)                   | Yours, for the files            | Recommended    |              |             | ✓⁵    | ✓    |                |
| <img src="assets/providers/makerables.svg" alt="" width="18" height="18" align="absmiddle"> [Makerables](providers/makerables.md)                | Yours, for saved projects only  | Recommended    |              | Saved       |       | ✓    |                |

1. Your private Printables collections and your likes are read by Grab, while you're on Printables.
2. Snapmaker's sign-in lasts a day and only Grab renews it; without Grab you paste a new one every day.
3. Cults3D's files need your browser's Cloudflare clearance, and Thingport on the same IP address as that browser.
4. A gallery item that is a CAD project, rather than a library part, has no stored mesh: OwlCAD's editor builds its file, so Thingport Grab exports it on owlcad.com.
5. Toymakr3D hands a model's files to signed-in users only, the free ones included, and shows your likes to you alone.

<!-- /providers:table -->

**Sign-in** is what Thingport needs before it can import; "yours" means each user connects their own account.

## Dependencies

### Thingport Grab

[Thingport Grab](../extension/README.md) is Thingport's browser extension for Chrome, Edge and Firefox. Besides
importing straight from a model's page, it hands your browser's sign-in to Thingport, so the sites that need one connect
by just being visited, and stay connected. On MakerOnline it does the downloading itself, so there it's required.
Sites after MakerWorld, Printables and Thingiverse need one click first: **Enable** next to the site in Grab's popup.
Install it from the **Downloads** page.

### FlareSolverr

Printables, Thingiverse and MyMiniFactory sit behind Cloudflare, which now and then challenges a server instead of
answering it. [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) gets past those challenges with a real
browser. It's part of the standard Docker Compose stack; its address is set under **Administration → Connections →
FlareSolverr**, and [System Health](guides/system-health.md) checks it. Without it, imports and syncs from those sites
fail whenever Cloudflare steps in. MakerWorld and Thangs use it only as a fallback, and it can't help with Cults3D.

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
