# <img src="../assets/providers/eufymake.svg" alt="" width="36" height="36" align="absmiddle"> eufyMake

eufyMake's (Anker's) Make it Real, at [makeitreal.eufymake.com](https://makeitreal.eufymake.com): community models
sorted into its own categories. Its models and their files need nothing; only your likes need your sign-in. It has no
collections and no print profiles.

| At a glance    |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| Sign-in        | None to import; your own sign-in for your likes                                        |
| Thingport Grab | Recommended -- it sends your sign-in as you visit makeitreal.eufymake.com              |
| FlareSolverr   | Not used                                                                               |
| Imports        | Models, with their category; your likes, [synced](../guides/synced-collections.md) too |

## How it works

Paste a model link (`https://makeitreal.eufymake.com/models/<id>/<name>/`) in Thingport, or import it from the model
page with Grab. A model is one print of its model files; where it only offers them as a zip, the zip is unpacked.

Your likes are on your own page, `https://makeitreal.eufymake.com/user/me/`. That page opens on your own models, and
its **Liked** tab doesn't change the address, so Thingport takes the address as your likes: import or sync it from
there, or pick **eufyMake likes** in the sync dialog's Browse tab.

eufyMake turns away more than a few requests a second; Thingport waits and tries again, and reports a rate limit when
that isn't enough.

## Setup: your sign-in

Per-user (**Configuration → Providers → eufyMake**), only for your likes. Opening makeitreal.eufymake.com signed in,
with Grab allowed there, connects it. eufyMake keeps the sign-in in the page's storage rather than a cookie, so Grab
reads it from an open tab. By hand:

1. Sign in at [makeitreal.eufymake.com](https://makeitreal.eufymake.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS).
3. Chrome/Edge: **Application** tab > **Local Storage** > `https://makeitreal.eufymake.com`. Firefox: **Storage**
   tab > **Local Storage**.
4. Copy the whole value of `mk-userinfo`. Since October 2026 the site stores it base64-encoded, so it is one long
   line starting `JTdC` (that is `%7B`, the `{` of the JSON inside); builds before that kept the JSON as it was,
   starting `{"user_id":`. Either is fine -- paste it as it comes.

   ```text
   JTdCJTIydXNlcl9pZCUyMiUzQSUyMj...JTIyJTdE
   ```

5. Right-click **eufyMake** in **Configuration → Providers**, choose **Connect** and paste it.

Both the `X-Auth-Token` and `Gtoken` request headers of a signed-in request to `aiot-wapi-eu.ankermake.com` work
instead, one per line:

```text
X-Auth-Token: 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978
Gtoken: 9e8d7c6b5a4938271605f4e3d2c1b0a9
```

The token on its own doesn't: eufyMake refuses a request without the `Gtoken`, and it can't be worked out from the
token -- it is the MD5 of your user id.

Grab sends the new one whenever you sign in there again.
