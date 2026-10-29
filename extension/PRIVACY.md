# Thingport Grab privacy policy

_Effective 20 October 2026._

Thingport Grab is a browser extension that imports 3D-printing models from MakerWorld, Printables,
Thingiverse and, once you allow them, MyMiniFactory, Snapmaker Space, MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, Toymakr3D, Makerables, CGTrader, GrabCAD and OwlCAD into **your own self-hosted Thingport instance**, and converts MakerWorld files for
other slicers in your browser. It has no servers of its own: the
extension's developer never receives any of your data, and nothing is shared with anyone else.

## What the extension stores

Everything below is kept in your browser's local extension storage, on your device only, except
the list of recent imports, which is synced between your browsers as described below.

Where an entry says a sign-in is sent again only when it changes, it is also sent again when you point the extension
at a different Thingport instance, or sign in to it as someone else: what was sent before went to that other
instance or account, so the new one has to be told.

- **Your Thingport connection:** the address of your Thingport instance, and the email and password
  you sign in to it with. They're stored as you entered them, so the extension can sign in again
  when its session expires.
- **A session token** your Thingport instance issues when the extension signs in.
- **Your settings:** whether the extension is switched on, which Offline features are on (the MakerWorld Download
  normalized button, Thingiverse dark mode and hidden Thingiverse ads). Which optional sites you turned on
  is kept by your browser, as the access you granted.
- **Recent imports:** the title, a link, the address of the page it was imported from and of that page's picture of
  it, for the last five models you imported through the extension, shown in its toolbar popup. This list is kept in your browser's sync storage, so it
  appears in the extension on your other browsers and devices where you're signed in to the same
  browser account and have sync on. It travels through your browser vendor's sync service (Google,
  Mozilla or Microsoft) under that service's own privacy terms. It doesn't include your email or
  password: entries are tied to your Thingport account by a one-way hash of your instance address
  and email. The picture loads from the site the model came from; where there's none, the model's thumbnail is
  fetched from your Thingport instance and kept in local storage on each device, not synced.
- **Your Printables, Thingiverse and MyMiniFactory usernames,** as last sent to your Thingport instance, so they're
  only sent again when they change, and when it last read your Printables collections and likes.
- **Your Snapmaker Space sign-in (its access token),** as last sent to your Thingport instance, so it's only sent
  again when it changes.
- **Your MakerOnline sign-in (its access token),** as last sent to your Thingport instance, so it's only sent again
  when it changes.
- **Your Creality Cloud sign-in (its `model_token` and `model_user_id` cookies),** as last sent to your Thingport
  instance, so it's only sent again when it changes.
- **Your NexPrint sign-in (its `auth_token` cookie),** as last sent to your Thingport instance, so it's only sent again
  when it changes.
- **Your Thangs sign-in (its `accessToken` and `refreshToken` cookies),** as last sent to your Thingport instance, so
  it's only sent again when it changes.
