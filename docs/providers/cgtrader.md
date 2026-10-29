# <img src="../assets/providers/cgtrader.svg" alt="" width="36" height="36" align="absmiddle"> CGTrader

A marketplace of over three million 3D models at [cgtrader.com](https://www.cgtrader.com), founded in Vilnius in
2011: game and film assets, renders, and a large 3D printing catalogue, sold by their designers and many of them free.
Its model pages are anyone's to read; its files, free ones included, go only to a signed-in user, and your liked
models and wishlist are yours alone to see.

| At a glance    |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Sign-in        | Your own CGTrader sign-in, per user, for the files, your likes and your wishlist                                  |
| Thingport Grab | Recommended -- it sends your sign-in as you visit cgtrader.com, with your browser's token for its bot check       |
| FlareSolverr   | Recommended -- it gets Thingport a token for the bot check of its own                                             |
| Imports        | Models, free or bought; your liked models and wishlist, [synced](../guides/synced-collections.md) too; categories |

## How it works

CGTrader has no public API, so Thingport reads what its own pages read: the JSON its listings answer with, the data a
model's page hands its components, and the small script a model's page loads to learn who's looking at it.

- **Models.** Paste a model link (`https://www.cgtrader.com/3d-print-models/<category>/<subcategory>/<name>`, or the
  same under `/3d-models/`, `/free-3d-print-models/` or `/free-3d-models/`) in Thingport, or import it from the model
  page with Grab. A model is kept by the name its links end in. Its page carries the description, the tags, the whole
  gallery, the designer and the details that matter for printing -- whether it's print-ready, its parts, units,
  formats and licence.
- **Files.** CGTrader lists a model's files one by one, often the same mesh in several formats. Thingport takes the
  ones a plate takes (STL, 3MF, STEP) and the zips that may hold some, skipping zips named for a format nothing prints
  from (a Blender scene, textures). OBJs come only when nothing else brought a model, as a CG model's OBJ can run to
  gigabytes. A model whose files are only in .rar or .7z archives can't be imported.
- **Free models.** They still need your sign-in. Each import counts as a download on CGTrader, as it would if you
  pressed Download yourself, and CGTrader limits free downloads: past the limit an import says when it resets.
- **Paid models.** Thingport imports one you have already bought. One you haven't is refused before anything is
  downloaded, and Grab's panel says so on its page. Thingport never buys anything.
- **Likes and wishlist.** Your [liked models](https://www.cgtrader.com/profile/liked_models) and your
  [wishlist](https://www.cgtrader.com/profile/wish-lists) are CGTrader's lists, and only you can see them, so
  Thingport reads them with your sign-in. Import them in one go, or sync them so new ones follow.
- **Categories.** A model's address names its category and subcategory (`jewelry/ring`), which is what Thingport maps,
  from both CGTrader's 3D printing catalogue and its CG one.
- **Trending.** The dashboard's trending panel shows CGTrader's trending 3D print models.
- **Browse tab.** With your sign-in, the sync dialog lists your liked models and your wishlist.

## The bot check

AWS's bot check (its WAF) stands in front of CGTrader's downloads and of the pages of its CG catalogue
(`/3d-models/…`). A browser passes it by running a short challenge, which leaves a token in its `aws-waf-token`
cookie; Thingport sends such a token with its requests. It isn't tied to the browser or the address that got it, so
there are two ways to get one, and either is enough:

- **Thingport Grab** sends your browser's along with your sign-in. Your browser gets one the first time it downloads
  something on CGTrader, or opens a page of its CG catalogue.
- **FlareSolverr** gets Thingport one of its own whenever the last one is turned down, by running the challenge in
  its browser. Set it up in **Administration → Connections**.

A token lasts a good while, but the check asks for a fresh one when it has been asked for a lot in a short time -- a
large list import, say. FlareSolverr answers that by itself; with Grab alone, such an import stops until your browser
has a new token.

## Setup: your sign-in

Per-user (**Configuration → Providers → CGTrader**). CGTrader signs you in with its `_cgtrader_session_id` cookie,
which lasts two weeks from its last use; Thingport's own use renews it.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on CGTrader, opening cgtrader.com while you're signed in
connects your account, and sends a new sign-in, or a new bot-check token, whenever either changes.

### Manual: copy it from your browser

1. Sign in at [cgtrader.com](https://www.cgtrader.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and go to the **Network** tab.
3. Reload the page, click any request to `www.cgtrader.com` and find its **Cookie** request header.
4. Copy the whole header value. It carries the `aws-waf-token` too, if your browser has one.
5. Right-click **CGTrader** in **Configuration → Providers**, choose **Connect** and paste it.
