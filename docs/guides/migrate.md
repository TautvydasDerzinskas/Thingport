# Move to another Thingport instance

**Administration → Migrate** brings another Thingport instance's people and libraries into this one: a new server, or
two instances becoming one. The old instance can be on any release since 1.0.0. Its database is brought up to this
instance's release on the way, so you don't upgrade it first, and nothing on it is changed.

It comes one of two ways:

- **Online**, when the old instance runs a release with Migrate too: its admin makes a one-time token, and this instance
  copies it over the network. See [online](#online-with-a-token).
- **From a dump and its storage folder**, from any release since 1.0.0: a `pg_dump` of its database, and its storage
  folder readable on this server. See [steps 1 to 3](#1-make-the-dump).

## What comes, and what stays

People come with their passwords, so they sign in as before. Someone who already has an account here, with the same
email, is merged into it: the account stays as it is, and their models, collections and the rest are added to it.

| Comes                                                                                        | Stays with the old instance                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| People, with their passwords, profiles, avatars and dashboards                               | Sign-in sessions: everyone signs in here again |
| Models, with their files, categories, creators, pictures and print profiles                  | API tokens and Thingport Grab connections      |
| Collections and sidebar bookmarks                                                            | The audit log                                  |
| Synced collections, with the models they've seen, so only new ones are imported              | The import history and queue                   |
| Provider sign-ins                                                                            | Chats                                          |
| Studio designs, widgets and tools people made, and what tools keep for them                  | Connected instances, and the instance's keys   |
| Instance settings and secrets (AI services, sign-in providers, provider API keys), if picked | Its address and storage structure              |

Models are filed where **this** instance's storage structure puts them. A model imported from the same page as one
already in that person's library isn't brought twice, and one named like another of theirs in the same category gets a
number after its name.

A tool's own models (the ones a repository tool gives everyone) don't come: the tool gives them out here once it's
installed. Install the old instance's tools here before you start, and what they keep for people comes too. The check
lists the ones missing.

## Online, with a token

1. **On the old instance**, open **Administration → Migrate** and click **Create a token** under **Moving away from
   this instance?** Copy the token: it's shown once. It works for 24 hours, until you revoke it, or until you make
   another.
2. **On this instance**, open **Administration → Migrate**, click **Start** on **From another Thingport instance**,
   choose **Online**, and give the old instance's address as this server reaches it (such as `http://192.168.1.20`)
   and the token.

The rest is the same as below, from the Check step on: its database comes as a dump, made there on the fly, and its
files are read one by one over the network. This server must be able to reach the old instance's address. Plain HTTP
works, but then the token and everything it reads travel unencrypted, so use it on a network you trust. Revoke the
token once the migration is done.

## 1. Make the dump

On the old instance's server. With Docker Compose, from the folder its `docker-compose.yml` is in:

```sh
docker compose exec -T db pg_dump -U thingport -Fc thingport > thingport.dump
```

Use your own user and database names if you changed `POSTGRES_USER` or `POSTGRES_DB`. The `-Fc` matters: a plain SQL
dump is turned away, as restoring one would run its commands on this server.

## 2. Bring the storage folder over

Copy the old instance's storage folder (its `/app/storage`) to this server, or mount it where it is. With the default
Docker Compose file, that folder is the `thingport_storage` volume. This copies it out, on the old server:

```sh
docker run --rm -v thingport_storage:/from -v "$PWD/old-storage":/to alpine cp -a /from/. /to/
```

Then let this instance's backend read it, and the dump beside it. It reads them from one folder only, `/app/migrate`
inside its container, so mount the folder that holds them there. Read-only is enough: files are copied, never moved.

```yaml
services:
  backend:
    volumes:
      - thingport_storage:/app/storage
      - /srv/old-thingport:/app/migrate:ro # holds thingport.dump and old-storage/
```

Restart the backend (`docker compose up -d backend`) after adding the line. The backend runs as `PUID`/`PGID`, so that
user has to be able to read the folder. Running the backend outside Docker, set `MIGRATE_DIR` to the folder instead.

## 3. Run the migration

Open **Administration → Migrate** and click **Start** on **From another Thingport instance**. The steps:

1. **Source.** Upload the dump, or pick **It's on this server** and give its path (`/app/migrate/thingport.dump` above).
   An upload goes through the web server in front of Thingport, which takes up to 512 MB by default, so a bigger dump
   goes on the server. Then give the storage folder's path (`/app/migrate/old-storage`).
2. **Check.** The dump is restored into a working copy, the database changes since its release are applied to that
   copy, and its files are looked for in the folder. You see the old instance's release, what it holds and how many of
   its files are missing. A wrong folder can be changed here without restoring the dump again.
3. **People.** Everyone on the old instance, with who they'll be here: merged into an account with the same email, or
   a new account. Untick anyone who shouldn't come. The old instance's owner comes as an admin, as this instance keeps
   its own owner.
4. **What comes.** Models always come with their people. Switch off what shouldn't come with them. Instance settings
   and secrets are off unless you switch them on: they replace this instance's.
5. **Start.** Stop the old instance first. Otherwise synced collections and provider sign-ins run on both, and a site
   that renews a sign-in only once signs one of them out.

You can close the dialog while it runs: the migration goes on in the background, and its row on the page says how far
it is. You get a notification when it's done.

## After it's done

- **Everyone signs in here** with the password they had. People who used single sign-on need the same sign-in
  provider set up here (**Secrets** brings it).
- **Thingport Grab and apps using an API token** are connected again, to this instance.
- **Connected instances** are paired again from **Administration → Social**.

## If something goes wrong

A migration that stops part-way keeps its working copy. **Start again** from its ⋮ menu goes on from where it was:
what came over already is skipped. Running the same dump again later brings nothing twice either.

| Message                                            | What to do                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| This is a plain SQL dump                           | Make the dump again with `-Fc`, as above.                                                                                                         |
| The old instance is newer than this one            | Update this instance first. A dump can only come from the same release or an older one.                                                           |
| A database change failed on the old instance       | One of its upgrades never finished. Fix that there (its backend's log says which), then make a new dump.                                          |
| The database user can't create databases and roles | The working copy is a database of its own, restored as a role that can't reach anything else. Give the database user `CREATEDB` and `CREATEROLE`. |
| pg_restore isn't installed on this server          | The Thingport image has it. Running the backend outside Docker, install the PostgreSQL client tools.                                              |
| None of its files are in that folder               | The path is wrong, or this server can't read it. Change it on the Check step.                                                                     |
| Give a path inside /app/migrate                    | Mount the old instance's files there, as above, and give the paths below it.                                                                      |
| This server can't reach the address                | The address is as this server sees it, not your browser. From Docker, `localhost` is the container itself.                                        |
| The old instance turned the token down             | It expired (after 24 hours), was revoked, or another was made since. Make a new one there.                                                        |
| The old instance can't be copied online            | It's on a release without Migrate. Update it, or use a dump and its storage folder.                                                               |
| The old instance stopped answering                 | **Start again** once it's back: what came over already is skipped.                                                                                |
| Too big to upload through the web server           | Put the dump on the server and give its path.                                                                                                     |

The working copy is restored as a database role made for it, which can reach that copy and nothing else: an uploaded
dump is trusted no more than any other upload.
