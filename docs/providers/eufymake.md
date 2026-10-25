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
4. Copy the value of `mk-userinfo`. (The `X-Auth-Token` and `Gtoken` request headers of a signed-in request to
   `aiot-wapi-eu.ankermake.com` work too.)
5. Right-click **eufyMake** in **Configuration → Providers**, choose **Connect** and paste it.

Grab sends the new one whenever you sign in there again.
