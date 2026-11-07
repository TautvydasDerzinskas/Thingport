# Connected instances: development

Thingport instances pair with each other over ActivityPub, so their people see each other as if they were on one
instance. This page is for working on it; the admin's side is in
[guides/connected-instances.md](guides/connected-instances.md).

## The rules

- **Off means absent.** With connected instances off (the default), nothing under `/api/ap` answers and Fedify isn't
  even loaded: it's imported only once an admin turns it on. The keys are made the first time it's turned on and kept
  when it's turned off, so partners know it again once it's back. Keep it that way: no top-level import of
  `@fedify/*` outside `import type`.
- **Admins decide who this instance talks to.** It fetches from, and accepts signed requests from, only approved
  partners and the instance an admin is looking at right then (`allowlist.ts`). Nothing a stranger or a user sends may
  make the server fetch anything: a stranger's request to connect is kept as it came and checked only when an admin
  opens it. An instance reached through a link (`links.ts`) is never fetched at its address: `federationFetch` sends
  every request for it down its link, so keep every outgoing request in `federationFetch`.
- **Everything social federates.** A partner's people get every social feature this instance's own people get. Every
  route in `routes/social.ts` and `routes/chats.ts` is listed in `src/federation/socialSurfaces.ts` with how it crosses
  (or why it stays local), and `tests/federationSurfaces.test.ts` fails for one that isn't. A new social feature
  decides its federation when it's written, not later.
- **Plain HTTP stays supported** (see `.claude/CLAUDE.md`): requests are signed, the UI shows **Plain HTTP**, and admins
  compare key fingerprints out of band. What's compared is what counts: Fedify's loaders refuse a partner's document
  that publishes any other key (`pinning.ts`), so a key swapped in on the way can't sign for it.

## How it fits together

Everything lives in `backend/src/federation/`, mounted at `/api/ap` ahead of `express.json()` (signatures cover the
body exactly as it came), plus the admin API in `routes/federation.ts`.

