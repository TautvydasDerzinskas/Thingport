# <img src="../assets/providers/makeronline.svg" alt="" width="36" height="36" align="absmiddle"> MakerOnline

Anycubic's model platform, with print profiles, designer contests and free and paid models. Its details and public
collections need nothing, but its files are handed only to its own pages, so they always come through Thingport Grab.

| At a glance    |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Sign-in        | None to read; your own sign-in for your likes and private collections                          |
| Thingport Grab | **Required** -- every MakerOnline file is downloaded by Grab, in a makeronline.com page        |
| FlareSolverr   | Not used                                                                                       |
| Imports        | Models with print profiles, collections, your likes, [synced](../guides/synced-collections.md) |

## How it works

MakerOnline's download call wants a token that only its own anti-bot script makes, in a real makeronline.com page. So
[Thingport Grab](../../extension/README.md), allowed on MakerOnline from its popup, does the downloading:

- On a model page, Grab's panel imports it straight away, with the print profile you pick (or the designer's, or all of
  them), just like MakerWorld.
- A MakerOnline link pasted in Thingport, a collection or your likes imported in Thingport, and new models in a synced
  collection **wait for Grab**. The next time you open any makeronline.com page in a browser with Grab, it imports
  them there and files them where they were meant to go. A model that fails three times is dropped, with a
  notification saying why.

When MakerOnline wants a puzzle solved before it hands over a file, as it sometimes does, Grab shows the site's own
puzzle on the page you're importing from, as its Download button does; solve it and the import goes on. Imports waiting
for Grab can't show one, as nobody asked for them on that page: if one stops at a puzzle, import a model from its page,
solve the puzzle there, then reload.

## Setup: your sign-in

Per-user (**Configuration → Providers → MakerOnline**), only for your likes and private collections. Opening
makeronline.com signed in, with Grab allowed there, connects it. By hand:

1. Sign in at [makeronline.com](https://www.makeronline.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Cookies** > `https://www.makeronline.com`. Firefox: **Storage** tab >
   **Cookies**.
4. Copy the value of the cookie named `mo_access_token`. (The whole `Cookie` header works too.)
5. Right-click **MakerOnline** in **Configuration → Providers**, choose **Connect** and paste it.

It lasts about three months; Grab sends the new one whenever you sign in again.
