# <img src="../assets/providers/meshy.svg" alt="" width="36" height="36" align="absmiddle"> Meshy

An AI 3D model generator at [meshy.ai](https://www.meshy.ai): it turns a prompt or a picture into a textured model,
and its community shares the results as posts -- hundreds of thousands of them, the ones fit to print marked so.
Posts and collections are anyone's to read, but Meshy hands a model's files only to a signed-in account, converted
for it and counted against its downloads.

| At a glance    |                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own Meshy sign-in, for every download. Community models also need a Meshy **Pro** or **Studio** plan              |
| Thingport Grab | Recommended -- it sends your sign-in as you visit meshy.ai                                                             |
| FlareSolverr   | Not used                                                                                                               |
| Imports        | Community posts; your own generations; collections and your generations, [synced](../guides/synced-collections.md) too |

## How it works

Meshy is a site over an API of its own, which Thingport reads the way its own pages do.

- **Posts.** Paste a post link (`https://www.meshy.ai/posts/<name>-<id>`, or the older `.../3d-models/<name>-<id>`)
  in Thingport, or import it from the post's page with Grab. The post brings its title, description, tags, creator,
  categories and every picture in it -- the photos of prints people post beside a model too. A post without a title
  is named after the prompt its model was generated from.
- **Which files.** The model you see on a post's page isn't a file you can download: the viewer streams an encrypted
  format of Meshy's own. A download is Meshy converting the model for your account, which is what its Download button
  does, and Thingport asks for the same conversion. It takes the **3MF**, which Meshy makes print-ready: 75 mm tall,
  standing on the plate. Scale it in your slicer as you like. A post with several models brings each as its own plate.
- **Plans and limits.** Each download counts against your Meshy account's own, as one from the site would. Meshy
  keeps other people's community models for its **Pro** and **Studio** plans: on a free plan an import of one stops
  and says so, and Thingport Grab shows **Needs Meshy Pro** on such a post instead of an import button. A post of your
  own imports as your generation, which a free plan downloads, except the models Meshy's AI agent made: Meshy keeps
  those for paid plans, and Grab shows **Needs a paid Meshy plan** on them. When you import a collection or your
  generations, the models your plan can't download come unticked, with the reason, both in Thingport's import dialog
  and in Grab's panel. Once a month's downloads are used up, an import stops with that, and a synced list picks up
  where it left off on a later check.
- **Your generations.** The models you generate are in your workspace. Open one (`https://www.meshy.ai/workspace?task=<id>`)
  and import it like a post, or sync the whole workspace from the Browse tab, and what you generate next comes in
  on the next check. It's named after the model and carries the prompt it was made from. The examples Meshy puts in
  every new workspace are its own models, so a sync leaves them out; a link to one still imports. The workspace has no
  address of its own on the site, so Thingport keeps it as `.../workspace?user=<your Meshy id>`.
- **Collections.** A collection's link (`https://www.meshy.ai/collections/<id>`) imports its posts, or syncs them so
  new ones follow. Likes are counted but never listed anywhere, so Thingport can't read them.
- **Categories.** A post says which of Meshy's categories it's in, and Thingport maps those onto your own.
- **Browse tab.** With your sign-in, the sync dialog lists your generations and the collections you made.
- **Trending.** The dashboard's trending panel shows the most popular posts marked printable.

## Setup: your sign-in

Per-user (**Configuration → Providers → Meshy**). Meshy signs you in with Supabase, which keeps the session -- a
15-minute access token and the refresh token that renews it -- in an `sb-auth-auth-token` cookie, split across
`sb-auth-auth-token.0`, `.1`, … once it outgrows one. Thingport keeps both and renews the access token itself as it
runs out, as the site's pages do, while your browser renews its own. Each renewal spends the refresh token it used,
and the two start from the same one; in testing Meshy let both carry on renewing without signing either out. Should it
ever end the sign-in for both, sign in to meshy.ai again: Grab connects Thingport with the new sign-in on that visit.
Thingport sends your browser's device id along too, so Meshy counts it as the browser it came from rather than a new
device.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Meshy, opening meshy.ai while you're signed in connects
your account, and sends your sign-in on whenever it changes there.

### Manual: copy it from your browser

1. Sign in at [meshy.ai](https://www.meshy.ai).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and go to the **Network** tab.
3. Reload the page, click any request to `www.meshy.ai` and find its **Cookie** request header.
4. Copy the whole header value.
5. Right-click **Meshy** in **Configuration → Providers**, choose **Connect** and paste it.
