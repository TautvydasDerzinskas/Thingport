# Multi-user

One Thingport, separate libraries for everyone in the household or workshop. Each person has their own models,
collections, categories, tags and settings. Imports take turns in one line for the whole server, but everyone has their
own [import queue](importing.md#the-import-queue) and sees other people's imports there only as private rows.

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

## For admins

The **Users** page lists everyone with their model and collection counts, how they sign in, and whether their
MakerWorld account is connected. Admins can change roles, delete an account with all its models, follow what each
person does in **Administration → Logs**, and see everyone's imports under **Everyone** in the
[import queue](importing.md#the-import-queue). See [administration](administration.md).
