# Administration

Every instance-wide setting lives under **Administration**, in the sidebar, with a page for each part of Thingport. The
first account on an instance is its admin, and there's no config file to edit after the first start.

| Page         | What it's for                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview     | [System Health](../guides/system-health.md) for everything Thingport relies on, disk space used, and the update check, which says when newer Thingport images are out.                  |
| Providers    | Turn MakerWorld, Printables or Thingiverse off for everyone, and set the Thingiverse Access Token. See [turning a provider off](../PROVIDER_SETUP.md#turning-a-provider-off).           |
| Storage      | The folder layout on disk, reorganizing existing files, browsing the storage folder, and the [consume folder](../guides/consume-folder.md). See [plain files on your disk](storage.md). |
| Auth         | The public URL, open or invite-only registration, [single sign-on](../guides/single-sign-on.md) providers, and how long a sign-in lasts.                                                |
| Rendering    | How card thumbnails are made, and simplifying the previews of very detailed models. See [3D previews](3d-previews.md).                                                                  |
| AI           | AI models and the [AI features](../guides/ai.md): categorization and improved descriptions.                                                                                             |
| Users        | Everyone's accounts, roles and sign-in methods. See [multi-user](multi-user.md).                                                                                                        |
| Import queue | Imports waiting to run, such as links sent from Thingport Grab: start, pause, retry or clear them.                                                                                      |
| Logs         | What each person did, by person and date: sign-ins, imports, edits, deletions, syncs, role changes, provider switches and AI runs.                                                      |
| Triggers     | One-off maintenance jobs: link missing authors, refetch imported descriptions, or delete all of a user's models.                                                                        |
| Connections  | FlareSolverr, email (SMTP) and the database, each tested before it's saved.                                                                                                             |
| Captcha      | Where to ask for a captcha: sign-in, registration, import, and password and email changes.                                                                                              |

After installing, and whenever something stops working, start with
[System Health](../guides/system-health.md): ideally everything there is green.

For a tour with screenshots, see [thingport.net/features/administration](https://thingport.net/features/administration/).
