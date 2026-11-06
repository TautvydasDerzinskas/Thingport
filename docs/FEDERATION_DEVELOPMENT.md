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
  opens it.
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
| `socialSurfaces.ts`                        | How each social route crosses to partners.                                                                                                                                                                                                          |

### Pairing

Two instance actors, one `Follow` and one `Accept`:

1. Admin A looks B up (`GET /api/ap/instance` and B's actor), compares B's fingerprint with B's admin, and connects:
   a `Peer` (`OUTGOING`) and a `Follow` from A's instance actor, with the note as `content`.
2. B's edge filter keeps it as a `PeerRequest` without fetching anything, and notifies B's admins. Another one under
   A's address is kept beside it, a few at most: anyone can send one claiming to be A.
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
- **A new Prisma migration** may come with `DROP INDEX ..._searchVector_idx` and `DROP DEFAULT` on `searchVector`:
  those columns are kept up in raw SQL, so take those lines out.
