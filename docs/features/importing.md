# Import from MakerWorld, Printables and Thingiverse

Thingport keeps a real copy of every model you import: its files, photos, title, description, tags, author and a link
back to where it came from. If the original page disappears, the model is still in your library.

## Ways to import

- **Paste a link.** Click **Add → Import** and paste a model link from MakerWorld, Printables or Thingiverse, or any
  direct link to a model file. Paste several links, one per line, and they're imported one after another as a
  background job. You can also paste a link straight into the search bar.
- **Use Thingport Grab.** The [browser extension](../../extension/README.md) adds a Thingport button to model pages on
  all three sites, so you can import without leaving the page, file the model into a collection, and import whole
  collections.
- **Import a collection or your likes.** Paste a collection link, or your Thingiverse likes, and pick which models to
  bring in. MakerWorld collections are imported with Thingport Grab.
- **Keep a collection in sync.** A [synced collection](../guides/synced-collections.md) imports models added to it on
  the provider later, on its own.

## What comes with a model

- Every file, and on MakerWorld, its print profiles: the one the link points to, all of the designer's, or the
  community's too. Each profile becomes its own file on the model.
- The photo gallery, the formatted description, tags and the source site's category, which Thingport maps to your own
  [categories](organize-and-search.md).
- The author, with their avatar and profile, linked to an [author page](authors.md).

If a detail couldn't be fetched at the time, such as the author, **Fetch missing details** on the model page tries
again.

## Big imports

Collections and lists of links run as background jobs. A progress bar shows how far along they are, and a notification
says what came in when they finish. A model you already have is never imported twice, so importing the same collection
again only brings in what's new. Failed links can be retried once the cause is fixed, and imports sent to the queue
from Thingport Grab wait in **Administration → Import queue** until they're started.

## Before you start

Printables works with no setup. MakerWorld needs your session cookie, and Thingiverse an Access Token set by an admin.
See [provider setup](../PROVIDER_SETUP.md). Admins can also [turn a provider off](../PROVIDER_SETUP.md#turning-a-provider-off)
for the whole instance, and then nothing is imported from it.

Imported models can be categorized and their descriptions cleaned up on the way in with the optional
[AI features](../guides/ai.md).