- **Your Cults3D sign-in (its `_session_id` and `cf_clearance` cookies, and your browser's User-Agent),** as last sent
  to your Thingport instance, so it's only sent again when it changes.
- **Your eufyMake sign-in (the auth token and user id its site keeps in the page's own storage as `mk-userinfo`),**
  as last sent to your Thingport instance, so it's only sent again when it changes.
- **Your Pinshape sign-in (its `remember_token` and `session` cookies),** as last sent to your Thingport instance, so
  it's only sent again when it changes.
- **Your Toymakr3D sign-in (its `toymakr3dcom_session` cookie and the `remember_web_…` one beside it),** as last sent
  to your Thingport instance, so it's only sent again when it changes.
- **Your Makerables sign-in (its `__session` cookie, which the site splits across `__session__0`, `__session__1`, …
  when it outgrows one),** as last sent to your Thingport instance, so it's only sent again when it changes.
- **Your CGTrader sign-in (its `_cgtrader_session_id` cookie, and the `aws-waf-token` cookie AWS's bot check gave this
  browser for the site),** as last sent to your Thingport instance, so it's only sent again when it changes.
- **Your GrabCAD sign-in (its `_grabcad_session` cookie),** as last sent to your Thingport instance, so it's only sent
  again when it changes.
- **Which site each tab is on:** for every open tab showing one of the sites above, that site's name and the
  browser's number for the tab, so the popup can put the site you're looking at first -- it can't read the
  address of your tab itself. No address is kept, only which of the supported sites it is. A tab's entry is
  deleted as soon as it goes to another page or is closed, and all of them when the browser starts.
- **Recently viewed:** the address, title and picture link of the last 10 model pages you opened on the sites the
  extension runs on, shown in its popup's **History** tab. They're kept in this browser only, never synced or sent
  anywhere; **Clear** in that tab deletes them.
- **Collection import progress:** while a MakerWorld collection import is running, the list of
  model pages still to visit, so it can carry on across page loads. It's deleted when the import
  ends.

## What the extension sends, and where

The extension only communicates with **your Thingport instance** (the address you entered) and with
the **provider site you're on**. The one exception: once you've allowed Snapmaker Space, it also renews your
Snapmaker sign-in at id.snapmaker.com every few hours while the browser is open, even with no Snapmaker page open
(see below). And when you open the popup's **History** tab, the pictures of your recently viewed models load straight
from the image servers of the sites you viewed them on, without saying which page asked for them.

**To your Thingport instance:**

- Your email and password, to sign in.
- The address of each model page you open on MakerWorld, Printables, Thingiverse, MyMiniFactory, Snapmaker Space,
  MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, Toymakr3D, Makerables, CGTrader or GrabCAD, to check
  whether you've already imported that model. This happens when the page opens, so the extension
  knows whether to show its button. On a MakerWorld collection page, the same check runs for each
  model in the collection when you open the extension's panel there.
- The address of whatever you import, and your choice of collection, when you import it.
- On a collection or Thingiverse Likes page, when you open the extension's panel: the page's address, to check whether
  that collection is synced. When you turn sync on: the collection's name and the ids of the models
  listed in it, so your instance knows which models are new later.
- A request for the slicer picked in your Thingport Configuration, when a MakerWorld model page opens, so
  the **Download normalized** button's explanation can name that slicer.
- If you're logged into MakerWorld in this browser: your MakerWorld session cookie, when you import
  from MakerWorld. MakerWorld requires it to download files. The extension also saves it to your
  Thingport account's MakerWorld setting, so imports made from Thingport's own web app work too.
- If you're logged into MyMiniFactory in this browser, and have allowed the extension there: your MyMiniFactory
  session cookie (`PHPSESSID`), when you open a MyMiniFactory page and it changed since last sent. Your Thingport
  instance uses it to download the models in your MyMiniFactory library, such as ones you bought.
- If you're signed in to Snapmaker Space in this browser, and have allowed the extension there: your Snapmaker access
  token, when you open a Snapmaker Space page and every few hours while the browser is open, whenever it changed since
  last sent. Your Thingport instance uses it to download Snapmaker models and to read your likes and bookmarks there.
- If you're signed in to MakerOnline in this browser, and have allowed the extension there: your MakerOnline access
  token, when you open a MakerOnline page and it changed since last sent. Your Thingport instance uses it to read your
  likes and private collections there.
- If you're signed in to Creality Cloud in this browser, and have allowed the extension there: your Creality Cloud
  sign-in (its `model_token` and `model_user_id` cookies, and when they expire), when you open a Creality Cloud page and
  it changed since last sent. Your Thingport instance uses it to download Creality Cloud models and to read your likes
  there.
- If you're signed in to NexPrint in this browser, and have allowed the extension there: your NexPrint sign-in (its
  `auth_token` cookie, and when it expires), when you open a NexPrint page and it changed since last sent. Your
  Thingport instance uses it to download NexPrint models.
- If you're signed in to Thangs in this browser, and have allowed the extension there: your Thangs sign-in (its
  `accessToken` and `refreshToken` cookies), when you open a Thangs page and it changed since last sent. Your Thingport
  instance uses it to download Thangs models and read your collections there, and renews it with Thangs' own sign-in
  service as it runs out.
- If you're signed in to Cults3D in this browser, and have allowed the extension there: your Cults3D sign-in (its
  `_session_id` cookie), the `cf_clearance` cookie Cloudflare gave this browser for the site, and your browser's
  User-Agent, which that cookie is tied to, when you open a signed-in Cults3D page and they changed since last sent.
  Your Thingport instance uses them to add free models to your Cults3D downloads and to download your models from
  there, as this browser would.
- If you're signed in to Toymakr3D in this browser, and have allowed the extension there: your Toymakr3D sign-in (its
  `toymakr3dcom_session` cookie and the `remember_web_…` one that signs you in again once that runs out), when you
  open a signed-in Toymakr3D page and it changed since last sent. Your Thingport instance uses it to download
  Toymakr3D models, the free ones included, and to read the products you liked there.
