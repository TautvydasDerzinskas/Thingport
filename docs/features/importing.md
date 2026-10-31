# Import from MakerWorld, Printables, Thingiverse and more

Thingport keeps a real copy of every model you import: its files, photos, title, description, tags, author and a link
back to where it came from. If the original page disappears, the model is still in your library.

It imports from 17 sites: MakerWorld, Printables, Thingiverse, MyMiniFactory, Snapmaker Space, MakerOnline, Creality
Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, OwlCAD, Toymakr3D, Makerables, CGTrader and GrabCAD.

## Ways to import

- **Paste a link.** Click **Add → Import** and paste a model link from any of them, or any direct link to a model file.
  Paste several links, one per line, and they're imported one after another as a background job. You can also paste a
  link straight into the search bar.
- **Use Thingport Grab.** The [browser extension](../../extension/README.md) adds a Thingport button to model pages on
  all 17 sites (MakerWorld, Printables and Thingiverse straight away, the others once you allow them, with a single
  click in its popup), so you can import without leaving the page, file the model into a collection or a new one, and
  import whole collections. **Pair with Thingport** in its popup connects it: you approve the browser in Thingport, and
  no password is saved in the extension. This is the recommended way to import.
- **Or use the bookmarklet.** Without the extension, drag the [bookmarklet](../guides/bookmarklet.md) to your
  bookmarks bar: clicking it on a model's page opens Thingport with the link already in the import dialog.
- **Import a collection or your likes.** Paste the link of a collection or another list, and pick which models to
  bring in. Besides collections, that's anyone's likes on Thingiverse, Cults3D, Pinshape and GrabCAD, your own likes on
  Creality Cloud, Thangs, eufyMake, Toymakr3D and CGTrader, your CGTrader wishlist and the projects you saved on
  Makerables. MakerWorld collections, and your Snapmaker Space likes and bookmarks from your profile's Interactions
  tab, are imported with Thingport Grab. [Providers](../PROVIDER_SETUP.md#at-a-glance) shows which lists each site
  has.
- **MakerOnline, and OwlCAD's CAD projects, go through Thingport Grab.** MakerOnline hands out its files only to its
  own pages, and an OwlCAD CAD project has no file until OwlCAD's own editor builds one. So a MakerOnline link pasted
  in Thingport, a MakerOnline collection or your likes imported here, a synced MakerOnline collection and an OwlCAD
  CAD project pasted here all wait for Grab: the next time you open the site in a browser with Grab, it imports them
  there.
- **Keep a collection in sync.** A [synced collection](../guides/synced-collections.md) imports models added to it on
  the provider later, on its own.

## What comes with a model

- Its model files, and on MakerWorld, Snapmaker Space, MakerOnline, Creality Cloud and NexPrint, its print profiles:
  the one the link points to, all of the designer's, or the community's too. Each profile becomes its own file on the
  model.
- The OpenSCAD script it was generated from, where its creator shared one, whichever site it came from, so it can be
  [customised and generated again](supporting-files.md#models-you-can-generate-again). MakerWorld also says when a
  creator kept the script back, and the model is marked **Script not shared**. On a MakerWorld page, Thingport Grab
  says before you import whether the script comes along.
- The photo gallery, the formatted description, tags and, where the site gives one, its category, which Thingport maps
  to your own [categories](organize-and-search.md).
- The author, where the site names one, with their avatar and profile, linked to an [author page](authors.md).

If a detail couldn't be fetched at the time, such as the author, **Fetch missing details** on the model page tries
again.

## Link a model you already have

A model you uploaded yourself can be linked to its page on any of the 17 sites, without importing it again. Choose
**Link to a provider** in the model page's **⋮** menu, or on the Models page with the Folders view on, in a card's **⋮**
menu or, with exactly one model selected, the selection toolbar. Paste the model's link, check the preview, and link it.

- **What it brings:** the page's pictures, description, tags and author, and the provider's badge and link. The
  pictures go ahead of your own, so its cover becomes the model's, and your own stay. Tags are added to yours. The
  description and author replace what's there, where the site has them, and that can't be undone. A title you set stays.
- **What it leaves alone:** your files. Nothing is downloaded, so the page's other files and print profiles don't come.
- **Category:** the model stays where it is. If the site's category maps to one of yours, it's suggested on the model
  page, to accept or reject like an AI suggestion, and works without AI. An AI run replaces it with its own answer, or
  clears it if nothing fits.

A linked model counts as imported from then on, so importing the same link later won't bring the page's files. On sites
with print profiles, importing a link to one of its profiles still adds that profile. A page can only be linked to one
model.

## Big imports

Collections and lists of links run as background jobs. A progress bar shows how far along they are, and a notification
says what came in when they finish. A model you already have is never imported twice, so importing the same collection
again only brings in what's new. Failed links can be retried once the cause is fixed, and imports sent to the queue
from Thingport Grab wait in **Administration → Import queue** until they're started.

## Before you start

MakerWorld needs your session cookie and Thingiverse an App Token set by an admin, while Printables, eufyMake, OwlCAD
and Makerables work with no setup. The other sites each need a key or your own sign-in, which Thingport Grab mostly
hands over for you. MakerOnline's files come only through Grab, and CGTrader's downloads also need Grab or
[FlareSolverr](../PROVIDER_SETUP.md#flaresolverr) to get past its bot check. [Providers](../PROVIDER_SETUP.md) compares
what each one needs, with a setup page per site. Admins can also
[turn a provider off](../PROVIDER_SETUP.md#turning-a-provider-off) for the whole instance, and then nothing is imported
from it.

Imported models can be categorized and their descriptions cleaned up on the way in with the optional
[AI features](../guides/ai.md).
