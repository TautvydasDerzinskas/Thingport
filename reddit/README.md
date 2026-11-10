# Thingport blog on Reddit

A [Devvit](https://developers.reddit.com/docs/) app that posts each new [thingport.net blog](https://www.thingport.net/blog/)
post to the subreddit it's installed on, [r/Thingport](https://www.reddit.com/r/Thingport/). Reddit no longer takes new
apps on its public API, so this runs on Reddit's own Developer Platform instead of in CI.

## What it does

- **Every hour** (at seven minutes past), it reads [www.thingport.net/rss.xml](https://www.thingport.net/rss.xml) and posts the
  oldest post published in the last seven days that it hasn't posted yet. One a run, so a backlog never floods the
  subreddit. A post dated ahead waits for its day, so a release post can be merged before release day.
- **Check the Thingport blog now**, in the subreddit's moderator menu, does the same at once and says what it did.
- **Never twice.** It remembers what it posted, and looks through the subreddit's 100 newest posts for a link to the
  post first, so one posted by hand, or by a run whose bookkeeping failed, isn't posted again.
- **Post as** (the app's setting on the subreddit): a **Link** to the post, the default, which shows its social card, or
  a **Text** post with its summary and a link.

Posts come from the app's own account, u/thingport-blog. A post goes out once the site is deployed, as the feed is
read from it, so nothing is posted for a post that's only on `develop`.

## Set it up

Once, by a moderator of r/Thingport, with Node 22 or newer:

```bash
cd reddit
npm install
npm run login  # devvit login: opens Reddit to sign in
npm run upload # typecheck, test, build, then devvit upload
```

Then install it from the app's page on [developers.reddit.com](https://developers.reddit.com/my/apps) onto
r/Thingport, and pick **Post as** in its settings there. `devvit upload` makes a private build, which installs on
subreddits of up to 200 members; a bigger one needs the app published with `npx devvit publish`, which Reddit reviews.

An app may fetch only from the hosts its `devvit.json` lists, and Reddit approves each one: this app asks for
`www.thingport.net` alone, not `thingport.net`, which only redirects there. Until that's approved, the feed can't be
read, and **Check the Thingport blog now** says so.

The name `thingport-blog` must be free on Reddit; if it isn't, change `name` in `devvit.json`, which also renames the
posting account.

## Change it

```bash
npm test # the feed and what to post, without Reddit
npm run typecheck
npm run playtest # devvit playtest: runs it on a test subreddit with logs, rebuilding as you edit
```

`src/feed.ts` reads the feed and picks what to post; `src/server/index.ts` is the app's routes, named in
`devvit.json`. Every change needs another `npm run upload`, and the subreddit's install then offers the new version.
CI runs the type check, tests and build on every change here, but doesn't upload: Devvit has no credential for it.
