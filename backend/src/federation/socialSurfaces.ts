/** How each social route crosses to partner instances. Everything social works for a partner's people as for this
 *  instance's own, so a new route in routes/social.ts or routes/chats.ts must be listed here, and
 *  tests/federationSurfaces.test.ts fails until it is. See docs/FEDERATION_DEVELOPMENT.md.
 *  - `federates`: works across instances now; `how` says what goes over ActivityPub.
 *  - `planned`: will, in the change `when` names; `how` is the plan.
 *  - `local`: never crosses, with why: an admin's settings, or a person's own state about something. */
export type FederationPlan =
  { kind: "federates"; how: string } | { kind: "planned"; when: string; how: string } | { kind: "local"; why: string };

export const SOCIAL_SURFACES: Record<string, FederationPlan> = {
  // routes/social.ts
  "GET /social": { kind: "local", why: "Which social features this instance has on" },
  "GET /social/settings": { kind: "local", why: "An admin's settings" },
  "PATCH /social/settings": { kind: "local", why: "An admin's settings" },
  "GET /explore": {
    kind: "federates",
    how: "Partners' people, public collections and models beside these, from the index of their directories (remoteIndex.ts)",
  },
  "GET /explore/user/:id": {
    kind: "federates",
    how: "This instance's people; a partner's open at /explore/elsewhere/person/:id, read from their Person",
  },
  "GET /explore/user/:id/collections": {
    kind: "federates",
    how: "This instance's people's public collections past their page's first; a partner's person's at /explore/elsewhere",
  },
  "GET /explore/user/:id/models": {
    kind: "federates",
    how: "This instance's people's models; a partner's person's from their models collection, at /explore/elsewhere",
  },
  "GET /explore/elsewhere/person/:id": {
    kind: "federates",
    how: "A partner's person as their Person actor said: name, avatar (icon), cover (image), bio (source), links",
  },
  "GET /explore/elsewhere/person/:id/collections": {
    kind: "federates",
    how: "A partner's person's public collections past their page's first, paged in from their collections (thingport:Collection)",
  },
  "GET /explore/elsewhere/person/:id/models": {
    kind: "federates",
    how: "A partner's person's shared models, paged in from their models collection (thingport:Model)",
  },
  "GET /explore/elsewhere/model/:id": {
    kind: "federates",
    how: "A partner's model as its thingport:Model said: pictures, description, files (Document attachments)",
  },
  "GET /explore/elsewhere/model/:id/files/:file/:filename": {
    kind: "federates",
    how: "A partner's model's file, by a key from its attachment's url, streamed through this instance signed",
  },
  "GET /explore/elsewhere/model/:id/files.zip": {
    kind: "federates",
    how: "Every file of a partner's model, fetched signed through this instance and zipped here",
  },
  "POST /explore/elsewhere/model/:id/copy": {
    kind: "federates",
    how: "A partner's model copied here in the background: files and pictures fetched signed, its origin kept",
  },
  "GET /explore/elsewhere/model/:id/copy": {
    kind: "local",
    why: "How a person's own copy is going, kept on this instance only",
  },
  "GET /explore/elsewhere/collection/:id": {
    kind: "federates",
    how: "A partner's public collection as its thingport:Collection said, with the models in it",
  },
  "GET /explore/elsewhere/media/:token": {
    kind: "federates",
    how: "A partner's picture, fetched signed through this instance and kept; a viewer's browser never reaches it",
  },
  "GET /explore/shared": {
    kind: "federates",
    how: "This instance's collections shared with the viewer; partners' people's at GET /explore/elsewhere/shared",
  },
  "GET /explore/elsewhere/shared": {
    kind: "federates",
    how: "Partners' people's collections shared with the viewer, kept from the Update of a thingport:Collection addressed to them",
  },
  "GET /social/people": {
    kind: "federates",
    how: "Partners' people from the index of their directories after this instance's, and one by exact handle, read from that partner's /api/ap/people",
  },
  "GET /collection/:id/sharing": {
    kind: "federates",
    how: "Partners' people on a collection's list, shown with their instance",
  },
  "PATCH /collection/:id/sharing": {
    kind: "federates",
    how: "Update of the collection to each partner with people on its list, addressed to them, or Delete once none may see it; they read it signed from /api/ap/collections",
  },
  "POST /print/:id/copy": {
    kind: "federates",
    how: "This instance's models; a partner's are copied with POST /explore/elsewhere/model/:id/copy",
  },

  // routes/chats.ts
  "GET /chats": {
    kind: "federates",
    how: "Chats with partners' people, and copies of rooms partners host, beside the rest",
  },
  "GET /chats/unread": { kind: "local", why: "A person's own count of what they haven't read" },
  "GET /chats/people": {
    kind: "federates",
    how: "Partners' people from the index of their directories, after this instance's",
  },
  "POST /chats/direct": {
    kind: "federates",
    how: "Direct messages with a partner's person: Create(Note) to them, attributedTo the sender, signed by the instance",
  },
  "POST /chats/rooms": {
    kind: "federates",
    how: "A room hosted here with partners' people: Update(Group) with its members to each of their instances",
  },
  "PATCH /chats/rooms/:id": { kind: "federates", how: "Update(Group) to every partner with people in it, or who had" },
  "DELETE /chats/rooms/:id": { kind: "federates", how: "Delete(Group) to the partners with people in it" },
  "GET /chats/:id": {
    kind: "federates",
    how: "Members on partners shown with their instance; a room hosted elsewhere's as its host said",
  },
  "GET /chats/:id/messages": {
    kind: "federates",
    how: "Partners' messages, kept here as they arrive (Create, or Announce from a room's host)",
  },
  "POST /chats/:id/messages": {
    kind: "federates",
    how: "Create(Note) to the other person's instance, to each partner in a room hosted here, or to a room's host",
  },
  "DELETE /chats/:id/messages/:messageId": {
    kind: "federates",
    how: "Delete of the Note wherever it's kept; a room's host passes it on",
  },
  "PATCH /chats/:id/membership": { kind: "local", why: "A person's own favourite, muted and read state" },
  "POST /chats/:id/join": {
    kind: "local",
    why: "Public rooms are this instance's; a partner's people are added to a room by its admin, never join on their own",
  },
  "POST /chats/:id/leave": {
    kind: "federates",
    how: "Leaving a room hosted elsewhere: Remove of the person from its Group, to its host; one hosted here, Update(Group)",
  },
};