- If you're signed in to eufyMake in this browser, and have allowed the extension there: your eufyMake sign-in (the
  auth token and user id the site keeps in the page's own storage as `mk-userinfo`, which the extension reads from an
  open makeitreal.eufymake.com tab the way the site does), when it changed since last sent. Your Thingport instance
  uses it to read the models you liked there; its models import without it.
- If you're signed in to Pinshape in this browser, and have allowed the extension there: your Pinshape sign-in (its
  `remember_token` and `session` cookies), when you open a signed-in Pinshape page and it changed since last sent.
  Your Thingport instance uses it to download Pinshape models; its collections and likes are read without it.
- On OwlCAD, once you've allowed it there: the geometry of each project waiting on your Thingport instance to be
  imported. OwlCAD stores no file for a project -- its own editor builds one in the page -- so the extension opens
  each waiting project in a tab of its own, exports it there and sends the bytes back to your instance. It asks your
  instance for that list on each owlcad.com page. OwlCAD needs no sign-in, so none is read or sent.
- If you're signed in to Makerables in this browser, and have allowed the extension there: your Makerables sign-in
  (its `__session` cookie, split across `__session__0`, `__session__1`, … when it outgrows one), when you open a
  Makerables page and it changed since last sent. Your Thingport instance uses it to read the projects you saved
  there, which only you can see; its projects and their files need no sign-in at all.
- If you're signed in to CGTrader in this browser, and have allowed the extension there: your CGTrader sign-in (its
  `_cgtrader_session_id` cookie), and the `aws-waf-token` cookie AWS's bot check gave this browser for the site, when
  you open a CGTrader page signed in and either changed since last sent. Your Thingport instance uses them to download
  CGTrader models, the free ones included, and to read the models you liked and wishlisted there, which only you can
  see.
- If you're signed in to GrabCAD in this browser, and have allowed the extension there: your GrabCAD sign-in (its
  `_grabcad_session` cookie), when you open a signed-in GrabCAD page and it changed since last sent. Your Thingport
  instance uses it to download GrabCAD models; its models' details and anyone's likes are read without it.
- On MakerOnline: the download links MakerOnline gives the page for the files of a model you import, or of the models
  waiting on your Thingport instance for the extension (it asks your instance for that list on each MakerOnline page).
  Your instance downloads the files from those links.
- If you're logged into Printables, Thingiverse or MyMiniFactory in this browser: your username there, when it
  first sees it or it changes, so Thingport's web app can list your collections on that site when
  you pick one to sync with.
- If you're logged into Printables in this browser, at most once an hour while you're on its pages:
  your Printables collections (names, model counts and a few model pictures, private collections
  included), the models you liked there, and the models in the private collections you sync. Only
  you can see these on Printables, so this is how Thingport can sync them.

**To MakerWorld, Printables, Thingiverse, MyMiniFactory, Snapmaker Space, MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, Toymakr3D, Makerables, CGTrader, GrabCAD and OwlCAD:**

- On MakerWorld, to find a model's download link, the extension asks MakerWorld's own website for
  it, the same way the page does when you click Download, using your existing MakerWorld session.
  It may also click the page's own Download button and read the link from the download that
  starts; that download is cancelled and removed from your download history straight away, so no
  file is saved.
- When you click **Download normalized** on a MakerWorld model page, the extension downloads that
  model's file from MakerWorld, as the page's own Download button would, converts it inside your
  browser and saves the result to your downloads. The file isn't sent anywhere else.
- On a MakerWorld collection import, the extension moves your tab from one model page to the next,
  just as if you were clicking through them.
- On Printables, once per open tab, the extension asks Printables' own API which account you're
  logged in as, the same way the page does, using your existing Printables session. At most once an
  hour it also asks it, the same way, for your collections, your liked models and the models in
  the private collections you sync.
- On Snapmaker Space, once you've allowed it there: Snapmaker's sign-in lasts a day, so every few hours while the
  browser is open, when it's running out, the extension renews it at Snapmaker's own sign-in service (id.snapmaker.com)
  the same way the site does, and writes the renewed sign-in back into the site's own cookies, so you stay signed in
  there. When you open the panel on a model page, it also asks Snapmaker's public model API which print profiles the
  model has.
- On MakerOnline, once you've allowed it there: MakerOnline gives its files only to its own pages, so to import a model
  the extension asks MakerOnline's download service for each file's link from the page itself, the same way the page's
  own Download button does, with your existing MakerOnline sign-in and the page's own security check. It also asks
  MakerOnline's public model API which print profiles a model has.
