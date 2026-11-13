# <img src="../assets/providers/printables.svg" alt="" width="36" height="36" align="absmiddle"> Printables

Prusa Research's free model repository, formerly PrusaPrinters. Its public API needs no account or key, so Printables
works out of the box.

| At a glance    |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Sign-in        | None                                                                                                      |
| Thingport Grab | Optional -- needed only for your private collections and your likes                                       |
| FlareSolverr   | **Recommended** -- without it, imports fail whenever Cloudflare challenges the server                     |
| Imports        | Models, public and private collections, your likes, [synced collections](../guides/synced-collections.md) |

## What comes in

- Every file of the model, its photos, description, tags, category and author.
- Public collections, read with nothing.
- Your private collections and your likes. Printables shows these to you alone, so Thingport can't read them on its
  own: with [Thingport Grab](../../extension/README.md) in a browser where you're signed in to Printables, Grab reads
  them while you're on Printables, at most once an hour, and sends them on. Synced ones get new models after your next
  visit rather than on a schedule.
- Its 3MFs come from PrusaSlicer as often as from Bambu Studio; other slicers open them as
  [adapted 3MFs](../features/adapted-3mf.md), and Thingport Grab downloads them adapted on Printables itself.

## Setup

Nothing to connect: Printables shows as connected in **Configuration → Providers** for everyone.

Printables sits behind Cloudflare, which sometimes challenges servers. Set up
[FlareSolverr](../PROVIDER_SETUP.md#flaresolverr) under **Administration → Connections** so those imports get
through.
