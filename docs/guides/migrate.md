# Move to another Thingport instance

**Administration → Migrate** brings another Thingport instance's people and libraries into this one: a new server, or
two instances becoming one. The old instance can be on any release since 1.0.0. Its database is brought up to this
instance's release on the way, so you don't upgrade it first, and nothing on it is changed.

It comes one of two ways:

- **Online**, when the old instance runs a release with Migrate too: its admin makes a 24-hour token, and this instance
  copies it over the network. See [online](#online-with-a-token).
- **From a dump and its storage folder**, from any release since 1.0.0: a `pg_dump` of its database, and its storage
  folder readable on this server. See [steps 1 to 3](#1-stop-the-old-instances-backend), which **How do I make these?**
  on the Source step also walks through, with the commands filled in.

Coming from Manyfold instead? See [Move from Manyfold](migrate-manyfold.md).

## What comes, and what stays

People come with their passwords, so they sign in as before. Someone who already has an account here, with the same
email, is merged into it: the account stays as it is, and their models, collections and the rest are added to it.

| Comes                                                                                                         | Stays with the old instance                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| People, with their passwords, profiles, avatars, dashboards, achievements and Send to destinations (keys too) | Sign-in sessions: everyone signs in here again |
| Models, with their files, categories, creators, pictures and print profiles                                   | API tokens and Thingport Grab connections      |
| Collections and sidebar bookmarks                                                                             | The audit log                                  |
| Synced collections, with the models they've seen, so only new ones are imported                               | The import history and queue                   |
| Provider sign-ins                                                                                             | Chats                                          |
| Studio designs, widgets and tools people made, and what tools keep for them                                   | Connected instances, and the instance's keys   |
| Instance settings and secrets (AI services, sign-in providers, provider API keys), if picked                  | Its address and storage structure              |

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

The rest is the same as in [step 4](#4-run-the-migration), from the Check step on, except that **the old instance's
backend keeps running** until the migration is done: it's what sends the dump and the files. Its database comes as a
dump, made there on the fly when the Check step starts, and its files are read one by one over the network, at Check
and again at Start.

Since the dump is made first, nothing may change on the old instance from then until the migration is done: a model
imported after the dump wouldn't come, and one deleted would be missing its files. Tell its people to stop using it,
and start the migration when no import or synced collection is running there, but don't stop its backend. Synced
collections check on a schedule too: before you create the token, set `COLLECTION_SYNC_ENABLED=false` on the old
instance and restart its backend, and ask its people not to press **Sync now**, which still works.

This server must be able to reach the old instance's address. Plain HTTP works, but then the token and everything it
reads travel unencrypted, so use it on a network you trust. Revoke the token once the migration is done.

## 1. Stop the old instance's backend

The dump and the storage copy are what comes, so nothing may change on the old instance once they're made: a model
imported after the dump wouldn't come. Stop its backend, but leave its database running for the dump. With Docker
Compose, from the folder its `docker-compose.yml` is in:

```sh
docker compose stop backend
```

Keep it stopped until this instance takes over. Running both would also run synced collections and provider sign-ins
twice, and a site that renews a sign-in only once signs one of them out.

## 2. Make the dump

On the old instance's server, from the same folder:

```sh
touch thingport.dump && chmod 600 thingport.dump && docker compose exec -T db pg_dump -U thingport -Fc thingport > thingport.dump
```

The dump holds the old instance's password hashes and provider sign-ins, so the file is made readable by you only before
anything goes in, even over an earlier one, and `rsync -a` below keeps that. Use your own user and database names if
you changed `POSTGRES_USER` or `POSTGRES_DB`. The `-Fc` matters: a plain SQL dump is turned away, as it's a script whose
commands could reach this server itself. A `-Fc` dump can hold SQL too, which runs as it's restored, but as a role made
for its working copy, with no rights on this instance's data (see below). Restore dumps of instances you trust.

## 3. Bring the storage folder over

Copy the old instance's storage out of its backend's container, from the same folder (the backend may be stopped):

```sh
mkdir -m 700 old-storage && docker compose cp backend:/app/storage/. old-storage
```

This copies it into `old-storage`, beside the dump, whether its Compose file keeps the storage in a folder on the server
or in a Docker volume. It needs as much free space as the storage takes. `/app/storage` is the old backend's
`FILE_STORAGE`, which the Compose files set: if you changed it, use yours, as a full path. The backend reads a relative
one from `/app`, but `docker compose cp` from `/`, so `./files` is `/app/files`. `mkdir` stops it if an earlier try
left an `old-storage` there: remove that first, as copying into it would keep files the old instance has removed
since. The folder is made readable by you only (`-m 700`), as the files in it are readable by everyone, and it stays
so here and on this server.

On the same server, a storage folder (not a volume) can be read where it is instead: skip the copy and the `ssh` and
`rsync` lines below, put the dump beside the folder and mount the folder that holds both. In the hand-over below, give
only the dump, not the storage folder: that stays the old backend's, and this one reads it as it is, as Thingport
writes its files readable by every user. The Source step takes the storage folder by its own name, such as
`/app/migrate/storage`, rather than `/app/migrate/old-storage`.

Then bring both to this server, over SSH or on a disk. On the same server, move them instead. Use this server's address
and a new folder of your own. The first line makes the folder, as rsync makes only the last folder of a path, with mode
`755`, so the backend's user can enter it. Where only root can, as under `/srv`, it does that with `sudo`, asking for
your password on this server, and gives the folder to the SSH user so rsync can write there. A folder that's already
there is left as it is, as it may hold other things: the SSH user must be able to write to it, and the backend's user
to enter it. One the SSH user can't reach stops the `sudo` part with "File exists" rather than being changed. Folders
above it that `sudo` makes are `755` too, but the SSH user must be able to get through those already there: `sudo`
makes the folder, not a way to it.

A `thingport.dump` or `old-storage` already in the folder is replaced by this copy: `--delete` makes `old-storage` there
match it, deleting the files that aren't in it. That clears what an earlier try left, and nothing else in the folder,
but use a folder with no `old-storage` of its own.

```sh
ssh -t 192.168.1.20 'mkdir -p -m 755 /srv/old-thingport 2>/dev/null || { umask 022; sudo mkdir -p /srv && sudo mkdir -m 755 /srv/old-thingport && sudo chown "$(id -u)" /srv/old-thingport; }'
rsync -a --delete thingport.dump old-storage 192.168.1.20:/srv/old-thingport/
```

A folder with spaces or symbols in its path, such as `$`, has to be quoted for two shells, the old server's and this
one's, which reads the `ssh` line once more: let **How do I make these?** write both lines for it. It also adds `-s`
(`rsync -as`), as an rsync older than 3.2.4 splits the path on this server otherwise. `-s` takes rsync 3.0.0 or later
on both servers, and macOS's own rsync has none: where one is older, use a folder without spaces or symbols, which any
rsync takes as it is. An IPv6 address goes in brackets in the `rsync` line, quoted, as zsh reads brackets as a pattern
(`'[2001:db8::20]:/srv/old-thingport/'`), but not in the `ssh` one.

On this server, hand the two to the user the backend runs as, `PUID`:`PGID` (1000:1000 unless you changed them), so it
can read them and no one else can read the dump. Only the two, not the folder, which may hold other things:

```sh
sudo chown -R 1000:1000 /srv/old-thingport/thingport.dump /srv/old-thingport/old-storage
```

To bring them again later, as after a failed try, give them back first when the SSH user isn't the backend's, as
`rsync` can't otherwise get into `old-storage` to update it. As the SSH user, on this server, then hand them over again
after the copy:

```sh
sudo chown -R "$USER" /srv/old-thingport/thingport.dump /srv/old-thingport/old-storage
```

Then let this instance's backend read the folder they're in. It reads them from one folder only, `/app/migrate`
inside its container, so mount the folder that holds them there. That's its `MIGRATE_DIR`: if you've set one, use it
wherever this guide says `/app/migrate`. Read-only is enough: files are copied, never moved. Add the one line to the
backend's volumes and leave the ones it has, its `/app/storage` among them, as they are. The Compose files in the
repository have it commented out.

```yaml
services:
  backend:
    volumes:
      # ...its own volumes, as they are...
      - /srv/old-thingport:/app/migrate:ro # holds thingport.dump and old-storage/
```

That line splits on `:`, so a folder with a colon in its path needs the long form instead:

```yaml
services:
  backend:
    volumes:
      - type: bind
        source: /srv/archive:2026
        target: /app/migrate
        read_only: true
        bind:
          create_host_path: false # else Compose turns it back into the line above
```

Restart the backend (`docker compose up -d backend`) after adding the line. Running the backend outside Docker, set
`MIGRATE_DIR` to the folder instead, and hand the two to the user it runs as.

## 4. Run the migration

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
5. **Start.** With the old instance's backend still stopped, as in step 1 (online, still running, but unused).

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

| Message                                            | What to do                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This is a plain SQL dump                           | Make the dump again with `-Fc`, as above.                                                                                                                                                                                                     |
| The old instance is newer than this one            | Update this instance first. A dump can only come from the same release or an older one.                                                                                                                                                       |
| A database change failed on the old instance       | One of its upgrades never finished. Fix that there (its backend's log says which), then make a new dump.                                                                                                                                      |
| The database user can't create databases and roles | The working copy is a database of its own, restored as a role made for it, with no rights on this instance's data. Give the database user `CREATEDB` and `CREATEROLE`.                                                                        |
| pg_restore isn't installed on this server          | The Thingport image has it. Running the backend outside Docker, install the PostgreSQL client tools.                                                                                                                                          |
| None of its files are in that folder               | The path is wrong, or this server can't read it. Change it on the Check step.                                                                                                                                                                 |
| This server can't read …                           | Hand the dump and `old-storage` to the backend's user, as in [step 3](#3-bring-the-storage-folder-over), and check it can enter their folder.                                                                                                 |
| Give a path inside /app/migrate                    | Mount the old instance's files there, as above, and give the paths below it.                                                                                                                                                                  |
| This server can't reach the address                | The address is as this server sees it, not your browser. From Docker, `localhost` is the container itself.                                                                                                                                    |
| The old instance turned the token down             | It expired (after 24 hours), was revoked, or another was made since. A run it stopped can't go on: remove it from the list, which files what it brought, make a new token there and start a new migration. What came over already is skipped. |
| The old instance can't be copied online            | It's on a release without Migrate. Update it, or use a dump and its storage folder.                                                                                                                                                           |
| The old instance stopped answering                 | **Start again** once it's back: what came over already is skipped.                                                                                                                                                                            |
| Too big to upload through the web server           | Put the dump on the server and give its path.                                                                                                                                                                                                 |

The working copy is restored as a database role made for it: an uploaded dump is trusted no more than any other upload.
The role owns nothing but that copy and is given no rights on this instance's data, and the SQL in a dump runs inside
the copy, as a Postgres connection can't query another database. Like any role, it may connect to the server's other
databases where Postgres's default `CONNECT` for everyone allows, but it has no rights on their tables, and only the
backend knows its password, which it makes from `AUTH_SECRET`.

pg_dump and pg_restore reach the database as safely as the backend does: its `sslmode`, and `sslaccept=strict` checks
the server's certificate against `sslcert`. They don't read Prisma's `sslidentity`, though: for a database that asks
for a client certificate, give them the certificate and an unencrypted key as PEM files with `PGSSLCERT` and
`PGSSLKEY` in the backend's environment.
