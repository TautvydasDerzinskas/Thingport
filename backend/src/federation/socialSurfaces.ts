/** How each social route crosses to partner instances. Everything social works for a partner's people as for this
 *  instance's own, so a new route in routes/social.ts or routes/chats.ts must be listed here, and
 *  tests/federationSurfaces.test.ts fails until it is. See docs/FEDERATION_DEVELOPMENT.md.
 *  - `federates`: works across instances now; `how` says what goes over ActivityPub.
 *  - `planned`: will, in the phase named; `how` is the plan.
 *  - `local`: never crosses, with why: an admin's settings, or a person's own state about something. */
export type FederationPlan =
  | { kind: "federates"; how: string }
  | { kind: "planned"; phase: 3 | 4 | 5; how: string }
  | { kind: "local"; why: string };

export const SOCIAL_SURFACES: Record<string, FederationPlan> = {
  // routes/social.ts
  "GET /social": { kind: "local", why: "Which social features this instance has on" },
  "GET /social/settings": { kind: "local", why: "An admin's settings" },
  "PATCH /social/settings": { kind: "local", why: "An admin's settings" },
  "GET /explore": {
    kind: "planned",
    phase: 3,
    how: "Partners' people, public collections and models, from the index of their directory collections",
  },
  "GET /explore/user/:id": {
    kind: "planned",
    phase: 3,
    how: "A partner's person: their Person actor (icon, image, summary, attachment links)",
  },
  "GET /explore/user/:id/models": {
    kind: "planned",
    phase: 3,
    how: "A partner's person's public models, paged from their collection",
  },
  "POST /print/:id/copy": {
    kind: "planned",
    phase: 4,
    how: "A partner's model copied here: files fetched signed through this instance, its origin kept",
  },

  // routes/chats.ts
  "GET /chats": { kind: "planned", phase: 5, how: "Chats with partners' people listed with the rest" },
  "GET /chats/unread": { kind: "local", why: "A person's own count of what they haven't read" },
  "GET /chats/people": { kind: "planned", phase: 5, how: "Partners' people among those to write to" },
  "POST /chats/direct": { kind: "planned", phase: 5, how: "Create(Note) addressed to a partner's person" },
  "POST /chats/rooms": { kind: "planned", phase: 5, how: "A room as a Group actor partners' people can join" },
  "PATCH /chats/rooms/:id": { kind: "planned", phase: 5, how: "Update(Group) to members' instances" },
  "DELETE /chats/rooms/:id": { kind: "planned", phase: 5, how: "Delete(Group) to members' instances" },
  "GET /chats/:id": { kind: "planned", phase: 5, how: "Members from partners shown with their instance" },
  "GET /chats/:id/messages": { kind: "planned", phase: 5, how: "Partners' messages, stored here as they arrive" },
  "POST /chats/:id/messages": {
    kind: "planned",
    phase: 5,
    how: "Create(Note) to members' instances; a room's Group Announces it",
  },
  "DELETE /chats/:id/messages/:messageId": { kind: "planned", phase: 5, how: "Delete, a Tombstone at the other end" },
  "PATCH /chats/:id/membership": { kind: "local", why: "A person's own favourite, muted and read state" },
  "POST /chats/:id/join": { kind: "planned", phase: 5, how: "Join a partner's public room" },
  "POST /chats/:id/leave": { kind: "planned", phase: 5, how: "Leave, told to the room's instance" },
};
