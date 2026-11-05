# Multi-user

One Thingport, separate libraries for everyone in the household or workshop. Each person has their own models,
collections, categories, tags and settings. Imports take turns in one line for the whole server, but everyone has their
own [import queue](importing.md#the-import-queue) and sees other people's imports there only as private rows.

With [social features](#sharing-with-each-other) on, people can also share collections with each other, find what
the others share on **Explore**, and [write to each other](#chats).

## Accounts

- **The first account is the admin**, and the instance owner. Admins can make other people admins on the
  **Users** page, and only the owner can take that back.
- **Registration** is open to anyone who can reach Thingport, or invite-only. Invitations are sent by email, for one
  address, for 7 days. Without email set up, the invitation link is shown to copy instead.
- **Email verification**: with email (SMTP) set up, new accounts confirm their address before signing in, and people
  can reset a forgotten password themselves.
- **Captcha**, optionally, on sign-in, registration, import, and password and email changes.
- **Single sign-on**: sign in with Authentik, Pocket ID, Keycloak or another OpenID Connect provider, next to email and
  password. See [single sign-on](../guides/single-sign-on.md).
- **Sessions**: how long a browser stays signed in without being used (a month by default, or off), so a dashboard
  set as a browser's homepage doesn't land on the sign-in form. Signing out or changing the password ends it.

All of these are under **Administration → Auth** and **Administration → Captcha**.

## Sharing with each other

Libraries are private until an admin turns on **Social features**, the switch at the top of **Administration →
Users**. It's off by default. With it on:

- **A collection can be public.** Its form offers **Private** or **Public**, and new collections start private. Only a
  public collection, and the models in it, can be seen by anyone else.
- **Explore** appears in the sidebar once the instance has more than one user. It lists the people who share, with how
  many collections and models each one shares, the newest models put in public collections, recently updated public
  collections, and the models that get copied most. A person's card opens their public collections. Your own shares
  aren't listed there, since they're not news to you.
- **Someone else's model** opens with whose it is. You can download it, open it in your slicer or in
  [Studio](../guides/studio.md), and customize it, but not change it.
- **Adding it to a collection of yours**, or **Copy to my library**, makes a copy of your own: its files, pictures and
  description. The copy stays when the original is changed, made private or deleted. Adding the same model again finds
  the copy you have rather than making another.
- **Others see your display name**, never your email.

Turning social features off hides everything shared again. Each collection keeps its Public or Private setting for when
it's back on, and copies people made stay theirs.

## Chats

With social features on, an admin can also turn on **Chats**, from the cog beside the social features switch. It's off
by default. **Chats** then appears in everyone's sidebar, with a count of unread messages, and opens its list of chats
beside it.

- **Direct messages**: find someone by any part of their name, or by their whole email, which is never shown, and
  write to them.
- **Rooms** are made by admins. Anyone can read a public room and join it to write there; a private room is only for
  the people the admin picks. Admins can rename a room, change who's in it, or delete it with everything said in it.
- **Messages** take emoji and up to five of your own models, with text or without. Everyone who can read the chat can
  open, download and copy a model sent in it, for as long as the message stays. Anyone can delete their own messages,
  and an admin anyone's in a room.
- **Favourite** a chat to keep it at the top, or **mute** it to leave it out of the unread count and notifications.
- **New messages** arrive within a few seconds, not instantly. Someone who isn't reading the chat sees them in the
  sidebar's count, as a toast with **Open**, and as one bell notification per chat. People who have Thingport open show
  as online.

Everything stays on your instance: messages, models and emoji, with nothing fetched from outside it. Apps reading the
REST API with an [API token](../guides/api-token.md) need its **Chats** permission, which a new token doesn't have.
Turning chats off hides every chat; nothing is deleted, and it's all back when they're turned on again.

## For admins

The **Users** page lists everyone with their model and collection counts, how they sign in, and whether their
MakerWorld account is connected. Admins can change roles, delete an account with all its models, follow what each
person does in **Administration → Logs**, and see everyone's imports under **Everyone** in the
[import queue](importing.md#the-import-queue). The switch for [social features](#sharing-with-each-other) is at the
top of the page, with [chats](#chats) behind its cog. See [administration](administration.md).
