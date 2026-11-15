# Profile and activity

Your profile keeps a record of how you use your library.

- **Activity heatmap:** a year of activity, one square per day, like the one on a GitHub profile. Earlier years are one
  click away.
- **Activity timeline:** month by month, the models you imported, uploaded, downloaded, opened in a slicer or deleted.

From the same page you can change your email and password, connect a
[single sign-on](../guides/single-sign-on.md) provider, see which browsers are connected to
[Thingport Grab](../../extension/README.md), and generate an [API token](../guides/api-token.md) to connect other apps,
dashboards and [AI assistants](../guides/mcp.md) to your library.

## Your profile

**My models** in the user menu is your profile as the other people on the instance see it, on
[Explore](social.md#explore) too. Choose **Edit profile** to write a bio (Markdown works), add up to
five links shown under it, and pick a cover: one of five covers Thingport draws, the cover of an account you linked, or
a picture of your own of up to 10 MB, dragged up or down to choose the part that shows. Until you choose, you have one
of the drawn covers.

**Your avatar** opens a popup when you click it, there or on your profile page. Design a Thingport avatar -- the
Thingport mark as a head, with a choice of hair, glasses, expression, hair colour and background, or **Shuffle** for a
random one -- or upload a picture of up to 10 MB, cut to a square around what's in it. **Automatic** shows your Gravatar
if you have one, and otherwise a Thingport avatar picked for you. To show the others your Gravatar without giving them
anything that comes from your email, Thingport fetches it from Gravatar itself, once a day; an instance that can't reach
the internet shows the picked avatar instead.

While [connected instances](../guides/connected-instances.md#handles) are on, your handle shows under your name:
`username@this-instance`, which people on other instances use to reach you. Copy it with the button beside it, or
change the username with the pencil.

While social features are on, the lock beside **Edit profile** makes the models on the page public: a globe then, and
your profile on Explore opens on them. Everyone on the instance can see, download and copy them, and only you can change
them. Copies you collected from someone else aren't listed as yours.

If one of the [authors](authors.md) in your library is you, link them to your account: their models then show under
**My models**, and your profile picks up their bio and cover picture if you haven't set your own.

## Achievements

Badges for what you do in Thingport, at the foot of the left column on **My models**: your best three on a shelf, the
rest in a strip under them. Only the ones you've earned show. Click one to see it big, with what earned it, when, and how
far its next tier is; **All** shows every one, grouped.

| Badge                              | Earned by                                                                                                     | Tiers                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Downloader                         | Downloading models (opening one in a slicer doesn't count)                                                    | 1, 10, 100, 200, 500, 1000 |
| Importer                           | Importing models                                                                                              | 1, 10, 100, 200, 500, 1000 |
| One for each site                  | Importing models from it                                                                                      | 1, 10, 100                 |
| One for each tool that makes parts | Saving models made with it                                                                                    | 1, 10, 50                  |
| Designer                           | Saving [Studio](../guides/studio.md) designs to your library                                                  | 1, 10, 50, 100             |
| In sync                            | Keeping collections [in sync](../guides/synced-collections.md) with a site                                    | 1, 5, 10, 25               |
| Many sources                       | Keeping collections in sync from three different sites                                                        | One                        |
| Regular                            | Using Thingport on more than 20 of the last 30 days. It goes grey when that lapses and comes back when you do | One                        |
| Secrets                            | A few things to find in the app                                                                               | One                        |

Tiers go bronze, silver, gold, platinum, diamond and holographic, and only ever go up: deleting what earned a badge
doesn't take it away. A new one shows as a toast and a notification in the bell, and diamond and holographic get a
moment of their own.

Everyone who can see your profile sees your badges: the others on the instance on [Explore](social.md#explore), and
people on [connected instances](connected-instances.md). They see the badge and what it's for, not the counts behind it.

Achievements are off by default. An admin turns them on under **Administration → Social → Achievements**, which works
with social features off. Turning them on gives everyone what they'd already earned, in one notification; turning them
off hides them and keeps them. Models made with a tool or in Studio before this version were kept as uploads, so they
don't count towards those badges.
