# Multi-user

One Thingport, separate libraries for everyone in the household or workshop. Each person has their own models,
collections, categories, tags and settings.

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
- **Session length** for the whole instance, from 5 minutes to a year.

All of these are under **Administration → Auth** and **Administration → Captcha**.

## For admins

The **Users** page lists everyone with their model and collection counts, how they sign in, and whether their
MakerWorld account is connected. Admins can change roles, delete an account with all its models, and follow what
each person does in **Administration → Logs**. See [administration](administration.md).