| File                                       | What it does                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.ts`                              | On or off, and the last reachability check. Live only while social features are on too.                                                                                                                                                             |
| `keys.ts`                                  | The instance's RSA (HTTP signatures) and Ed25519 (object proofs) keys, made on first enable, and their fingerprint: six groups of four hex digits of the SHA-256 of both public keys' SPKI.                                                         |
| `runtime.ts`                               | Fedify, built lazily per Public URL origin: the instance actor (`/api/ap/actors/instance`, readable by anyone, since checking a signature needs the signer's key), the inbox (`/api/ap/inbox`), and the loaders.                                    |
| `addresses.ts`, `fetch.ts`, `allowlist.ts` | Outgoing requests: only to allowed origins, never to this machine, link-local (cloud metadata) or reserved ranges, resolved once per connection against DNS rebinding, no redirects, 1 MB at most.                                                  |
| `pinning.ts`                               | The keys compared when connecting are the only ones a partner has: a document from it publishing another is refused by the loaders Fedify verifies with.                                                                                            |
| `edge.ts`                                  | In front of the inbox: a partner's request goes on to Fedify; a blocked instance's is dropped; a paused one gets 503 and retries; from anyone else only a `Follow` of the instance actor, by the origin that signed it, is kept as a `PeerRequest`. |
| `peers.ts`                                 | Every change to who we're connected with: looking an instance up, asking, approving, declining, pausing, disconnecting, blocking, and what partners send.                                                                                           |
| `delivery.ts`                              | Our own outbox: signed POSTs with retries over about three days. Fedify's own delivery refuses private addresses, which home instances live on.                                                                                                     |
| `kvStore.ts`                               | Fedify's key-value store in the `FederationKv` table (its Postgres package would make tables outside Prisma's migrations).                                                                                                                          |
| `reachability.ts`                          | The check before turning on: the Public URL fetches a nonce back with this instance's secret, and its address is classified.                                                                                                                        |
| `inbox.ts`                                 | Fedify's inbox handlers, passing each activity to `peers.ts`.                                                                                                                                                                                       |
| `apRoutes.ts`                              | The Express side: `/api/ap/instance` (what a lookup reads), the actor and the inbox, handed to Fedify at the URL the Public URL gives.                                                                                                              |
| `publish.ts`                               | What this instance's people share, for partners' signed GETs only: the directory, models, collections, pictures, files.                                                                                                                             |
| `signedFetch.ts`                           | A GET of a partner's document or file, signed as this instance, to that partner's own origin only.                                                                                                                                                  |
| `remoteIndex.ts`                           | The copy kept of what partners share, read on connecting, every 15 minutes, and when Explore finds it stale.                                                                                                                                        |
| `remoteExplore.ts`                         | Explore's rows and pages of partners' things, from that copy.                                                                                                                                                                                       |
| `media.ts`                                 | Partners' pictures, fetched signed through this instance and kept, at addresses signed with its secret.                                                                                                                                             |
| `remoteFiles.ts`                           | Partners' models' files through this instance: streamed to a viewer, or fetched whole to zip or copy. Never kept.                                                                                                                                   |
| `remoteCopy.ts`                            | A partner's model copied into a viewer's library in the background, file by file, marked with where it came from.                                                                                                                                   |
| `chats.ts`                                 | Chats with partners' people: sending messages, rooms and deletions, and checking what partners send.                                                                                                                                                |
| `links.ts`                                 | Links: how an instance that can't be reached keeps a partner that can. The serving side's `/api/ap/link` and its replies, and the side behind NAT keeping its links open and running what comes down them.                                          |
| `socialSurfaces.ts`                        | How each social route crosses to partners.                                                                                                                                                                                                          |

### Pairing

Two instance actors, one `Follow` and one `Accept`:

1. Admin A looks B up (`GET /api/ap/instance` and B's actor), compares B's fingerprint with B's admin, and connects:
   a `Peer` (`OUTGOING`) and a `Follow` from A's instance actor, with the note as `content`.
2. B's edge filter keeps it as a `PeerRequest` without fetching anything, and notifies B's admins. Another one under
   A's address is kept beside it, a few at most: anyone can send one claiming to be A. Nothing in one can be checked
   before an admin opens it (that would fetch from wherever a stranger says), so no more than 10 new instances'
   requests are taken an hour, and 50 waiting in all.
3. B's admin opens it: only now does B look A up, and check A's requests newest first against the key in that lookup
   (any age: the handshake after it proves both sides are live) and against `GET /api/ap/follows/<id>` on A, which
   answers only while A's request stands. The first that passes is the request; forged and withdrawn ones are dropped.
   Approving creates B's `Peer` (`ACTIVE`) and queues the `Accept` in one transaction.
4. A's `Peer` becomes `ACTIVE` on an `Accept` of its own `Follow`, if it's still `OUTGOING`. Disconnecting sends
   `Undo(Follow)` from whoever asked and `Reject(Follow)` from whoever approved. Blocking a partner disconnects it the
   same way first, then drops what it sends; blocking a request sends nothing at all. Pairing
   activities count only from the instance actor connected with; an `Undo` of their `Follow` of us ends it whatever
   its id, since when both admins asked at once each side keeps its own.

### Users asking

A person asks to reach `bob@prints.example` from Explore (`POST /api/me/connection-requests`, `userRequests.ts`). That's
a `PeerRequest` of kind `LOCAL`: a note for this instance's admins, with the origin guessed from the handle. Nothing
is fetched from what a person typed -- only an admin's **Connect** reaches out, through the usual lookup and key
comparison, with the request's id (`requestId`). Its `Follow` then carries a pair of `Mention` tags for every request
here waiting on that instance: the person asking (their actor URL and `@handle`, as they're called now) and the
person asked for (`@bob@prints.example`, at the address the admin checked). The other side reads every pair
(`asksIn`), shows them to its admins and, on approval, tells each person asked for. Settling those requests and queuing
the `Follow` are one transaction, and only requests still waiting are settled, so one withdrawn or declined meanwhile
stays so. `listMyRequests` derives each request's status from the `Peer` it led to.

Handles are `User.username` (`services/usernames.ts`) at the Public URL's host. Every account gets one: on sign-up, on
first `GET /api/me` for older accounts, and backfilled by the migration that added the column. They're unique on the
instance, never reused as a path segment (actor URLs use the user's id), so renaming one breaks nothing.

### What partners share

Explore across instances is read from a copy each instance keeps of what its partners share, not fetched as someone
looks: Explore stays fast, and shows a partner's things while it's away.

- **Serving** (`publish.ts`, under `/api/ap`, answering only an `ACTIVE` partner's signed GET, checked against the key
  compared): `/directory?page=N`, the people who share, as `Person`s with their counts, 50 a page and each cut to 18 KB
  (links, then bio) so a page fits the 1 MB a fetch takes (each also at its own id, `/actors/<id>`);
  `/actors/<id>/models`, their shared models, each page going on `?after=` its last one and ending before 900 KB;
  `/actors/<id>/collections?page=N`, their public collections, 12 a page, each with its first 200 models by id and the
  rest at `/collections/<id>/models?offset=N`, 1,000 a page. Text, files and pictures go only as far as a partner keeps
  them (20,000 characters of a model's description, 100 files), so every page fits; `/media/<kind>/<id>`, avatars,
  uploaded covers and models' pictures; `/files/plate|file/<id>/<name>`, a shared model's files, the `url` of each
  `Document` in its `attachment`. People are `Person`s; a model is a `thingport:Model`, a collection a
  `thingport:Collection`, and Thingport's other terms are under `thingport:` too. What's shared is decided by the same
  rules as Explore here (`sharers`, `sharedModelsWhere` in `services/socialService.ts`).
- **Keeping the copy** (`remoteIndex.ts`): `RemotePerson`, `RemoteModel`, `RemoteCollection`, read on connecting, by
  **Check connection**, every 15 minutes (the delivery worker's tick), and when Explore is opened and it's two minutes
  old. Everything a partner says is checked: ids and pictures on its own origin, text cut to size, and a listing without
  its items refused rather than read as empty. Rows keep their ids across reads (upserted by `apId`), so links to them
  stay. Every row a read writes is stamped with its time (`syncedAt`), and what's left with an older one is what's no
  longer listed, so it goes, except a person's models or collections when not all their pages were read (past the caps,
  a later page gone, or a next page elsewhere), and a collection's models when one of their pages wasn't. At most 2,000
  models and 200 collections a person are read, and 2,000 models of each collection. A read is written in one
  transaction that ends by checking the partner is still `ACTIVE`, and forgetting a partner waits for one being written:
  a failed read leaves the last one whole, and a block or disconnect meanwhile leaves nothing behind. Disconnecting or
  blocking removes it all, pictures included.
- **Pictures** (`media.ts`): the web app gets `/explore/elsewhere/media/<url>.<signature>`, signed with this instance's
  secret, so a user can't make the server fetch anything else; it's fetched signed from that partner, only while it's
  `ACTIVE`, kept under `federation-media/<peer>/`, and served with the session in the address like other files. After
  each read, failed or not, the ones nothing names any more (an older version, something no longer shared) are
  removed, and past 1 GB of one partner's the oldest fetched go. Forgetting a partner waits for pictures being fetched
  and keeps none of them.
- **Showing it** (`remoteExplore.ts`, `routes/social.ts`): `GET /explore?scope=all|here|<peer id>` adds `elsewhere` and
  `instances`, plus `shared_at` for this instance's own, so the web app can put both in one order;
  `/explore/elsewhere/person|model|collection/:id` for the pages, a person's with their first 24 collections and
  `collections_total`, the rest from `/explore/elsewhere/person/:id/collections` (as `/explore/user/:id/collections`
  here). Paused partners are left out.
- **Files** (`remoteFiles.ts`): a model's page lists each file with an address here,
  `/explore/elsewhere/model/<id>/files/<key>/<name>` (the key from the file's own address at the partner, so a read
  that reorders them never serves another file; the name last, for slicers), or `null` where the partner gave none on
  its own origin. Each is fetched signed from the partner as it's asked for, only while it's `ACTIVE`, from the address
  its model document gave and nowhere else, streamed on and never kept, and the fetch stops when the viewer goes.
  `files.zip` has them all: two ZIPs at once on the instance and one a person, no bigger than an import together, and
  given up when the viewer goes.
- **Copies** (`remoteCopy.ts`): `POST /explore/elsewhere/model/<id>/copy` starts one in the background (asked twice at
  once, the second hears the first) and `GET` says how it's going, file by file. A model with a file that can't be had
  isn't copied without it (`files_missing`). The files are fetched into a temporary folder, each no bigger than an
  import, and only once all of them are there is a model made (`createUploadedModel`), with `Print.remoteSource`
  saying where it came from in the same write, its description's images made links (so the copy's page fetches
  nothing from elsewhere), then its pictures. `remoteSource` is what makes the original show **Open my copy** rather
  than copy it again, and the copy's `copied_from_remote` (on `GET /print/:id`), which links back to the original
  while the partner still shares it and connected instances are on. Copying someone's copy here carries it over. A
  job's progress is in memory: a restart loses one under way, and leaves nothing half made.

### Chats

Chats reach partners' people through `chats.ts`; storing what arrives and notifying stays in `services/chatService.ts`.

- **This instance speaks for its people.** Every activity is the instance actor's, signed with its key; the person a
  `Note` is from is embedded as its `attributedTo` (`Person`, with their name, username and avatar), so nobody here
  needs keys of their own. A partner believes a Note only of people on that partner's own origin, with one exception:
  in a room it hosts.
- **Direct messages**: `Create(Note)` to the person's actor URL at their instance. Each side keeps its own chat of the
  two (`directKey` `r:<user>:<their actor URL>`, the person in `ChatRemoteMember`). Someone known only from a chat (they
  share nothing on Explore) is a `RemotePerson` with `listed: false`: kept while a chat names them, never on Explore.
- **Rooms** live on the instance that hosts them, which keeps the member list and is the only one that manages them.
  An admin adds partners' people to a private room; each partner with members gets `Update` of the room's `Group`, its
  members as `Person` attachments, on every change, and `Delete` when it goes. That partner keeps a copy
  (`Chat.remoteApId`, `hostPeerId`, `hostMembers`) with its own people as members, and drops it when none are left.
  Messages there go to the host as `Create(Note)` with the room as `context`; the host keeps them and passes them on to
  its other partners as `Announce`, which they accept from the room's host whoever wrote. Leaving a room hosted
  elsewhere sends `Remove` of the person from the Group.
- **Deleting** sends `Delete` of the Note to wherever it's kept; a partner may delete its own people's messages, and a
  room's host any in that room, which it passes on.
- **Models** in a message go as `Link`s to their ids; only ones the sender shares on Explore may be sent, so the other
  side can open them from its index (a model it hasn't read yet starts a read of that partner).
- **Nothing is lost on the way.** What goes to partners is queued in the transaction of the chat change it follows
  (`withPartners` in chatService), and to a paused partner too: delivery keeps it until it's resumed, then sends it at
  once. What's queued for one chat (its room, or the person it's with: `orderKey`) goes in the order it was queued, each
  waiting for any before it still to be tried again, so a message never overtakes the update that took someone out of
  the room. A change touching partners is refused while connected instances are off; a message to the other instance's
  person, or in a room it hosts, while it's paused (`partner_unavailable`). A room's update carries the host's `updated`
  time, and a copy applies only a newer one, so a late retry can't put back someone taken out. What can't be handled yet
  is answered with an error (`RetryLater`), which Fedify turns into a 500 and the sender retries: anything while chats
  are off here, a room's message before the room. A `Delete` for a message not here yet leaves a tombstone (in
  `FederationKv`, a week), and the message is dropped when it comes. A room's update fits a partner's inbox: no
  pictures, names cut as far as needed, at most 500 members.
- Disconnecting or blocking a partner keeps chats with its people (each message keeps the sender as it came,
  `remoteSenderCard`) and drops the copies of its rooms; once it's connected again and its people are read, they're
  back in those direct chats.

### Links: when one side can't be reached

An instance behind NAT can reach out but can't be reached. It keeps a **link** open to a partner on the internet
instead (`links.ts`), and the partner reaches it through that:

- **Asking.** The home instance asks `GET /api/ap/link` (`Authorization: Link <secret>`), and its partner answers as
  soon as it has something for it, or after 10 seconds with nothing. It asks again at once. The link is open while it
  asked within the last 25 seconds.
- **Everything the partner needs from it** goes down that answer: `federationFetch` sees the origin is linked
  (`lineFor` in `allowlist.ts`) and hands the request over instead of connecting. The home instance runs each one on its
  own `/api/ap` routes over loopback (only `/api/ap`, only GET and POST, only the headers a signed request needs) and
  sends the response up as `POST /api/ap/link/replies/<id>`, its body streamed: a file comes up as it's read. What the
  home instance sends its partner goes directly, as always.
- **The secret** is made by the home instance when its admin connects with **Keep a link open**, sent as
  `thingport:link` in the signed `Follow`, and kept as its SHA-256 by the partner (`PeerRequest.linkToken`, then
  `Peer.linkToken`), so the link opens while the request waits: the partner's admin reviews and approves it through
  that link (`throughRequestLink`). Only those checks go through the request's link; approving hands its open link to
  the new partner (`linkApproved`), so the answer goes at once.
- **Its address is never fetched.** A linked origin, a waiting request's, or one whose link ended in the last 30 days
  (`thingport:link-only:` in `FederationKv`) never goes to the network: that address, usually a LAN one, may lead to
  another machine from the partner's side. So a partner never sends a linked instance a goodbye: declining,
  disconnecting or blocking leaves a note (`thingport:link-ended:`) its link reads as `410` with `declined` or
  `disconnected`, and the home instance lets go.
- **Its signatures** are checked against its actor document as kept when its admin compared the key
  (`Peer.actorDocument`), so checking one asks it nothing.
- **Coming down a link proves nothing** about reaching the home instance: such requests carry a mark only this process
  knows (`cameThroughLink`), and they don't set `lastInboundAt`.
- **Two at one address**: a request with a link from an address a partner already has, and not that partner's own
  secret, is turned away with `409 address_taken` at the edge; the home instance shows **Address taken**.
- When its link opens again after a while closed, what waited for it is sent and what it shares is read again.

### Making a social feature federate

1. Say in `socialSurfaces.ts` how it crosses: which ActivityPub objects and activities, and what a partner's person
   may read (exactly what a signed-in person here may read of others, never more).
2. Publish it as ActivityPub from `runtime.ts`: an object dispatcher, or a collection partners page through, with
   `authorize` letting only signed requests from `ACTIVE` partners in.
3. Send changes to partners with `enqueueActivity` (`Create`, `Update`, `Delete`), signed as the person or the
   instance that made them; Fedify rejects an activity whose signer isn't its actor.
4. Handle what arrives in `inbox.ts`, through `peers.ts`, trusting only what the partner may speak for: objects on its
   own origin.
5. Add it to `tests/federationPairing.e2e.test.ts`.

## Testing

- `tests/federationAddresses.test.ts`, `tests/federationReachability.test.ts`: the address rules and the check, with
  the network faked, including the public cases.
- `tests/federation.test.ts`: the routes and the inbox filter on a test database.
- `tests/federationExplore.test.ts`: what partners are shown, Explore with what a partner shares, which of its files
  are handed out, and where a copy came from.
- `tests/federationSurfaces.test.ts`: the rule above.
- `tests/federationPairing.e2e.test.ts`: two real instances, each its own server and database, pairing over HTTP. It
  needs two empty, migrated databases and is skipped without them. From `backend/`:

  ```sh
  createdb fed_a && createdb fed_b
  for db in fed_a fed_b; do DATABASE_URL=postgresql://localhost/$db npx prisma migrate deploy; done
  FEDERATION_E2E_DB_A=postgresql://localhost/fed_a FEDERATION_E2E_DB_B=postgresql://localhost/fed_b \
    npx vitest run tests/federationPairing.e2e.test.ts
  ```

  The two instances run on `127.0.0.1`, which `FEDERATION_ALLOW_LOOPBACK=1` lets them talk on. That variable is for
  tests only: in use, this machine is never an instance to talk to.

- `tests/federationLinks.test.ts`: a request down an open link and its answer up, a waiting request's link and its
  end, and the address check.
- `tests/federationLink.e2e.test.ts`: two real instances where only one can reach the other, through pairing,
  Explore, a file, chats and disconnecting. It needs two more databases (`FEDERATION_E2E_DB_C`, `FEDERATION_E2E_DB_D`),
  and `FEDERATION_E2E_LOGS=<dir>` keeps each instance's output. The one on the internet runs with
  `FEDERATION_UNREACHABLE=<the other's origin>`, which makes this instance act as if it couldn't reach that origin;
  for tests only.

