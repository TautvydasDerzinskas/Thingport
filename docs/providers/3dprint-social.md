# <img src="../assets/providers/3dprint-social.svg" alt="" width="36" height="36" align="absmiddle"> 3DPrint.social

A home for 3D models on the Fediverse, at [3dprint.social](https://3dprint.social), run on the open-source
[Manyfold](https://manyfold.app): free models, collections, and creators you can follow from Mastodon and other
Fediverse apps. Anything public on it is anyone's to read and download, so there's nothing to connect.

| At a glance    |                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Sign-in        | None                                                                                                       |
| Thingport Grab | Optional -- it imports from its pages in one click                                                         |
| FlareSolverr   | Not used                                                                                                   |
| Imports        | Models; public collections and anyone's models, [synced](../guides/synced-collections.md) too; no category |

## How it works

Manyfold's API needs a token from an app registered on the server, so Thingport reads 3DPrint.social's pages instead,
as a browser would.

- **Models.** Paste a model link (`https://3dprint.social/models/<id>`) in Thingport, or import it from the model page
  with Grab. A model is one print of its model files, each downloaded on its own, with its description, tags, creator
  and pictures. Manyfold has tags but no categories, so a model comes in without one: pick one, or let AI
  categorization file it. A model that isn't public isn't shown to Thingport, and can't be imported.
- **Collections.** A collection's page, `https://3dprint.social/collections/<id>`, can be imported or synced if it's
  public. The import dialog lists its first 300 models. Models federated into it from other servers are left out:
  they live elsewhere.
- **Creators.** A creator's page, `https://3dprint.social/creators/<handle>`, imports and syncs like a collection of
  their models, so new uploads come in on the next sync.
- **Browse tab.** Give the sync dialog your creator handle (`@handle`, `@handle@3dprint.social` or your creator page)
  and it lists your models and your collections.

## What it doesn't have

- **Likes.** Each user's likes on 3dprint.social are a private list that only they see, so Thingport can't read them.
- **Trending.** It sorts models by name and by when they were added or updated, so it has no popular or trending list
  for the dashboard.
