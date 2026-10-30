# Publishing

A widget or a tool you make is yours alone. To offer one to every Thingport, it goes into the
[Thingport repository](https://github.com/TautvydasDerzinskas/Thingport) by pull request, as a folder in the same
layout as the [examples](examples): the metadata, the script, the HTML, a labels file per language, a README and a
few screenshots. A maintainer reads the code before merging it, because it will run in other people's Thingport with
their access.

The steps and what reviewers look for are kept in one place each:

| Sharing a        | Steps                                                                                  | What reviewers look for                                                               |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard widget | [Publishing to the community](../guides/custom-widgets.md#publishing-to-the-community) | [Community widgets README](../../community-widgets/README.md#what-reviewers-look-for) |
| Tool             | [Tool development](../TOOL_DEVELOPMENT.md)                                             | [Tools README](../../tools/README.md#what-reviewers-look-for)                         |

In short, for either:

1. Fork the repository and branch from `develop` ([contributing](../../CONTRIBUTING.md)).
2. Put the folder under `community-widgets/<slug>/` or `tools/<slug>/`. For a widget, **Download for publishing** in
   its ⋮ menu gives you the folder with a README to fill in.
3. Add screenshots of it at work, listed in its metadata, and list the slug in the folder's `index.json`.
4. Run the check that CI runs: `npx tsx scripts/validateCommunityWidgets.ts` or `npx tsx scripts/validateTools.ts`
   in `backend/`.
5. Open a pull request against `develop`.

Once merged, a widget shows up under **Community** in every Thingport's custom widgets, and a tool under
**Administration → Tools**, for an admin to install. Raise its `version` when you change it, and people who installed
it are offered the update.
