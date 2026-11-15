# Move from Manyfold

**Administration → Migrate** brings a Manyfold library into Thingport, read with an API key made on Manyfold: its
models with their files, pictures, tags and licences, and its collections. Each person's models go to whoever you pick
here. Manyfold isn't changed: its models are read, and their files downloaded.

It needs Manyfold 0.149 or newer, whose API says which folder each file is in.

## What comes, and what stays

| Comes                                                                        | Stays on Manyfold                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Each model with a 3D file Thingport takes (STL, 3MF, STEP, OBJ and the like) | Models with no such file: pictures or PDFs alone |
| Its files, in the folders they were in                                       | Comments                                         |
| Its pictures, its preview first                                              | The sensitive flag                               |
| Its tags, apart from Manyfold's own `!new`                                   | Permissions: who may see what                    |
| Its licence and creator                                                      | Which files are presupported                     |
| Its caption, description and links, as its notes                             | Manyfold's accounts                              |
| A link to a site Thingport imports from, as its source                       |                                                  |
| Collections, if picked                                                       |                                                  |

Manyfold's people don't come as accounts: their models go to people here (see [Owners](#run-the-migration)). A model
linking to a page that one already in that person's library was imported from isn't brought twice.

## Make an API key

On Manyfold, signed in as an admin:

1. Open your user menu, then **API keys**, and click **New API key**.
2. Name it, add **read** to its scopes (it starts with only **public**), and save it.
3. Copy its client ID and client secret from the page that opens. Manyfold keeps the secret hashed, so it doesn't show
   it again.

The key reads what its owner sees there, so an admin's key sees every model. This instance keeps it until the
migration finishes or you remove it from the list. Delete it on Manyfold once you're done.

## Run the migration

Open **Administration → Migrate** and click **Start** on **From Manyfold**. The steps:

1. **Connect.** Manyfold's address as this server reaches it (such as `http://192.168.1.30:3214`), and the key's client
   ID and secret. They're tried at once, so a wrong key or an address this server can't reach is said straight away.
2. **Check.** How many models, collections and creators it has, and how many of its models an earlier migration from
   it brought.
3. **Owners.** Manyfold doesn't list its people to an API key, so add each one by their Manyfold username, and pick
   whose library their models go to here. A username that matches someone's name here, or the start of their email, is
   picked for you. Models of anyone not added go to you.
4. **What comes.** Collections, unless you switch them off. Each becomes a collection of whoever its models go to. One
   inside another is named after both, as in `Minis / Dragons`, and one named like a collection of theirs here is
   merged into it.
5. **Start.**

You can close the dialog while it runs: the migration goes on in the background, and its row on the page says how far
it is. You get a notification when it's done.

This server must be able to reach Manyfold's address. Plain HTTP works, but then the key and the files travel
unencrypted, so use it on a network you trust.

## Running it again

A migration remembers the Manyfold models it brought, so another one from the same Manyfold later brings only the
models added since. One that stops part-way, because Manyfold or the network went away, goes on from where it was with
**Start again** from its ⋮ menu.

## If something goes wrong

| Message                                      | What to do                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Manyfold turned the API key down             | Check the client ID and secret, and that the key has the read scope. A deleted key is turned down too.       |
| This Manyfold is older than 0.149            | Update Manyfold, then migrate. Older ones don't say which folder a file is in.                               |
| That address doesn't answer as Manyfold does | Give Manyfold's own address, with its path if it's served under one.                                         |
| This server can't reach Manyfold             | The address is as this server sees it, not your browser. From Docker, `localhost` is the container itself.   |
| Manyfold asks to wait a few minutes          | It limits how often a key signs in. Wait, then try again.                                                    |
| Manyfold stopped answering                   | **Start again** once it's back: what came over already is skipped.                                           |
| Left out: no 3D file Thingport takes         | Those models have only pictures, documents or other files. Upload them by hand if you want them here anyway. |
