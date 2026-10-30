# <img src="../assets/providers/cults3d.svg" alt="" width="36" height="36" align="absmiddle"> Cults3D

A French marketplace for free and paid 3D printable designs, founded in 2014. Thingport reads it with your own API key,
and downloads files with your browser's sign-in.

| At a glance    |                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own API key, and your browser's sign-in for files, per user                                        |
| Thingport Grab | **Recommended** -- sends the browser's sign-in and Cloudflare clearance, and again whenever they change |
| FlareSolverr   | Doesn't help -- its browser can't hand over a download link                                             |
| Network        | Thingport must reach the internet from the same IP address as your browser, as a server at home does    |
| Imports        | Free and bought models, anyone's likes, your printlists, [synced](../guides/synced-collections.md)      |

## What comes in

- **Free models** you haven't downloaded yet are added to your Cults3D downloads first, as the site's own Download
  button does. A model comes in as the zip Cults3D builds of its files, each one its own file in Thingport.
- **Paid models** download once you've bought them. Paid models you don't own are left out of likes and printlist
  imports and syncs.
- Anyone's likes, and your own printlists (Cults3D's collections; its API shows no one else's).

## Setup

Per-user (**Configuration → Providers → Cults3D**), in two parts. Both have to be the **same Cults3D account**: a
download link comes from your API key's own orders, and Cults3D gives an order's files only to the account that placed
it. Thingport reads which account your browser is signed in as and says so before an import if the two differ.

### 1. Your API key

It reads everything but the files. Make one at [cults3d.com/en/api/keys](https://cults3d.com/en/api/keys), then
right-click **Cults3D** in **Configuration → Providers**, choose **Connect**, and enter your nickname exactly as your
profile writes it (its capitals count) and the key's secret. Thingport checks them with Cults3D before storing them.

### 2. Your browser's sign-in

The files are on Cults3D's own pages, behind a Cloudflare check only a browser passes, so Thingport uses your
browser's: the `_session_id` sign-in cookie and the `cf_clearance` cookie Cloudflare gave your browser, sent with that
browser's User-Agent. Cloudflare ties the clearance to your IP address too. The sign-in lasts 20 days from its last
use, and Thingport's own use renews it.

**Easiest:** with [Thingport Grab](../../extension/README.md) allowed on Cults3D, opening cults3d.com while you're
signed in sends the sign-in and clearance. If Cults3D turns them down, Thingport says so, and your next visit sends new
ones.

**Manual:**

1. Sign in at [cults3d.com](https://cults3d.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and reload the page.
3. On the **Network** tab, pick the page's own request and copy its request headers, with the `Cookie` and
   `User-Agent` ones.
4. Right-click **Cults3D** in **Configuration → Providers**, choose **Paste browser sign-in** and paste them.