- On Creality Cloud, once you've allowed it there: when you open the panel on a model page, the extension asks Creality
  Cloud's public model API which print profiles the model has, the same way the page does, without your sign-in.
- On NexPrint, once you've allowed it there: when you open the panel on a model page, the extension asks NexPrint's
  public model API which print profiles the model has, the same way the page does, without your sign-in.
- On Thangs, once you've allowed it there: when you open the panel on a model page, the extension asks Thangs whether
  your account may download the model, with your existing Thangs sign-in, the same way the page's own Download button
  does. This doesn't download anything.
- On CGTrader, once you've allowed it there: when you open the panel on a model page, the extension asks CGTrader for
  the model's details the page itself loads, with your existing CGTrader sign-in, to see whether you've bought a paid
  model. This doesn't download anything.

**The extension reads, on supported pages only:** the model's title and main picture, MakerWorld's page data for the
model, the model links listed on collection pages, and, on Thingiverse and MyMiniFactory, your username from the
page's header. It doesn't read any other websites.

## What the extension doesn't do

- No analytics, tracking, telemetry or crash reporting.
- No advertising.
- No data sent to the extension's developer, or to any third party.
- No selling or sharing of data.
- No code downloaded from the internet: everything the extension runs is included in it.

## Permissions

| Permission                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                                          | Keeps the settings and data listed under "What the extension stores".                                                                                                                                                                                                                                                                                                                                                                                                         |
| Cookies                                          | Reads MakerWorld's, Printables', MyMiniFactory's, MakerOnline's, Creality Cloud's, NexPrint's, Thangs', Cults3D's, Pinshape's, Toymakr3D's, Makerables', CGTrader's and GrabCAD's session cookies (and CGTrader's bot-check token, and its `user_id` cookie, read only to tell whether you're signed in there and never sent to Thingport), and reads and renews Snapmaker Space's sign-in cookies, only on their sites (see above).                                          |
| Downloads                                        | Reads the link from the MakerWorld download it starts, then cancels and removes that download.                                                                                                                                                                                                                                                                                                                                                                                |
| Scripting                                        | Adds the import button to MyMiniFactory's, Snapmaker Space's, MakerOnline's, Creality Cloud's, NexPrint's, Thangs', Cults3D's, eufyMake's, Pinshape's, Toymakr3D's, Makerables', CGTrader's and GrabCAD's pages, and those of sites added later, once you allow them; on MakerOnline it also asks for file links from within the page, on eufyMake it reads the sign-in from the page's own storage, and on OwlCAD it exports a waiting project in an editor tab (see above). |
| Alarms                                           | Renews the Snapmaker Space sign-in every few hours, once you've allowed Snapmaker Space.                                                                                                                                                                                                                                                                                                                                                                                      |
| Access to MakerWorld, Printables and Thingiverse | Shows the import button, and MakerWorld's Download normalized button, on their pages. On Thingiverse it also applies the dark theme and hides ads, while those Offline features are on.                                                                                                                                                                                                                                                                                       |
| Access to newer model sites (optional)           | Asked for one site at a time, only when you click **Enable** next to it under **Providers** in the popup (MyMiniFactory, Snapmaker Space, MakerOnline, Creality Cloud, NexPrint, Thangs, Cults3D, eufyMake, Pinshape, Toymakr3D, Makerables, CGTrader, GrabCAD, OwlCAD, and sites added in later updates). You can take this access back in your browser's extension settings.                                                                                                |
| Access to your Thingport instance                | Requested for that one address when you set the extension up, so it can talk to your instance.                                                                                                                                                                                                                                                                                                                                                                                |

## Your control over your data

- Change your Thingport connection, disconnect from your instance (which deletes the connection and your sign-in from
  the extension), or switch the extension off, from its toolbar popup. Clear your recently viewed
  models from its **History** tab.
- Uninstalling the extension deletes everything it stored on that device. The synced list of recent
  imports can stay in your browser account's sync data while the extension is still installed on
  another of your browsers; clearing your browser's synced data removes it.
- Anything the extension sends to your Thingport instance is stored on your own server, under your
  control, like everything else in your Thingport library.

## Changes

If this policy changes, the updated version is published here with a new effective date. Every
past version is in the project's
[git history](https://github.com/TautvydasDerzinskas/Thingport/commits/main/extension/PRIVACY.md).

## Contact

Questions about this policy or the extension:
[open an issue on GitHub](https://github.com/TautvydasDerzinskas/Thingport/issues).
