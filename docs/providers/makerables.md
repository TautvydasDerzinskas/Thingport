# <img src="../assets/providers/makerables.svg" alt="" width="36" height="36" align="absmiddle"> Makerables

Makera's project site at [makerables.com](https://www.makerables.com), where desktop CNC and 3D printing meet: every
project is free, and each one carries its NC programs and CAM projects beside the model files they were cut from.
Projects and their files are anyone's to read; the projects you saved are yours alone to see.

| At a glance    |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| Sign-in        | None to import; your own Makerables sign-in adds the projects you saved                      |
| Thingport Grab | Recommended -- it sends your sign-in as you visit makerables.com                             |
| FlareSolverr   | Not used                                                                                     |
| Imports        | Projects; your saved projects, [synced](../guides/synced-collections.md) too; its categories |

## How it works

Makerables is a site over a REST API of its own, which Thingport reads the way its own pages do.

- **Projects.** Paste a project link (`https://www.makerables.com/project/<name>`) in Thingport, or import it from the
  project page with Grab. Its page carries the description and the post-processing notes, the whole gallery, the tags,
  the creator and its categories.
- **Which files.** A project keeps its files on three tabs: **NC Files** (the toolpaths a machine cuts), **CAM Files**
  (the CAM project they came out of) and **Model Files** (the CAD and mesh files everything else was made from).
  Thingport imports the Model Files -- the `.step`, `.stp` and `.stl` a slicer or a CAD program takes, and zips of
  them, unpacked. The other two tabs hold machine files no slicer reads, so they're left where they are. A project
  whose Model Files tab holds only pictures or a native CAD format has nothing to import, and says so.
- **No sign-in needed.** The files sit on Makerables' own CDN, open to anyone with the link, so an import needs no
  account at all.
- **Saved projects.** The **Saved** tab of your profile is Makerables' only list, and only you can see it, so Thingport
  reads it with your sign-in. Import it in one go, or sync it so new saves follow. The tab has no address of its own on
  the site -- it lives in the page, not the URL -- so Thingport keeps it as `.../user/<your id>?tab=saved`. Likes are
  counted but never listed anywhere, so Thingport can't read them.
- **Categories.** A project says which of Makerables' categories it is in, parent and child, and Thingport maps those
  onto your own.
- **Browse tab.** With your sign-in, the sync dialog lists your saved projects.

## Setup: your sign-in

Per-user (**Configuration → Providers → Makerables**), and only for your saved projects -- importing needs none.
Makerables signs you in with Auth0, which keeps the session in a `__session` cookie, split across `__session__0`,
`__session__1`, … when it outgrows one. Thingport keeps them, and asks the site for the access token its API takes,
exactly as its own pages do on every page load.

### Easiest: Thingport Grab

With [Thingport Grab](../../extension/README.md) allowed on Makerables, opening makerables.com while you're signed in
connects your account, and sends a new sign-in whenever you sign in there again.

### Manual: copy it from your browser

1. Sign in at [makerables.com](https://www.makerables.com).
2. Open DevTools (`F12`, or `Cmd+Option+I` on macOS) and go to the **Network** tab.
3. Reload the page, click any request to `www.makerables.com` and find its **Cookie** request header.
4. Copy the whole header value.
5. Right-click **Makerables** in **Configuration → Providers**, choose **Connect** and paste it.