## Gotchas

- **`net.BlockList` checks an IPv4 address against IPv6 rules in its IPv4-mapped form**, so a `::ffff:0:0/96` rule
  matches every IPv4 address. `addresses.ts` keeps one list per family.
- **A proxy may drop the port from `Host`** (the bundled nginx sends `$host`), which breaks signatures that cover it.
  `canonicalHeaders` sets `Host` from the Public URL before Fedify verifies anything.
- **JSON-LD contexts come only from Fedify's preloaded copies** (`contextLoader` in `runtime.ts`): an instance on a LAN
  may have no internet at all, and an unknown context is never fetched.
- **Fedify's `allowPrivateAddress` is all or nothing** and forbids custom loaders: don't turn it on. The guarded
  loaders and our own delivery are what let LAN partners through.
- **`@fedify/express` builds the URL from `req.host`**, which drops the port on Express 4: `apRoutes.ts` builds it from
  the Public URL instead.
- **Routers mounted at `/api` with a bare `router.use(requireAuth)`** answer 401 for any path that reaches them, so the
  unauthenticated probe (`federationProbeRoutes`) is mounted beside the health check, ahead of them.
- **nginx redirects a location's prefix without its trailing slash**: with `location /api/ap/link/ { proxy_pass … }`,
  a request for `/api/ap/link` gets a 301, and a link's asks don't follow redirects. The bundled config's location
  is `/api/ap/link/replies/`, so the asks go through `/api/` as they are.
- **A new Prisma migration** may come with `DROP INDEX ..._searchVector_idx` and `DROP DEFAULT` on `searchVector`:
  those columns are kept up in raw SQL, so take those lines out.
