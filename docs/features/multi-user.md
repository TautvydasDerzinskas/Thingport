# Multi-user

One Thingport instance, separate libraries for everyone in the household or workshop. Each person has their own models,
collections, categories, tags and settings. Imports take turns in one line for the whole server, but everyone has their
own [import queue](importing.md#the-import-queue) and sees other people's imports there only as private rows.

With [social features](social.md) on, people can also share collections with each other, find what the others share on
**Explore**, and [write to each other](social.md#chats).

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

Libraries are private until an admin turns on **Social features** in **Administration → Social**; it's off by default.
With it on, a collection can be **Private**, **Shared** with [the people you pick](social.md#share-what-you-choose), or
**Public**, and a model under **My models** can be made public too. **Explore** shows everyone what the others share:
the people who share, their newest models and public collections, and the models copied most, with the collections
shared with them under **Shared with you** at the top. Someone else's model can be downloaded, opened in a slicer and
copied to your own library, never changed. Others see your display name and avatar, never your email. See
[social features](social.md).

Admins can also connect this instance with other Thingport instances, on the same network, a VPN or the internet,
even from a home network that can't be reached from outside, so their people show up here too. See
[connected instances](connected-instances.md).

## Chats

With social features on, an admin can also turn on **Chats**, under them in **Administration → Social**. Everyone then
has direct messages and the rooms admins make, with models and emoji in messages, all kept on your own instance. See
[chats](social.md#chats).

## For admins

The **Users** page lists everyone with their model and collection counts, how they sign in, and whether their
MakerWorld account is connected. From each person's ⋮ menu, admins change roles, delete all their models while keeping
the account, or delete the account with its models. They follow what each person does in **Administration → Logs**,
and see everyone's imports under **Everyone** in the [import queue](importing.md#the-import-queue). The switches for
[social features](social.md) and [chats](social.md#chats) are in **Administration → Social**. See
[administration](administration.md).

Any admin can do these to a member; only the owner, the first account, can do them to another admin, and nobody to the
owner. An admin can also delete their own models here, but not their own account.
